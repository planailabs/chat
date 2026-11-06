//! The conversation's workers (sub-agents) for the browser: the list with
//! their state, a worker's own transcript, stopping one, and following up
//! with a message to it. Only the conversation's owner reaches them.

use plan_ai_api_mcp::ApiError;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::state::App;

fn internal(e: impl std::fmt::Display) -> ApiError {
    let reference = &Uuid::new_v4().simple().to_string()[..8];
    tracing::error!(reference, "{e:#}");
    ApiError::internal(format!("Something went wrong on our side (reference {reference})."))
}

#[derive(Serialize)]
pub struct Worker {
    pub id: String,
    pub task: Option<String>,
    /// running, waiting (for the user's approval), done, failed, stopped, paused
    pub state: &'static str,
    pub tokens: u64,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub error: Option<String>,
}

/// What the user sees of an agent's summary.
pub fn state_of(summary: &Value, finished: bool) -> &'static str {
    let phase = summary["phase"].as_str().unwrap_or_default();
    if summary["superseded_by"].is_string() || phase == "cancelled" {
        return "stopped";
    }
    if phase == "failed" {
        return "failed";
    }
    if summary["awaiting_approval"].is_object() {
        return "waiting";
    }
    if summary["paused"] == true {
        return "paused";
    }
    match phase {
        "idle" if finished => "done",
        "idle" => "done",
        "" => if finished { "done" } else { "running" },
        _ => "running",
    }
}

async fn owned_conversation(app: &App, user: Uuid, id: Uuid) -> Result<(), ApiError> {
    let ok: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2)").bind(id).bind(user).fetch_one(&app.pool).await.map_err(internal)?;
    if ok { Ok(()) } else { Err(ApiError::not_found("no such conversation")) }
}

/// The worker, if it's one of the user's.
async fn owned_worker(app: &App, user: Uuid, agent: &str) -> Result<Uuid, ApiError> {
    sqlx::query_scalar("SELECT c.id FROM conversation_children k JOIN conversations c ON c.id = k.conversation_id WHERE k.agent_id = $1 AND c.user_id = $2")
        .bind(agent)
        .bind(user)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found("no such worker"))
}

pub async fn list(app: &App, user: Uuid, conversation: Uuid) -> Result<Vec<Worker>, ApiError> {
    owned_conversation(app, user, conversation).await?;
    let rows: Vec<(String, Option<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)> =
        sqlx::query_as("SELECT agent_id, task, created_at, finished_at FROM conversation_children WHERE conversation_id = $1 ORDER BY created_at").bind(conversation).fetch_all(&app.pool).await.map_err(internal)?;
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let agents = app.hub.call("list_agents", json!({})).await.map_err(internal)?;
    let summary = |id: &str| agents.as_array().into_iter().flatten().find(|a| a["id"] == id).cloned().unwrap_or(Value::Null);
    Ok(rows
        .into_iter()
        .map(|(id, task, started_at, finished_at)| {
            let s = summary(&id);
            let usage = &s["usage"];
            let tokens = usage["prompt_tokens"].as_u64().unwrap_or(0) + usage["completion_tokens"].as_u64().unwrap_or(0);
            Worker { state: state_of(&s, finished_at.is_some()), tokens, error: s["error"].as_str().map(String::from), id, task, started_at, finished_at }
        })
        .collect())
}

/// One step of a worker's transcript as the chat shows it.
#[derive(Serialize, Debug, PartialEq)]
pub struct Step {
    /// task, text, tool, result, message
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
}

fn content_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

fn cut(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max).collect::<String>()) }
}

/// The hub's transcript as steps: the task, the worker's words, its tool
/// calls (with their reason) and results (cut short), later messages.
pub fn steps(transcript: &Value) -> Vec<Step> {
    let mut out = vec![];
    for (i, m) in transcript["messages"].as_array().into_iter().flatten().enumerate() {
        match m["role"].as_str() {
            Some("user") => {
                let text = content_text(&m["content"]);
                out.push(Step { kind: if i <= 1 && out.is_empty() { "task" } else { "message" }, text, tool: None });
            }
            Some("assistant") => {
                let text = content_text(&m["content"]);
                if !text.trim().is_empty() {
                    out.push(Step { kind: "text", text, tool: None });
                }
                for c in m["tool_calls"].as_array().into_iter().flatten() {
                    let name = c["function"]["name"].as_str().unwrap_or_default().to_string();
                    let args: Value = c["function"]["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
                    let label = if name == "connector.call_tool" {
                        format!("{}.{}", args["service"].as_str().unwrap_or("?"), args["tool"].as_str().unwrap_or("?"))
                    } else {
                        name
                    };
                    out.push(Step { kind: "tool", text: args["_reason"].as_str().unwrap_or_default().to_string(), tool: Some(label) });
                }
            }
            Some("tool") => out.push(Step { kind: "result", text: cut(&content_text(&m["content"]), 600), tool: None }),
            _ => {}
        }
    }
    out
}

pub async fn transcript(app: &App, user: Uuid, agent: &str) -> Result<Value, ApiError> {
    owned_worker(app, user, agent).await?;
    let t = app.hub.transcript(agent).await.map_err(internal)?;
    Ok(json!({ "id": agent, "steps": steps(&t), "phase": t["phase"] }))
}

pub async fn stop(app: &App, user: Uuid, agent: &str) -> Result<Value, ApiError> {
    let conversation = owned_worker(app, user, agent).await?;
    app.hub.call("cancel", json!({ "id": agent })).await.map_err(internal)?;
    let _ = app.events.send(crate::subnet::BrowserEvent { user, name: "worker", data: json!({ "conversation": conversation, "agent": agent }) });
    Ok(json!({}))
}

#[derive(Deserialize)]
pub struct MessageInput {
    pub text: String,
}

/// Follows up with a worker (it gets the message as the user's).
pub async fn message(app: &App, user: Uuid, agent: &str, i: MessageInput) -> Result<Value, ApiError> {
    owned_worker(app, user, agent).await?;
    let text = i.text.trim();
    if text.is_empty() || text.chars().count() > app.cfg.chat.max_chars {
        return Err(ApiError::bad_request(format!("1 to {} characters", app.cfg.chat.max_chars)));
    }
    crate::chat::check_budget(app, user).await?;
    app.hub.send(agent, &format!("[From the user, directly to you] {text}")).await.map_err(internal)?;
    // Working again: it reports again when done.
    sqlx::query("UPDATE conversation_children SET finished_at = NULL WHERE agent_id = $1").bind(agent).execute(&app.pool).await.map_err(internal)?;
    Ok(json!({}))
}

mod http {
    use axum::extract::{Extension, Path, State};
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use plan_ai_api_mcp::{ApiError, SessionPrincipal};
    use serde_json::Value;
    use uuid::Uuid;

    use crate::state::AppState;

    type Out = Result<Json<Value>, ApiError>;

    fn user(p: &Option<Extension<SessionPrincipal>>, write: bool) -> Result<Uuid, ApiError> {
        let Some(Extension(p)) = p else { return Err(ApiError::unauthorized("sign in first")) };
        if write {
            crate::api::require_not_impersonating(&p.0)?;
        }
        crate::api::user_of(&p.0)
    }

    async fn list(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>) -> Out {
        Ok(Json(serde_json::to_value(super::list(&app, user(&p, false)?, id).await?).unwrap_or_default()))
    }
    async fn transcript(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(agent): Path<String>) -> Out {
        super::transcript(&app, user(&p, false)?, &agent).await.map(Json)
    }
    async fn stop(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(agent): Path<String>) -> Out {
        super::stop(&app, user(&p, true)?, &agent).await.map(Json)
    }
    async fn message(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(agent): Path<String>, Json(i): Json<super::MessageInput>) -> Out {
        super::message(&app, user(&p, true)?, &agent, i).await.map(Json)
    }

    pub fn routes(app: AppState) -> Router {
        Router::new()
            .route("/api/v1/conversations/{id}/workers", get(list))
            .route("/api/v1/workers/{agent}", get(transcript))
            .route("/api/v1/workers/{agent}/stop", post(stop))
            .route("/api/v1/workers/{agent}/message", post(message))
            .with_state(app)
    }
}

pub use http::routes;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states() {
        assert_eq!(state_of(&json!({ "phase": "tools" }), false), "running");
        assert_eq!(state_of(&json!({ "phase": "tools", "awaiting_approval": { "id": "c" } }), false), "waiting");
        assert_eq!(state_of(&json!({ "phase": "idle" }), true), "done");
        assert_eq!(state_of(&json!({ "phase": "failed", "error": "x" }), false), "failed");
        assert_eq!(state_of(&json!({ "phase": "cancelled" }), false), "stopped");
        assert_eq!(state_of(&json!({ "phase": "thinking", "paused": true }), false), "paused");
        assert_eq!(state_of(&Value::Null, true), "done", "gone from the hub after finishing");
    }

    #[test]
    fn transcript_steps() {
        let t = json!({ "messages": [
            { "role": "system", "content": "you are a worker" },
            { "role": "user", "content": "Count the services" },
            { "role": "assistant", "content": "", "tool_calls": [{ "id": "a", "function": { "name": "connector.call_tool", "arguments": "{\"service\":\"vpn\",\"tool\":\"device_list\",\"_reason\":\"see devices\"}" } }] },
            { "role": "tool", "tool_call_id": "a", "content": "[1,2,3]" },
            { "role": "assistant", "content": "There are 3." },
        ] });
        let s = steps(&t);
        assert_eq!(s[0], Step { kind: "task", text: "Count the services".into(), tool: None });
        assert_eq!(s[1], Step { kind: "tool", text: "see devices".into(), tool: Some("vpn.device_list".into()) });
        assert_eq!(s[2].kind, "result");
        assert_eq!(s[3], Step { kind: "text", text: "There are 3.".into(), tool: None });
    }
}
