//! The subagent-net hub: ops over `POST /v1/ops/<name>`, and one hub-wide
//! event stream turned into browser events and the local message mirror.
//!
//! This server is the hub's only principal; the hub lets every principal see
//! every agent, so access per user is enforced here (`chat_agents`).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

#[derive(Clone)]
pub struct Hub {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Hub {
    pub fn new(base: &str, token: &str) -> Self {
        Self { http: reqwest::Client::new(), base: base.trim_end_matches('/').to_string(), token: token.to_string() }
    }

    pub async fn call(&self, op: &str, args: Value) -> anyhow::Result<Value> {
        let res = self.http.post(format!("{}/v1/ops/{op}", self.base)).bearer_auth(&self.token).json(&args).send().await?;
        let status = res.status();
        let body = res.text().await?;
        anyhow::ensure!(status.is_success(), "subnet {op}: {status}: {body}");
        Ok(serde_json::from_str(&body)?)
    }

    pub async fn spawn(&self, ty: &str, prompt: &str, tenant: &str) -> anyhow::Result<String> {
        let out = self.call("spawn", json!({ "type": ty, "prompt": prompt, "tenant": tenant })).await?;
        out["id"].as_str().map(String::from).ok_or_else(|| anyhow::anyhow!("spawn returned no id: {out}"))
    }

    pub async fn send(&self, agent: &str, content: &str) -> anyhow::Result<()> {
        self.call("send", json!({ "to": format!("agent:{agent}"), "content": content })).await.map(drop)
    }

    pub async fn transcript(&self, agent: &str) -> anyhow::Result<Value> {
        self.call("transcript", json!({ "id": agent })).await
    }
}

/// What the browser of `user` in `mode` is told.
#[derive(Clone, Debug)]
pub struct BrowserEvent {
    pub user: Uuid,
    pub mode: String,
    pub name: &'static str,
    pub data: Value,
}

/// Our agents: id → (user, mode). Loaded at start, extended on spawn.
#[derive(Clone, Default)]
pub struct Owners(Arc<RwLock<HashMap<String, (Uuid, String)>>>);

impl Owners {
    pub async fn load(pool: &PgPool) -> anyhow::Result<Self> {
        let rows: Vec<(String, Uuid, String)> = sqlx::query_as("SELECT agent_id, user_id, mode FROM chat_agents").fetch_all(pool).await?;
        Ok(Self(Arc::new(RwLock::new(rows.into_iter().map(|(a, u, m)| (a, (u, m))).collect()))))
    }
    pub async fn insert(&self, agent: String, user: Uuid, mode: String) {
        self.0.write().await.insert(agent, (user, mode));
    }
    async fn get(&self, agent: &str) -> Option<(Uuid, String)> {
        self.0.read().await.get(agent).cloned()
    }
}

/// Per-agent turn in progress, folded from deltas.
#[derive(Default)]
struct Turn {
    text: String,
    /// call_id → tool name, from streamed tool-call deltas.
    calls: HashMap<String, String>,
    /// Tool-call index → call_id (deltas after the first only carry the index).
    index: HashMap<u64, String>,
    /// Client-tool calls waiting for (or answered by) the user.
    questions: std::collections::HashSet<String>,
    thinking: bool,
}

pub struct Pump {
    pub hub: Hub,
    pub pool: PgPool,
    pub owners: Owners,
    pub tx: broadcast::Sender<BrowserEvent>,
}

impl Pump {
    /// Follows `/v1/events` forever, reconnecting with backoff.
    pub async fn run(self) {
        let mut backoff = Duration::from_secs(1);
        loop {
            match self.follow().await {
                Ok(()) => tracing::warn!("subnet event stream ended; reconnecting"),
                Err(e) => tracing::error!("subnet event stream: {e:#}; reconnecting in {backoff:?}"),
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(30));
        }
    }

    async fn follow(&self) -> anyhow::Result<()> {
        let res = self.hub.http.get(format!("{}/v1/events", self.hub.base)).bearer_auth(&self.hub.token).send().await?.error_for_status()?;
        tracing::info!("following subnet events");
        let mut turns: HashMap<String, Turn> = HashMap::new();
        let mut stream = sse_stream::SseStream::from_byte_stream(res.bytes_stream());
        while let Some(sse) = stream.next().await {
            let Some(data) = sse?.data else { continue };
            let notice: Value = match serde_json::from_str(&data) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("unparseable subnet notice ({e}): {data}");
                    continue;
                }
            };
            if notice["kind"] == "lagged" {
                // Missed events stay in the hub's log; the mirror catches up
                // from the transcript on the next history read.
                tracing::warn!("subnet stream lagged: {} missed", notice["missed"]);
                continue;
            }
            if notice["kind"] != "agent" {
                continue;
            }
            let agent = notice["agent"].as_str().unwrap_or_default().to_string();
            let Some((user, mode)) = self.owners.get(&agent).await else { continue };
            let seq = notice["seq"].as_i64().unwrap_or_default();
            let turn = turns.entry(agent.clone()).or_default();
            if let Err(e) = self.apply(&agent, seq, user, &mode, &notice["event"], turn).await {
                tracing::error!(agent, seq, "mirroring subnet event: {e:#}");
            }
        }
        Ok(())
    }

    fn emit(&self, user: Uuid, mode: &str, name: &'static str, data: Value) {
        // No receivers is fine: nobody has the chat open.
        let _ = self.tx.send(BrowserEvent { user, mode: mode.to_string(), name, data });
    }

    async fn mirror(&self, agent: &str, seq: i64, user: Uuid, mode: &str, role: &str, content: &str, data: Option<Value>) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO chat_messages (agent_id, seq, user_id, mode, role, content, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (agent_id, seq) DO NOTHING",
        )
        .bind(agent)
        .bind(seq)
        .bind(user)
        .bind(mode)
        .bind(role)
        .bind(content)
        .bind(data)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn apply(&self, agent: &str, seq: i64, user: Uuid, mode: &str, ev: &Value, turn: &mut Turn) -> anyhow::Result<()> {
        match ev["type"].as_str().unwrap_or_default() {
            "inbox" => {
                let content = ev["content"].as_str().unwrap_or_default();
                self.mirror(agent, seq, user, mode, "user", &crate::chat::strip_context(content), None).await?;
                turn.thinking = true;
                self.emit(user, mode, "thinking", json!({}));
            }
            "llm_delta" => {
                let delta = &ev["delta"];
                if let Some(text) = delta["content"].as_str().filter(|t| !t.is_empty()) {
                    turn.text.push_str(text);
                    self.emit(user, mode, "text_delta", json!({ "content": text }));
                }
                for call in delta["tool_calls"].as_array().into_iter().flatten() {
                    let idx = call["index"].as_u64().unwrap_or_default();
                    if let Some(id) = call["id"].as_str() {
                        turn.index.insert(idx, id.to_string());
                    }
                    if let (Some(id), Some(name)) = (turn.index.get(&idx), call["function"]["name"].as_str()) {
                        turn.calls.insert(id.clone(), name.to_string());
                    }
                }
                if let Some(u) = delta.get("usage").filter(|u| u.is_object()) {
                    sqlx::query(
                        "INSERT INTO chat_token_usage (agent_id, seq, user_id, mode, input_tokens, output_tokens, cached_tokens)
                         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
                    )
                    .bind(agent)
                    .bind(seq)
                    .bind(user)
                    .bind(mode)
                    .bind(u["prompt_tokens"].as_i64().unwrap_or_default())
                    .bind(u["completion_tokens"].as_i64().unwrap_or_default())
                    .bind(u["cached_prompt_tokens"].as_i64().unwrap_or_default())
                    .execute(&self.pool)
                    .await?;
                }
            }
            "llm_done" => {
                let text = std::mem::take(&mut turn.text);
                turn.index.clear();
                if !text.trim().is_empty() {
                    self.mirror(agent, seq, user, mode, "assistant", &text, None).await?;
                    self.emit(user, mode, "text_done", json!({ "content": text }));
                }
                let pending: Vec<String> = turn.calls.values().cloned().collect();
                for name in &pending {
                    self.emit(user, mode, "tool_start", json!({ "name": name }));
                }
                if pending.is_empty() {
                    turn.thinking = false;
                    self.emit(user, mode, "done", json!({}));
                }
            }
            "tool_result" | "tool_aborted" => {
                let call = ev["call_id"].as_str().unwrap_or_default();
                if turn.questions.remove(call) {
                    let content = ev["content"].as_str().unwrap_or_default();
                    self.mirror(agent, seq, user, mode, "answer", content, Some(json!({ "call_id": call, "is_error": ev["is_error"] }))).await?;
                } else if let Some(name) = turn.calls.remove(call) {
                    self.mirror(agent, seq, user, mode, "tool", &name, Some(json!({ "call_id": call, "is_error": ev["is_error"] }))).await?;
                    self.emit(user, mode, "tool_end", json!({ "name": name }));
                }
            }
            "client_tool_call" => {
                let (call, name, input) = (ev["call_id"].clone(), ev["name"].clone(), ev["input"].clone());
                let id = call.as_str().unwrap_or_default().to_string();
                turn.calls.remove(&id);
                turn.questions.insert(id);
                let data = json!({ "call_id": call, "toolName": name, "input": input });
                self.mirror(agent, seq, user, mode, "question", input["question"].as_str().unwrap_or_default(), Some(data.clone())).await?;
                self.emit(user, mode, "question", data);
            }
            "approval_requested" => {
                let data = json!({ "call_id": ev["call_id"], "name": ev["name"], "input": ev["input"], "reason": ev["reason"] });
                self.mirror(agent, seq, user, mode, "approval", ev["name"].as_str().unwrap_or_default(), Some(data.clone())).await?;
                self.emit(user, mode, "approval", data);
            }
            "llm_failed" => {
                turn.text.clear();
                self.emit(user, mode, "error", json!({ "message": "The assistant failed to answer. Please try again." }));
                tracing::error!(agent, "llm_failed: {}", ev["error"]);
            }
            "cancelled" | "superseded" => {
                self.owners.0.write().await.remove(agent);
            }
            _ => {}
        }
        Ok(())
    }
}
