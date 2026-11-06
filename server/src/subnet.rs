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

/// What `user`'s browsers are told about one of their conversations.
#[derive(Clone, Debug)]
pub struct BrowserEvent {
    pub user: Uuid,
    pub name: &'static str,
    pub data: Value,
}

/// Our agents: id → (user, conversation, seq up to which its log is history
/// copied by an upgrade). Loaded at start, extended on spawn and upgrade.
/// Sub-agents are kept apart: their events show differently.
#[derive(Clone, Default)]
pub struct Owners(Arc<RwLock<HashMap<String, (Uuid, Uuid, i64)>>>, Arc<RwLock<HashMap<String, (Uuid, Uuid)>>>);

impl Owners {
    pub async fn load(pool: &PgPool) -> anyhow::Result<Self> {
        let rows: Vec<(String, Uuid, Uuid, i64)> = sqlx::query_as("SELECT agent_id, user_id, id, mirror_from_seq FROM conversations").fetch_all(pool).await?;
        let kids: Vec<(String, Uuid, Uuid)> =
            sqlx::query_as("SELECT k.agent_id, c.user_id, c.id FROM conversation_children k JOIN conversations c ON c.id = k.conversation_id WHERE k.finished_at IS NULL").fetch_all(pool).await?;
        Ok(Self(
            Arc::new(RwLock::new(rows.into_iter().map(|(a, u, c, f)| (a, (u, c, f))).collect())),
            Arc::new(RwLock::new(kids.into_iter().map(|(a, u, c)| (a, (u, c))).collect())),
        ))
    }
    pub async fn insert(&self, agent: String, user: Uuid, conversation: Uuid, copied_upto: i64) {
        self.0.write().await.insert(agent, (user, conversation, copied_upto));
    }
    async fn get(&self, agent: &str) -> Option<(Uuid, Uuid, i64)> {
        self.0.read().await.get(agent).cloned()
    }
    async fn child(&self, agent: &str) -> Option<(Uuid, Uuid)> {
        self.1.read().await.get(agent).cloned()
    }
    async fn insert_child(&self, agent: String, user: Uuid, conversation: Uuid) {
        self.1.write().await.insert(agent, (user, conversation));
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
    /// call_id → its arguments as streamed so far (for the call's `_reason`).
    args: HashMap<String, String>,
    /// call_id → the assistant's `_reason` for it, once the call is complete.
    reasons: HashMap<String, String>,
    /// call_id → `service.tool` for a connector call (what it really calls).
    targets: HashMap<String, String>,
    /// Client-tool calls waiting for (or answered by) the user.
    questions: std::collections::HashSet<String>,
    /// The model call's usage: each delta's replaces the last; counted at llm_done.
    usage: Option<Value>,
    thinking: bool,
}

impl Turn {
    /// Folds a delta's streamed tool-call chunks into calls (id → name) and
    /// their arguments. subnet's chunks are flat ({id, name, index,
    /// arguments}); OpenAI's nest name and arguments under `function`.
    fn fold_tool_calls(&mut self, delta: &Value) {
        for call in delta["tool_calls"].as_array().into_iter().flatten() {
            let idx = call["index"].as_u64().unwrap_or_default();
            if let Some(id) = call["id"].as_str() {
                self.index.insert(idx, id.to_string());
            }
            let field = |k: &str| call[k].as_str().or_else(|| call["function"][k].as_str());
            let Some(id) = self.index.get(&idx).cloned() else { continue };
            if let Some(name) = field("name") {
                self.calls.insert(id.clone(), name.to_string());
            }
            if let Some(chunk) = field("arguments") {
                self.args.entry(id).or_default().push_str(chunk);
            }
        }
    }
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
        let mut stream = sse_stream::SseStream::from_bytes_stream(res.bytes_stream());
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
            let seq = notice["seq"].as_i64().unwrap_or_default();
            if let Some((user, conv, copied_upto)) = self.owners.get(&agent).await {
                if seq <= copied_upto {
                    continue;
                }
                let turn = turns.entry(agent.clone()).or_default();
                if let Err(e) = self.apply(&agent, seq, user, conv, &notice["event"], turn).await {
                    tracing::error!(agent, seq, "mirroring subnet event: {e:#}");
                }
                continue;
            }
            // A sub-agent: known from its parent's child_spawned, or by an ancestor of ours.
            let mut owner = self.owners.child(&agent).await;
            if owner.is_none() {
                for a in notice["ancestors"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                    if let Some((u, c, _)) = self.owners.get(a).await {
                        owner = Some((u, c));
                        break;
                    }
                }
                if let Some((u, c)) = owner {
                    let parent = notice["ancestors"][0].as_str().unwrap_or_default().to_string();
                    if let Err(e) = self.adopt(&agent, &parent, u, c).await {
                        tracing::error!(agent, "recording a sub-agent: {e:#}");
                    }
                }
            }
            let Some((user, conv)) = owner else { continue };
            let turn = turns.entry(agent.clone()).or_default();
            if let Err(e) = self.apply_child(&agent, seq, user, conv, &notice["event"], turn).await {
                tracing::error!(agent, seq, "mirroring a sub-agent's event: {e:#}");
            }
        }
        Ok(())
    }

    /// A sub-agent of a conversation's agent: its calls are the conversation's.
    async fn adopt(&self, agent: &str, parent: &str, user: Uuid, conv: Uuid) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO conversation_children (agent_id, conversation_id, parent_agent_id) VALUES ($1, $2, $3) ON CONFLICT (agent_id) DO NOTHING")
            .bind(agent)
            .bind(conv)
            .bind(parent)
            .execute(&self.pool)
            .await?;
        self.owners.insert_child(agent.to_string(), user, conv).await;
        Ok(())
    }

    /// A sub-agent's events: its tool runs and approvals show in the
    /// conversation (approvals wait for the user like the assistant's own);
    /// its text and turns are its parent's business (the report goes there).
    async fn apply_child(&self, agent: &str, seq: i64, user: Uuid, conv: Uuid, ev: &Value, turn: &mut Turn) -> anyhow::Result<()> {
        match ev["type"].as_str().unwrap_or_default() {
            "llm_delta" => {
                let delta = &ev["delta"];
                turn.fold_tool_calls(delta);
                if let Some(u) = delta.get("usage").filter(|u| u.is_object()) {
                    turn.usage = Some(u.clone());
                }
            }
            "llm_done" => {
                if let Some(u) = turn.usage.take() {
                    self.record_usage(agent, seq, user, &u).await?;
                }
                turn.index.clear();
                for (id, args) in std::mem::take(&mut turn.args) {
                    if let Some(reason) = call_reason(&args) {
                        turn.reasons.insert(id.clone(), reason);
                    }
                    if turn.calls.get(&id).is_some_and(|n| n == "connector.call_tool")
                        && let Ok(v) = serde_json::from_str::<Value>(&args)
                    {
                        turn.targets.insert(id, crate::hook::effective("connector.call_tool", &v).name);
                    }
                }
            }
            "compacted" => {
                if let Some(u) = ev.get("usage").filter(|u| u.is_object()) {
                    self.record_usage(agent, seq, user, u).await?;
                }
            }
            "tool_result" | "tool_aborted" | "approval_requested" => return self.apply(agent, seq, user, conv, ev, turn).await,
            "cancelled" | "superseded" => {
                self.owners.1.write().await.remove(agent);
            }
            _ => {}
        }
        Ok(())
    }

    fn emit(&self, user: Uuid, conversation: Uuid, name: &'static str, mut data: Value) {
        data["conversation"] = json!(conversation);
        // No receivers is fine: nobody has the chat open.
        let _ = self.tx.send(BrowserEvent { user, name, data });
    }

    async fn mirror(&self, agent: &str, seq: i64, user: Uuid, role: &str, content: &str, data: Option<Value>) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO chat_messages (agent_id, seq, user_id, role, content, data) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (agent_id, seq) DO NOTHING",
        )
        .bind(agent)
        .bind(seq)
        .bind(user)
        .bind(role)
        .bind(content)
        .bind(data)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn record_usage(&self, agent: &str, seq: i64, user: Uuid, u: &Value) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO chat_token_usage (agent_id, seq, user_id, input_tokens, output_tokens, cached_tokens)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
        )
        .bind(agent)
        .bind(seq)
        .bind(user)
        .bind(u["prompt_tokens"].as_i64().unwrap_or_default())
        .bind(u["completion_tokens"].as_i64().unwrap_or_default())
        .bind(u["cached_prompt_tokens"].as_i64().unwrap_or_default())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// What the approval hook recorded about a call, if it judged it.
    async fn check(&self, agent: &str, call: &str) -> anyhow::Result<Option<Value>> {
        let row: Option<(Option<String>, String, Option<String>, Option<String>, Option<Value>)> =
            sqlx::query_as("SELECT agent_reason, decision, check_verdict, check_reasoning, purchase FROM approval_checks WHERE agent_id = $1 AND call_id = $2")
                .bind(agent)
                .bind(call)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(agent_reason, decision, verdict, reasoning, purchase)| json!({ "agent_reason": agent_reason, "decision": decision, "verdict": verdict, "reasoning": reasoning, "purchase": purchase })))
    }

    async fn apply(&self, agent: &str, seq: i64, user: Uuid, conv: Uuid, ev: &Value, turn: &mut Turn) -> anyhow::Result<()> {
        match ev["type"].as_str().unwrap_or_default() {
            "inbox" => {
                let content = ev["content"].as_str().unwrap_or_default();
                self.mirror(agent, seq, user, "user", &crate::chat::strip_context(content), None).await?;
                turn.thinking = true;
                self.emit(user, conv, "thinking", json!({}));
            }
            "llm_delta" => {
                let delta = &ev["delta"];
                if let Some(text) = delta["content"].as_str().filter(|t| !t.is_empty()) {
                    turn.text.push_str(text);
                    self.emit(user, conv, "text_delta", json!({ "content": text }));
                }
                turn.fold_tool_calls(delta);
                if let Some(u) = delta.get("usage").filter(|u| u.is_object()) {
                    turn.usage = Some(u.clone());
                }
            }
            "llm_done" => {
                if let Some(u) = turn.usage.take() {
                    self.record_usage(agent, seq, user, &u).await?;
                }
                let text = std::mem::take(&mut turn.text);
                turn.index.clear();
                if !text.trim().is_empty() {
                    self.mirror(agent, seq, user, "assistant", &text, None).await?;
                    self.emit(user, conv, "text_done", json!({ "content": text }));
                }
                for (id, args) in std::mem::take(&mut turn.args) {
                    if let Some(reason) = call_reason(&args) {
                        turn.reasons.insert(id.clone(), reason);
                    }
                    if turn.calls.get(&id).is_some_and(|n| n == "connector.call_tool")
                        && let Ok(v) = serde_json::from_str::<Value>(&args)
                    {
                        turn.targets.insert(id, crate::hook::effective("connector.call_tool", &v).name);
                    }
                }
                let pending: Vec<(String, String)> = turn.calls.iter().map(|(id, name)| (id.clone(), name.clone())).collect();
                for (id, name) in &pending {
                    self.emit(user, conv, "tool_start", json!({ "name": name, "call_id": id, "reason": turn.reasons.get(id), "target": turn.targets.get(id) }));
                }
                if pending.is_empty() {
                    turn.thinking = false;
                    self.emit(user, conv, "done", json!({}));
                }
            }
            "tool_result" | "tool_aborted" => {
                let call = ev["call_id"].as_str().unwrap_or_default();
                if turn.questions.remove(call) {
                    let content = ev["content"].as_str().unwrap_or_default();
                    self.mirror(agent, seq, user, "answer", content, Some(json!({ "call_id": call, "is_error": ev["is_error"] }))).await?;
                } else if let Some(name) = turn.calls.remove(call) {
                    let reason = turn.reasons.remove(call);
                    let target = turn.targets.remove(call);
                    let check = self.check(agent, call).await?;
                    // A page the call made (an artifact, a service tool's view) shows with it.
                    let page = if ev["is_error"] == true { None } else { crate::artifacts::of_tool_result(&self.pool, conv, &name, ev["content"].as_str().unwrap_or_default()).await };
                    let data = json!({ "call_id": call, "is_error": ev["is_error"], "reason": reason, "target": target, "check": check, "artifact": page });
                    self.mirror(agent, seq, user, "tool", &name, Some(data.clone())).await?;
                    let mut end = data;
                    end["name"] = json!(name);
                    self.emit(user, conv, "tool_end", end);
                }
            }
            "client_tool_call" => {
                let (call, name, input) = (ev["call_id"].clone(), ev["name"].clone(), ev["input"].clone());
                let id = call.as_str().unwrap_or_default().to_string();
                turn.calls.remove(&id);
                turn.questions.insert(id);
                let data = json!({ "call_id": call, "toolName": name, "input": input });
                self.mirror(agent, seq, user, "question", input["question"].as_str().unwrap_or_default(), Some(data.clone())).await?;
                self.emit(user, conv, "question", data);
            }
            "approval_requested" => {
                let call = ev["call_id"].as_str().unwrap_or_default();
                let check = self.check(agent, call).await?;
                let agent_reason = turn.reasons.get(call).cloned().or_else(|| check.as_ref().and_then(|c| c["agent_reason"].as_str().map(String::from)));
                // The console's quote when the call buys something: the card
                // shows it and approving needs `confirm_purchase`.
                let purchase = check.as_ref().map(|c| c["purchase"].clone()).unwrap_or(Value::Null);
                let data = json!({ "call_id": ev["call_id"], "name": ev["name"], "input": ev["input"], "reason": ev["reason"], "agent_reason": agent_reason, "check": check, "purchase": purchase });
                self.mirror(agent, seq, user, "approval", ev["name"].as_str().unwrap_or_default(), Some(data.clone())).await?;
                self.emit(user, conv, "approval", data);
            }
            "llm_failed" => {
                turn.text.clear();
                self.emit(user, conv, "error", json!({ "message": "The assistant failed to answer. Please try again." }));
                tracing::error!(agent, "llm_failed: {}", ev["error"]);
            }
            "compacted" => {
                if let Some(u) = ev.get("usage").filter(|u| u.is_object()) {
                    self.record_usage(agent, seq, user, u).await?;
                }
            }
            "child_spawned" => {
                if let Some(child) = ev["id"].as_str() {
                    self.adopt(child, agent, user, conv).await?;
                }
            }
            "child_report" => {
                if let Some(child) = ev["id"].as_str() {
                    sqlx::query("UPDATE conversation_children SET finished_at = now() WHERE agent_id = $1").bind(child).execute(&self.pool).await?;
                    self.owners.1.write().await.remove(child);
                }
            }
            "cancelled" | "superseded" => {
                self.owners.0.write().await.remove(agent);
            }
            _ => {}
        }
        Ok(())
    }
}

/// The `_reason` the assistant gave a call (call_reasons), from its arguments
/// (connector calls may carry it inside `arguments`).
fn call_reason(args: &str) -> Option<String> {
    let v: Value = serde_json::from_str(args).ok()?;
    v["_reason"].as_str().or_else(|| v["arguments"]["_reason"].as_str()).filter(|r| !r.trim().is_empty()).map(String::from)
}

#[cfg(test)]
mod tests {
    #[test]
    fn reasons_from_arguments() {
        assert_eq!(super::call_reason(r#"{"_reason":"read the config","q":1}"#).as_deref(), Some("read the config"));
        assert_eq!(super::call_reason(r#"{"service":"s","arguments":{"_reason":"inner"}}"#).as_deref(), Some("inner"));
        assert_eq!(super::call_reason(r#"{"q":1}"#), None);
        assert_eq!(super::call_reason("{not json"), None);
    }

    #[test]
    fn tool_calls_fold_from_flat_and_nested_chunks() {
        use serde_json::json;
        let mut t = super::Turn::default();
        // subnet's shape: the call starts with id and name, then index-only chunks.
        t.fold_tool_calls(&json!({"tool_calls": [{"id": "a", "name": "connector.call_tool", "index": 0, "arguments": ""}, {"index": 0, "arguments": "{\"x\""}]}));
        t.fold_tool_calls(&json!({"tool_calls": [{"index": 0, "arguments": ":1}"}]}));
        // OpenAI's shape.
        t.fold_tool_calls(&json!({"tool_calls": [{"id": "b", "index": 1, "function": {"name": "skill_get", "arguments": "{}"}}]}));
        assert_eq!(t.calls.get("a").map(String::as_str), Some("connector.call_tool"));
        assert_eq!(t.args.get("a").map(String::as_str), Some("{\"x\":1}"));
        assert_eq!(t.calls.get("b").map(String::as_str), Some("skill_get"));
    }
}
