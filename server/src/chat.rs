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

/// A failure on our side: the details go to the log under a reference the
/// client gets instead of them (SQL, the hub's answers aren't for clients).
fn internal(e: impl std::fmt::Display) -> ApiError {
    let reference = &uuid::Uuid::new_v4().simple().to_string()[..8];
    tracing::error!(reference, "{e:#}");
    ApiError::internal(format!("Something went wrong on our side (reference {reference})."))
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
           FROM q, chat_messages m JOIN conversations c ON m.agent_id = c.agent_id OR m.agent_id = ANY(c.previous_agents)
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
    owned(app, user, id).await?;
    let title: String = sqlx::query_scalar("SELECT title FROM conversations WHERE id = $1").bind(id).fetch_one(&app.pool).await.map_err(internal)?;
    let agents = agents_of(app, id).await?;
    let limit = limit.clamp(1, 50);
    let rows = sqlx::query_as(
        "WITH said AS (
           SELECT id, role, content, created_at, row_number() OVER (ORDER BY id) AS n FROM chat_messages
           WHERE agent_id = ANY($1) AND role IN ('user', 'assistant'))
         SELECT id, role, content, created_at AS at FROM said
         WHERE $2::bigint IS NULL OR n >= (SELECT n FROM said WHERE id = $2) - $3 / 2
         ORDER BY n LIMIT $3",
    )
    .bind(&agents)
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

/// Every agent the conversation has had (older ones first, after upgrades).
/// The conversation an agent works for (its own, or its parent's for a
/// sub-agent): `$1` the agent; columns id, user_id, auto_approve.
pub const CONVERSATION_OF_AGENT: &str = "SELECT c.id, c.user_id, c.auto_approve FROM conversations c WHERE c.agent_id = $1
     UNION ALL SELECT c.id, c.user_id, c.auto_approve FROM conversation_children k JOIN conversations c ON c.id = k.conversation_id WHERE k.agent_id = $1
     LIMIT 1";

/// Every agent of a conversation: its current one, the ones upgrades
/// replaced, and the sub-agents they spawned.
async fn agents_of(app: &App, id: Uuid) -> Result<Vec<String>, ApiError> {
    sqlx::query_scalar(
        "SELECT (c.previous_agents || c.agent_id) || COALESCE((SELECT array_agg(k.agent_id) FROM conversation_children k WHERE k.conversation_id = c.id), '{}')
         FROM conversations c WHERE c.id = $1",
    )
    .bind(id)
    .fetch_one(&app.pool)
    .await
    .map_err(internal)
}

/// The conversation's agent, upgraded first when it runs an outdated version
/// of its type (after the cluster changed; subnet resumes it only then). The
/// upgrade copies its history into a new agent, which the conversation
/// follows from here on.
async fn live_agent(app: &App, user: Uuid, id: Uuid) -> Result<String, ApiError> {
    let (agent, _) = owned(app, user, id).await?;
    let t = app.hub.transcript(&agent).await.map_err(internal)?;
    if t["outdated"] != true {
        return Ok(agent);
    }
    upgrade(app, user, id, &agent).await
}

/// At start: upgrades every conversation agent the cluster left outdated, so
/// conversations waiting mid-turn go on without the user sending again.
pub async fn upgrade_outdated(app: &App) -> anyhow::Result<()> {
    let agents = app.hub.call("list_agents", json!({})).await?;
    let ours: Vec<(Uuid, Uuid, String)> = sqlx::query_as("SELECT user_id, id, agent_id FROM conversations").fetch_all(&app.pool).await?;
    for a in agents.as_array().into_iter().flatten().filter(|a| a["outdated"] == true && a["phase"] != "cancelled") {
        let Some((user, id, agent)) = ours.iter().find(|(_, _, ag)| a["id"] == ag.as_str()) else { continue };
        if let Err(e) = upgrade(app, *user, *id, agent).await {
            // Right after a deploy the node may not offer the new agent yet: the caller retries.
            if e.to_string().contains("no live node offers") {
                anyhow::bail!("{e}");
            }
            tracing::error!(conversation = %id, agent, "upgrading an outdated agent: {e}");
        }
    }
    Ok(())
}

async fn upgrade(app: &App, user: Uuid, id: Uuid, agent: &str) -> Result<String, ApiError> {
    let agent = agent.to_string();
    let up = app.hub.call("upgrade", json!({ "id": agent })).await.map_err(internal)?;
    let new = up["id"].as_str().ok_or_else(|| internal(format!("upgrade of {agent} returned no id: {up}")))?.to_string();
    // Its log up to now is the copied history: mirrored already.
    let copied = app.hub.transcript(&new).await.map_err(internal)?["seq"].as_i64().unwrap_or(0);
    sqlx::query("UPDATE conversations SET previous_agents = previous_agents || agent_id, agent_id = $2, mirror_from_seq = $3 WHERE id = $1")
        .bind(id)
        .bind(&new)
        .bind(copied)
        .execute(&app.pool)
        .await
        .map_err(internal)?;
    app.owners.insert(new.clone(), user, id, copied).await;
    tracing::info!(conversation = %id, old = agent, new, "upgraded an outdated conversation agent");
    Ok(new)
}

/// A user's plan (their personal team's) and its rolling-hour token budget.
#[derive(Serialize, schemars::JsonSchema)]
pub struct Budget {
    pub plan_id: String,
    pub plan_name: String,
    /// Tokens per rolling hour; 0 = unlimited.
    pub hourly_input_tokens: u64,
    pub hourly_output_tokens: u64,
    /// Used in the last hour. Cache hits count a tenth (see [`CACHED_INPUT_DIVISOR`]).
    pub used_input_tokens: u64,
    pub used_output_tokens: u64,
}

impl Budget {
    pub(crate) fn exhausted(&self) -> bool {
        let over = |limit: u64, used: u64| limit > 0 && used >= limit;
        over(self.hourly_input_tokens, self.used_input_tokens) || over(self.hourly_output_tokens, self.used_output_tokens)
    }
}

/// A cached input token weighs this much less than a fresh one against the
/// hourly budget: providers bill cache reads at about a tenth of fresh input,
/// and a conversation re-reads its whole history on every turn.
pub const CACHED_INPUT_DIVISOR: i64 = 10;

pub async fn budget(app: &App, user: Uuid) -> Result<Budget, ApiError> {
    let u = app.accounts.user(user).await?.ok_or_else(|| ApiError::not_found("no such user"))?;
    let team = app.accounts.personal_team(&u).await?;
    let plan = app.accounts.plan(&team.plan_id).await?.ok_or_else(|| internal(format!("team {} is on unknown plan {}", team.id, team.plan_id)))?;
    let (input, output): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(GREATEST(input_tokens - cached_tokens, 0) + cached_tokens / $2::float8),0)::bigint,
                COALESCE(SUM(output_tokens),0)::bigint
         FROM chat_token_usage WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
    )
    .bind(user)
    .bind(CACHED_INPUT_DIVISOR as f64)
    .fetch_one(&app.pool)
    .await
    .map_err(internal)?;
    let limit = |d: &str| plan.limits.get(d).copied().unwrap_or(0);
    Ok(Budget {
        hourly_input_tokens: limit(crate::config::HOURLY_INPUT),
        hourly_output_tokens: limit(crate::config::HOURLY_OUTPUT),
        plan_id: plan.id,
        plan_name: plan.name,
        used_input_tokens: input as u64,
        used_output_tokens: output as u64,
    })
}

/// Rolling-hour budget of the user's plan, checked before each message.
pub(crate) async fn check_budget(app: &App, user: Uuid) -> Result<(), ApiError> {
    if budget(app, user).await?.exhausted() {
        return Err(ApiError::payment_required("You've reached the hourly message limit of your plan. Please try again later."));
    }
    Ok(())
}

/// What the agent knows about the user when a conversation starts.
async fn initial_context(app: &App, user: Uuid, lang: &str) -> Result<String, ApiError> {
    let (email, name): (String, String) =
        sqlx::query_as("SELECT email, name FROM accounts.users WHERE id = $1").bind(user).fetch_one(&app.pool).await.map_err(internal)?;
    let extension: Option<String> =
        sqlx::query_scalar("SELECT content FROM prompt_extensions WHERE user_id = $1").bind(user).fetch_optional(&app.pool).await.map_err(internal)?;
    // Any newsletter answer (in chat or settings) means: don't offer it again.
    let newsletter_answered: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM newsletter_events WHERE user_id = $1)")
        .bind(user)
        .fetch_one(&app.pool)
        .await
        .map_err(internal)?;
    let newsletter = if newsletter_answered { "already answered, don't offer it" } else { "not asked yet" };
    let mut ctx = format!("User: {name} <{email}>\nReply in {}.\nNewsletter: {newsletter}.", language_name(lang));
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
        let agent = live_agent(app, user, id).await?;
        let mut context = format!("Reply in {}.", language_name(lang));
        if let Some(reports) = crate::artifacts::take_model_context(app, id).await? {
            context.push_str("\n\n");
            context.push_str(&reports);
        }
        let msg = with_context(&context, text);
        app.hub.send(&agent, &msg).await.map_err(internal)?;
        sqlx::query("UPDATE conversations SET updated_at = now() WHERE id = $1").bind(id).execute(&app.pool).await.map_err(internal)?;
        return Ok(id);
    }
    let prompt = with_context(&initial_context(app, user, lang).await?, text);
    let id = Uuid::new_v4();
    let agent = app.hub.spawn(&app.cfg.subnet.agent_type, &prompt, &user.to_string()).await.map_err(internal)?;
    // Owners right away: the spawn's events are already on their way.
    app.owners.insert(agent.clone(), user, id, 0).await;
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
    let agents = agents_of(app, id).await?;
    let rows: Vec<(i64, String, String, Option<Value>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT id, role, content, data, created_at FROM chat_messages WHERE agent_id = ANY($1) ORDER BY id").bind(&agents).fetch_all(&app.pool).await.map_err(internal)?;
    let messages: Vec<Value> =
        rows.into_iter().map(|(id, role, content, data, at)| json!({ "id": id, "role": role, "content": content, "data": data, "at": at })).collect();
    // The agent's summary is flattened into its transcript.
    let t = app.hub.transcript(&agent).await.map_err(internal)?;
    // Sub-agents still at work may wait on the user too.
    let mut waiting = raw_approvals(&t["awaiting_approval"]);
    let open: Vec<String> = sqlx::query_scalar("SELECT agent_id FROM conversation_children WHERE conversation_id = $1 AND finished_at IS NULL").bind(id).fetch_all(&app.pool).await.map_err(internal)?;
    for child in open {
        match app.hub.transcript(&child).await {
            Ok(ct) => waiting.extend(raw_approvals(&ct["awaiting_approval"])),
            Err(e) => tracing::warn!(child, "a sub-agent's transcript: {e:#}"),
        }
    }
    Ok(json!({
        "id": id,
        "title": title,
        "messages": messages,
        "phase": t["phase"],
        // Lists, never null: subnet leaves the field out when nothing waits.
        "pending_questions": if t["awaiting_client"].is_array() { t["awaiting_client"].clone() } else { json!([]) },
        "pending_approvals": pending_approvals(app, &Value::Array(waiting), &agents).await?,
        "auto_approve": auto_approve,
    }))
}

/// The call an agent waits on approval for, shaped like the live `approval`
/// event: subnet's summary has it as one raw tool call (`{id, function:
/// {name, arguments}}`) or null; the mirrored `approval` row carries what the
/// hook added (its reason, the assistant's, the safety check).
async fn pending_approvals(app: &App, raw: &Value, agents: &[String]) -> Result<Value, ApiError> {
    let mut out = vec![];
    for c in raw_approvals(raw) {
        let call_id = c["call_id"].as_str().unwrap_or_default().to_string();
        let mirrored: Option<Value> = sqlx::query_scalar("SELECT data FROM chat_messages WHERE agent_id = ANY($1) AND role = 'approval' AND data->>'call_id' = $2 ORDER BY id DESC LIMIT 1")
            .bind(agents)
            .bind(&call_id)
            .fetch_optional(&app.pool)
            .await
            .map_err(internal)?
            .flatten();
        let mut approval = mirrored.unwrap_or(c);
        // Always from the hook's record, so a call that only has subnet's raw
        // shape still shows (and requires confirming) its purchase.
        approval["purchase"] = purchase_of(app, agents, &call_id).await?.unwrap_or(Value::Null);
        out.push(approval);
    }
    Ok(Value::Array(out))
}

/// subnet's `awaiting_approval` (null, one raw tool call, or a list) as
/// approval-event-shaped values without the hook's additions.
fn raw_approvals(raw: &Value) -> Vec<Value> {
    let calls: Vec<&Value> = match raw {
        Value::Array(a) => a.iter().collect(),
        Value::Null => vec![],
        one => vec![one],
    };
    calls
        .into_iter()
        .map(|c| {
            let args = c["function"]["arguments"].as_str().and_then(|a| serde_json::from_str::<Value>(a).ok()).unwrap_or(Value::Null);
            json!({
                "call_id": c["id"].as_str().or_else(|| c["call_id"].as_str()),
                "name": c["function"]["name"],
                "input": args,
                "reason": null,
                "agent_reason": null,
                "check": null,
                "purchase": null,
            })
        })
        .collect()
}

/// The user's answer to a client tool call (ask_question, prompt_preference).
pub async fn answer(app: &App, user: Uuid, id: Uuid, call_id: &str, content: Option<&str>) -> Result<(), ApiError> {
    let agent = live_agent(app, user, id).await?;
    let args = match content {
        Some(c) => json!({ "id": agent, "call_id": call_id, "content": c }),
        None => json!({ "id": agent, "call_id": call_id, "content": "The user dismissed this question.", "is_error": true }),
    };
    app.hub.call("answer", args).await.map_err(internal).map(drop)
}

/// The quote the approval hook recorded for a call that buys something.
async fn purchase_of(app: &App, agents: &[String], call_id: &str) -> Result<Option<Value>, ApiError> {
    sqlx::query_scalar("SELECT purchase FROM approval_checks WHERE agent_id = ANY($1) AND call_id = $2 AND purchase IS NOT NULL")
        .bind(agents)
        .bind(call_id)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)
        .map(Option::flatten)
}

/// Whether approving sets "approve all": never for a purchase, which is only
/// ever approved by itself and only with `confirm_purchase` (so a stray
/// approve can't buy anything).
pub fn approve_all(purchase: bool, approved: bool, all: bool, confirm_purchase: bool) -> Result<bool, ApiError> {
    if purchase && approved && !confirm_purchase {
        return Err(ApiError::bad_request("this call buys something: approve it with confirm_purchase: true"));
    }
    Ok(all && approved && !purchase)
}

#[allow(clippy::too_many_arguments)]
pub async fn approve(app: &App, user: Uuid, id: Uuid, call_id: &str, approved: bool, reason: Option<String>, all: bool, confirm_purchase: bool) -> Result<(), ApiError> {
    let agents = agents_of(app, id).await?;
    // A sub-agent's call goes back to that sub-agent.
    let child: Option<String> = sqlx::query_scalar(
        // Call ids may repeat across agents: the latest asked one is meant.
        "SELECT k.agent_id FROM conversation_children k JOIN approval_checks a ON a.agent_id = k.agent_id
         WHERE k.conversation_id = $1 AND a.call_id = $2 AND a.decision = 'asked' ORDER BY a.created_at DESC LIMIT 1",
    )
    .bind(id)
    .bind(call_id)
    .fetch_optional(&app.pool)
    .await
    .map_err(internal)?;
    let agent = match child {
        Some(c) => {
            owned(app, user, id).await?;
            c
        }
        None => live_agent(app, user, id).await?,
    };
    let purchase = purchase_of(app, &agents, call_id).await?.is_some();
    if approve_all(purchase, approved, all, confirm_purchase)? {
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
    let agents = agents_of(app, id).await?;
    if let Err(e) = app.hub.call("cancel", json!({ "id": agent })).await {
        // Already gone on the hub is fine; anything else is not.
        if !e.to_string().contains("404") {
            return Err(internal(e));
        }
    }
    let mut tx = app.pool.begin().await.map_err(internal)?;
    sqlx::query("DELETE FROM chat_messages WHERE agent_id = ANY($1)").bind(&agents).execute(&mut *tx).await.map_err(internal)?;
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
    fn pending_approvals_from_subnet() {
        assert!(raw_approvals(&Value::Null).is_empty());
        let one = json!({ "id": "c1", "type": "function", "function": { "name": "connector.call_tool", "arguments": "{\"service\":\"s\",\"tool\":\"org_create\"}" } });
        let got = raw_approvals(&one);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["call_id"], "c1");
        assert_eq!(got[0]["name"], "connector.call_tool");
        assert_eq!(got[0]["input"]["tool"], "org_create");
        assert_eq!(raw_approvals(&json!([one.clone(), one])).len(), 2);
    }

    #[test]
    fn a_purchase_needs_confirm_purchase_and_never_approves_all() {
        // A stray approve (no confirm_purchase) is a 400.
        let err = approve_all(true, true, false, false).unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::BAD_REQUEST, "{err}");
        assert!(approve_all(true, true, true, false).is_err());
        // Confirmed: approved, but "all" doesn't turn on auto_approve.
        assert!(!approve_all(true, true, true, true).unwrap());
        assert!(!approve_all(true, true, false, true).unwrap());
        // Denying a purchase needs no confirmation.
        assert!(!approve_all(true, false, true, false).unwrap());
        // Anything else: as before.
        assert!(approve_all(false, true, true, false).unwrap());
        assert!(!approve_all(false, true, false, false).unwrap());
        assert!(!approve_all(false, false, true, false).unwrap());
    }

    #[test]
    fn budgets() {
        let b = |li, lo, ui, uo| Budget { plan_id: "p".into(), plan_name: "P".into(), hourly_input_tokens: li, hourly_output_tokens: lo, used_input_tokens: ui, used_output_tokens: uo };
        assert!(!b(100, 10, 99, 9).exhausted());
        assert!(b(100, 10, 100, 0).exhausted());
        assert!(b(100, 10, 0, 10).exhausted());
        assert!(!b(0, 0, 1_000_000_000, 1_000_000_000).exhausted(), "0 = unlimited");
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
