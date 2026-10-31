//! Conversations: one subagent-net agent per (user, mode).

use serde_json::{Value, json};
use uuid::Uuid;

use plan_ai_api_mcp::ApiError;

use crate::state::App;

const CONTEXT_OPEN: &str = "<context>\n";
const CONTEXT_CLOSE: &str = "\n</context>\n\n";

/// A user message without the context block this server prepends.
pub fn strip_context(content: &str) -> String {
    match content.strip_prefix(CONTEXT_OPEN).and_then(|rest| rest.split_once(CONTEXT_CLOSE)) {
        Some((_, msg)) => msg.to_string(),
        None => content.to_string(),
    }
}

fn with_context(context: &str, msg: &str) -> String {
    format!("{CONTEXT_OPEN}{context}{CONTEXT_CLOSE}{msg}")
}

fn language_name(code: &str) -> &'static str {
    match code {
        "de" => "German",
        _ => "English",
    }
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::error!("{e:#}");
    ApiError::internal(e.to_string())
}

/// The agent type for `mode`, or 404.
pub fn agent_type<'a>(app: &'a App, mode: &str) -> Result<&'a str, ApiError> {
    app.cfg.subnet.types.get(mode).map(String::as_str).ok_or_else(|| ApiError::not_found(format!("unknown chat mode {mode}")))
}

pub async fn current_agent(app: &App, user: Uuid, mode: &str) -> Result<Option<(String, bool)>, ApiError> {
    sqlx::query_as("SELECT agent_id, auto_approve FROM chat_agents WHERE user_id = $1 AND mode = $2")
        .bind(user)
        .bind(mode)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)
}

async fn require_agent(app: &App, user: Uuid, mode: &str) -> Result<String, ApiError> {
    current_agent(app, user, mode).await?.map(|(a, _)| a).ok_or_else(|| ApiError::not_found("no conversation in this mode"))
}

/// Rolling-hour budget, checked before each message.
async fn check_budget(app: &App, user: Uuid) -> Result<(), ApiError> {
    let (input, output): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(input_tokens),0)::bigint, COALESCE(SUM(output_tokens),0)::bigint
         FROM chat_token_usage WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
    )
    .bind(user)
    .fetch_one(&app.pool)
    .await
    .map_err(internal)?;
    if input >= app.cfg.chat.hourly_input_tokens || output >= app.cfg.chat.hourly_output_tokens {
        return Err(ApiError::payment_required("You've reached the hourly message limit. Please try again later."));
    }
    Ok(())
}

/// What the agent knows about the user when the conversation starts.
async fn initial_context(app: &App, user: Uuid, mode: &str, lang: &str) -> Result<String, ApiError> {
    let (email, name): (String, String) =
        sqlx::query_as("SELECT email, name FROM accounts.users WHERE id = $1").bind(user).fetch_one(&app.pool).await.map_err(internal)?;
    let extension: Option<String> = sqlx::query_scalar("SELECT content FROM system_prompt_extensions WHERE user_id = $1 AND mode = $2")
        .bind(user)
        .bind(mode)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?;
    let mut ctx = format!("User: {name} <{email}>\nReply in {}.", language_name(lang));
    if let Some(ext) = extension.filter(|e| !e.trim().is_empty()) {
        ctx.push_str("\n\nAdditional instructions for this user:\n");
        ctx.push_str(&ext);
    }
    Ok(ctx)
}

pub async fn send(app: &App, user: Uuid, mode: &str, text: &str, lang: &str) -> Result<(), ApiError> {
    let ty = agent_type(app, mode)?;
    let text = text.trim();
    if text.is_empty() {
        return Err(ApiError::bad_request("empty message"));
    }
    if text.chars().count() > app.cfg.chat.max_chars {
        return Err(ApiError::payload_too_large(format!("messages are limited to {} characters", app.cfg.chat.max_chars)));
    }
    check_budget(app, user).await?;
    match current_agent(app, user, mode).await? {
        Some((agent, _)) => {
            let msg = with_context(&format!("Reply in {}.", language_name(lang)), text);
            app.hub.send(&agent, &msg).await.map_err(internal)
        }
        None => {
            let prompt = with_context(&initial_context(app, user, mode, lang).await?, text);
            let agent = app.hub.spawn(ty, &prompt, &user.to_string()).await.map_err(internal)?;
            // Owners first: the spawn's events are already on their way.
            app.owners.insert(agent.clone(), user, mode.to_string()).await;
            sqlx::query("INSERT INTO chat_agents (user_id, mode, agent_id) VALUES ($1,$2,$3)")
                .bind(user)
                .bind(mode)
                .bind(&agent)
                .execute(&app.pool)
                .await
                .map_err(internal)?;
            Ok(())
        }
    }
}

/// The conversation so far, plus what it waits on.
pub async fn history(app: &App, user: Uuid, mode: &str) -> Result<Value, ApiError> {
    agent_type(app, mode)?;
    let Some((agent, auto_approve)) = current_agent(app, user, mode).await? else {
        return Ok(json!({ "messages": [], "pending": [] }));
    };
    let rows: Vec<(i64, String, String, Option<Value>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT id, role, content, data, created_at FROM chat_messages WHERE agent_id = $1 ORDER BY seq").bind(&agent).fetch_all(&app.pool).await.map_err(internal)?;
    let messages: Vec<Value> =
        rows.into_iter().map(|(id, role, content, data, at)| json!({ "id": id, "role": role, "content": content, "data": data, "at": at })).collect();
    // The agent's summary is flattened into its transcript.
    let t = app.hub.transcript(&agent).await.map_err(internal)?;
    Ok(json!({
        "messages": messages,
        "phase": t["phase"],
        "pending_questions": t["awaiting_client"],
        "pending_approvals": t["awaiting_approval"],
        "auto_approve": auto_approve,
    }))
}

/// The user's answer to a client tool call (ask_question, prompt_preference).
pub async fn answer(app: &App, user: Uuid, mode: &str, call_id: &str, content: Option<&str>) -> Result<(), ApiError> {
    let agent = require_agent(app, user, mode).await?;
    let args = match content {
        Some(c) => json!({ "id": agent, "call_id": call_id, "content": c }),
        None => json!({ "id": agent, "call_id": call_id, "content": "The user dismissed this question.", "is_error": true }),
    };
    app.hub.call("answer", args).await.map_err(internal).map(drop)
}

pub async fn approve(app: &App, user: Uuid, mode: &str, call_id: &str, approved: bool, reason: Option<String>, all: bool) -> Result<(), ApiError> {
    let agent = require_agent(app, user, mode).await?;
    if all && approved {
        sqlx::query("UPDATE chat_agents SET auto_approve = true WHERE agent_id = $1").bind(&agent).execute(&app.pool).await.map_err(internal)?;
    }
    app.hub.call("approve", json!({ "id": agent, "call_id": call_id, "approved": approved, "reason": reason })).await.map_err(internal).map(drop)
}

/// Ends the conversation; the next message starts a new one.
pub async fn reset(app: &App, user: Uuid, mode: &str) -> Result<(), ApiError> {
    let Some((agent, _)) = current_agent(app, user, mode).await? else { return Ok(()) };
    if let Err(e) = app.hub.call("cancel", json!({ "id": agent })).await {
        // Already gone on the hub is fine; anything else is not.
        if !e.to_string().contains("404") {
            return Err(internal(e));
        }
    }
    sqlx::query("DELETE FROM chat_agents WHERE agent_id = $1").bind(&agent).execute(&app.pool).await.map_err(internal)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_round_trips() {
        let msg = with_context("User: A <a@b>\nReply in German.", "Hallo\n<context>x</context>");
        assert_eq!(strip_context(&msg), "Hallo\n<context>x</context>");
        assert_eq!(strip_context("plain"), "plain");
    }
}
