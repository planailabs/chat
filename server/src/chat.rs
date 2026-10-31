//! Conversations: each one a subagent-net agent, many per user.

use serde::Serialize;
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

/// A conversation's title from its first message: one line, at most 60
/// characters, cut at a word.
pub fn title_from(text: &str) -> String {
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.chars().count() <= 60 {
        return line.to_string();
    }
    let cut: String = line.chars().take(60).collect();
    let cut = cut.rsplit_once(' ').map(|(head, _)| head).filter(|h| h.len() > 20).unwrap_or(&cut);
    format!("{}…", cut.trim_end())
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::error!("{e:#}");
    ApiError::internal(e.to_string())
}

#[derive(Serialize, schemars::JsonSchema, sqlx::FromRow)]
pub struct Conversation {
    pub id: Uuid,
    pub title: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list(app: &App, user: Uuid) -> Result<Vec<Conversation>, ApiError> {
    sqlx::query_as("SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC")
        .bind(user)
        .fetch_all(&app.pool)
        .await
        .map_err(internal)
}

/// Highlight markers in search snippets: U+E000 opens, U+E001 closes.
/// Private-use characters never occur in text, so a client escapes the
/// snippet and turns only these into markup.
pub const MARK_OPEN: char = '\u{E000}';
pub const MARK_CLOSE: char = '\u{E001}';

/// `q` as a prefix query: every word must match the start of a word
/// (`plan ser` finds "plan.ai server"). None when nothing searchable is left.
pub fn prefix_query(q: &str) -> Option<String> {
    let words: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(8)
        .map(|w| format!("{}:*", w.to_lowercase()))
        .collect();
    (!words.is_empty()).then(|| words.join(" & "))
}

#[derive(Serialize, schemars::JsonSchema, sqlx::FromRow)]
pub struct Hit {
    pub conversation: Uuid,
    pub title: String,
    /// The matching message; None when the title matched.
    pub message_id: Option<i64>,
    /// `user` or `assistant` (None for a title match).
    pub role: Option<String>,
    /// Text around the match; matches between U+E000 and U+E001.
    pub snippet: String,
    pub at: chrono::DateTime<chrono::Utc>,
}

/// Full-text search over the user's own conversations: their titles and
/// what the user and the assistant said. Best matches first, at most 50.
pub async fn search(app: &App, user: Uuid, q: &str) -> Result<Vec<Hit>, ApiError> {
    search_in(app, user, q, None, None).await
}

/// `search`, optionally within one conversation (`only`) or leaving out the
/// one an agent runs in (`except_agent`).
pub async fn search_in(app: &App, user: Uuid, q: &str, only: Option<Uuid>, except_agent: Option<&str>) -> Result<Vec<Hit>, ApiError> {
    let Some(query) = prefix_query(q) else { return Ok(vec![]) };
    let options = format!("StartSel={MARK_OPEN}, StopSel={MARK_CLOSE}, MaxFragments=1, MaxWords=24, MinWords=8");
    sqlx::query_as(
        "WITH q AS (SELECT to_tsquery('simple', $2) AS q)
         SELECT conversation, title, message_id, role, snippet, at FROM (
           SELECT c.id AS conversation, c.title, NULL::bigint AS message_id, NULL::text AS role,
                  ts_headline('simple', c.title, q.q, $3) AS snippet, c.updated_at AS at,
                  ts_rank(to_tsvector('simple', c.title), q.q) + 1 AS rank
           FROM q, conversations c
           WHERE c.user_id = $1 AND ($4::uuid IS NULL OR c.id = $4) AND ($5::text IS NULL OR c.agent_id <> $5)
             AND to_tsvector('simple', c.title) @@ q.q
           UNION ALL
           SELECT c.id, c.title, m.id, m.role,
                  ts_headline('simple', m.content, q.q, $3), m.created_at,
                  ts_rank(to_tsvector('simple', m.content), q.q)
           FROM q, chat_messages m JOIN conversations c ON c.agent_id = m.agent_id
           WHERE c.user_id = $1 AND ($4::uuid IS NULL OR c.id = $4) AND ($5::text IS NULL OR c.agent_id <> $5)
             AND m.role IN ('user', 'assistant') AND to_tsvector('simple', m.content) @@ q.q
         ) hits ORDER BY rank DESC, at DESC LIMIT 50",
    )
    .bind(user)
    .bind(query)
    .bind(options)
    .bind(only)
    .bind(except_agent)
    .fetch_all(&app.pool)
    .await
    .map_err(internal)
}

#[derive(Serialize, schemars::JsonSchema, sqlx::FromRow)]
pub struct Excerpt {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub at: chrono::DateTime<chrono::Utc>,
}

/// Messages of the user's conversation `id` said by the user or the
/// assistant: up to `limit` from its start, or around `message`.
pub async fn excerpt(app: &App, user: Uuid, id: Uuid, message: Option<i64>, limit: i64) -> Result<(String, Vec<Excerpt>), ApiError> {
    let (agent, _) = owned(app, user, id).await?;
    let title: String = sqlx::query_scalar("SELECT title FROM conversations WHERE id = $1").bind(id).fetch_one(&app.pool).await.map_err(internal)?;
    let limit = limit.clamp(1, 50);
    let rows = sqlx::query_as(
        "SELECT id, role, content, created_at AS at FROM chat_messages
         WHERE agent_id = $1 AND role IN ('user', 'assistant')
           AND ($2::bigint IS NULL OR seq >= (SELECT seq FROM chat_messages WHERE id = $2 AND agent_id = $1) - $3 / 2)
         ORDER BY seq LIMIT $3",
    )
    .bind(&agent)
    .bind(message)
    .bind(limit)
    .fetch_all(&app.pool)
    .await
    .map_err(internal)?;
    Ok((title, rows))
}

/// The user's conversation `id`: (agent, auto_approve), or 404.
async fn owned(app: &App, user: Uuid, id: Uuid) -> Result<(String, bool), ApiError> {
    sqlx::query_as("SELECT agent_id, auto_approve FROM conversations WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found("no such conversation"))
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

/// What the agent knows about the user when a conversation starts.
async fn initial_context(app: &App, user: Uuid, lang: &str) -> Result<String, ApiError> {
    let (email, name): (String, String) =
        sqlx::query_as("SELECT email, name FROM accounts.users WHERE id = $1").bind(user).fetch_one(&app.pool).await.map_err(internal)?;
    let extension: Option<String> =
        sqlx::query_scalar("SELECT content FROM prompt_extensions WHERE user_id = $1").bind(user).fetch_optional(&app.pool).await.map_err(internal)?;
    let mut ctx = format!("User: {name} <{email}>\nReply in {}.", language_name(lang));
    if let Some(ext) = extension.filter(|e| !e.trim().is_empty()) {
        ctx.push_str("\n\nAdditional instructions for this user:\n");
        ctx.push_str(&ext);
    }
    Ok(ctx)
}

/// Sends `text` into conversation `id`, or starts a new one. Returns its id.
pub async fn send(app: &App, user: Uuid, id: Option<Uuid>, text: &str, lang: &str) -> Result<Uuid, ApiError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(ApiError::bad_request("empty message"));
    }
    if text.chars().count() > app.cfg.chat.max_chars {
        return Err(ApiError::payload_too_large(format!("messages are limited to {} characters", app.cfg.chat.max_chars)));
    }
    check_budget(app, user).await?;
    if let Some(id) = id {
        let (agent, _) = owned(app, user, id).await?;
        let msg = with_context(&format!("Reply in {}.", language_name(lang)), text);
        app.hub.send(&agent, &msg).await.map_err(internal)?;
        sqlx::query("UPDATE conversations SET updated_at = now() WHERE id = $1").bind(id).execute(&app.pool).await.map_err(internal)?;
        return Ok(id);
    }
    let prompt = with_context(&initial_context(app, user, lang).await?, text);
    let id = Uuid::new_v4();
    let agent = app.hub.spawn(&app.cfg.subnet.agent_type, &prompt, &user.to_string()).await.map_err(internal)?;
    // Owners right away: the spawn's events are already on their way.
    app.owners.insert(agent.clone(), user, id).await;
    sqlx::query("INSERT INTO conversations (id, user_id, agent_id, title) VALUES ($1,$2,$3,$4)")
        .bind(id)
        .bind(user)
        .bind(&agent)
        .bind(title_from(text))
        .execute(&app.pool)
        .await
        .map_err(internal)?;
    // The prompt is the agent's first event (seq 1), which usually reaches the
    // pump before the agent is known as ours: mirror it here; the pump's own
    // insert, if it got there, is the same row.
    sqlx::query("INSERT INTO chat_messages (agent_id, seq, user_id, role, content) VALUES ($1, 1, $2, 'user', $3) ON CONFLICT (agent_id, seq) DO NOTHING")
        .bind(&agent)
        .bind(user)
        .bind(text)
        .execute(&app.pool)
        .await
        .map_err(internal)?;
    Ok(id)
}

/// The conversation so far, plus what it waits on.
pub async fn history(app: &App, user: Uuid, id: Uuid) -> Result<Value, ApiError> {
    let (agent, auto_approve) = owned(app, user, id).await?;
    let title: String = sqlx::query_scalar("SELECT title FROM conversations WHERE id = $1").bind(id).fetch_one(&app.pool).await.map_err(internal)?;
    let rows: Vec<(i64, String, String, Option<Value>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT id, role, content, data, created_at FROM chat_messages WHERE agent_id = $1 ORDER BY seq").bind(&agent).fetch_all(&app.pool).await.map_err(internal)?;
    let messages: Vec<Value> =
        rows.into_iter().map(|(id, role, content, data, at)| json!({ "id": id, "role": role, "content": content, "data": data, "at": at })).collect();
    // The agent's summary is flattened into its transcript.
    let t = app.hub.transcript(&agent).await.map_err(internal)?;
    Ok(json!({
        "id": id,
        "title": title,
        "messages": messages,
        "phase": t["phase"],
        "pending_questions": t["awaiting_client"],
        "pending_approvals": t["awaiting_approval"],
        "auto_approve": auto_approve,
    }))
}

/// The user's answer to a client tool call (ask_question, prompt_preference).
pub async fn answer(app: &App, user: Uuid, id: Uuid, call_id: &str, content: Option<&str>) -> Result<(), ApiError> {
    let (agent, _) = owned(app, user, id).await?;
    let args = match content {
        Some(c) => json!({ "id": agent, "call_id": call_id, "content": c }),
        None => json!({ "id": agent, "call_id": call_id, "content": "The user dismissed this question.", "is_error": true }),
    };
    app.hub.call("answer", args).await.map_err(internal).map(drop)
}

pub async fn approve(app: &App, user: Uuid, id: Uuid, call_id: &str, approved: bool, reason: Option<String>, all: bool) -> Result<(), ApiError> {
    let (agent, _) = owned(app, user, id).await?;
    if all && approved {
        sqlx::query("UPDATE conversations SET auto_approve = true WHERE id = $1").bind(id).execute(&app.pool).await.map_err(internal)?;
    }
    app.hub.call("approve", json!({ "id": agent, "call_id": call_id, "approved": approved, "reason": reason })).await.map_err(internal).map(drop)
}

pub async fn rename(app: &App, user: Uuid, id: Uuid, title: &str) -> Result<(), ApiError> {
    owned(app, user, id).await?;
    let title: String = title.trim().chars().take(120).collect();
    sqlx::query("UPDATE conversations SET title = $2 WHERE id = $1").bind(id).bind(title).execute(&app.pool).await.map_err(internal).map(drop)
}

/// Deletes the conversation and its messages; its agent is cancelled.
pub async fn delete(app: &App, user: Uuid, id: Uuid) -> Result<(), ApiError> {
    let (agent, _) = owned(app, user, id).await?;
    if let Err(e) = app.hub.call("cancel", json!({ "id": agent })).await {
        // Already gone on the hub is fine; anything else is not.
        if !e.to_string().contains("404") {
            return Err(internal(e));
        }
    }
    let mut tx = app.pool.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM chat_messages WHERE agent_id = $1").bind(&agent).execute(&mut *tx).await.map_err(internal)?;
    sqlx::query("DELETE FROM conversations WHERE id = $1").bind(id).execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)
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

    #[test]
    fn prefix_queries() {
        assert_eq!(prefix_query("plan.ai Server!").as_deref(), Some("plan:* & ai:* & server:*"));
        assert_eq!(prefix_query("Größe"), Some("größe:*".into()));
        assert_eq!(prefix_query(" ' & | ! "), None);
    }

    #[test]
    fn titles() {
        assert_eq!(title_from("\n  Hello there  \nsecond line"), "Hello there");
        let long = "Please help me configure the skills on my plan.ai machine for a law firm";
        let t = title_from(long);
        assert!(t.ends_with('…') && t.chars().count() <= 61, "{t}");
        assert!(!t.contains("law"), "{t}");
    }
}
