//! The app's API, declared once and served as REST (`/api/v1/...`), OpenAPI
//! and MCP by plan-ai-api-mcp. A signed-in browser calls it with its session.

use std::sync::Arc;

use plan_ai_api_mcp::{ApiError, OnItem, Principal, Registry, Risk};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::chat;
use crate::state::AppState;

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::error!("{e:#}");
    ApiError::internal(e.to_string())
}

/// The signed-in user behind a principal (set by `session_principal`).
fn user_of(p: &Principal) -> Result<Uuid, ApiError> {
    p.scopes["user_id"].as_str().and_then(|s| s.parse().ok()).ok_or_else(|| ApiError::forbidden("only signed-in users can chat"))
}

/// Admins acting as someone else read, but don't change that user's settings.
fn require_not_impersonating(p: &Principal) -> Result<(), ApiError> {
    if p.scopes["impersonating_from"].is_null() { Ok(()) } else { Err(ApiError::forbidden("read-only while impersonating")) }
}

async fn ensure_profile(app: &AppState, user: Uuid) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING").bind(user).execute(&app.pool).await.map_err(internal)?;
    Ok(())
}

#[derive(Deserialize, JsonSchema)]
pub struct Empty {}

#[derive(Serialize, JsonSchema)]
pub struct Ok_ {
    ok: bool,
}
const OK: Ok_ = Ok_ { ok: true };

// ── profile ─────────────────────────────────────────────────────────

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct Profile {
    user_id: Uuid,
    email: String,
    name: String,
    is_admin: bool,
    language: String,
    theme: String,
    newsletter_opt_in: bool,
    deletion_requested_at: Option<chrono::DateTime<chrono::Utc>>,
    #[sqlx(skip)]
    impersonating: bool,
    /// The user's plan and its hourly token budget, with the last hour's use.
    #[sqlx(skip)]
    budget: Option<chat::Budget>,
}

async fn load_profile(app: &AppState, user: Uuid) -> Result<Profile, ApiError> {
    ensure_profile(app, user).await?;
    sqlx::query_as(
        "SELECT p.user_id, u.email, u.name, u.is_admin, p.language, p.theme, p.newsletter_opt_in, p.deletion_requested_at
         FROM profiles p JOIN accounts.users u ON u.id = p.user_id WHERE p.user_id = $1",
    )
    .bind(user)
    .fetch_one(&app.pool)
    .await
    .map_err(internal)
}

#[derive(Deserialize, JsonSchema)]
pub struct ProfileUpdate {
    /// `en` or `de`.
    language: Option<String>,
    /// `system`, `light` or `dark`.
    theme: Option<String>,
    newsletter_opt_in: Option<bool>,
    /// Where a newsletter change came from: `chat_flow` or `settings`.
    newsletter_source: Option<String>,
}

async fn update_profile(app: &AppState, user: Uuid, u: ProfileUpdate) -> Result<(), ApiError> {
    let mut tx = app.pool.begin().await.map_err(internal)?;
    sqlx::query(
        "UPDATE profiles SET language = COALESCE($2, language), theme = COALESCE($3, theme),
         newsletter_opt_in = COALESCE($4, newsletter_opt_in), updated_at = now() WHERE user_id = $1",
    )
    .bind(user)
    .bind(&u.language)
    .bind(&u.theme)
    .bind(u.newsletter_opt_in)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::bad_request(e.to_string()))?;
    if let Some(on) = u.newsletter_opt_in {
        sqlx::query("INSERT INTO newsletter_events (user_id, status, source) VALUES ($1, $2, $3)")
            .bind(user)
            .bind(if on { "subscribed" } else { "unsubscribed" })
            .bind(u.newsletter_source.as_deref().unwrap_or("settings"))
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::bad_request(e.to_string()))?;
    }
    tx.commit().await.map_err(internal)
}

/// Everything stored about the user.
async fn export(app: &AppState, user: Uuid) -> Result<Value, ApiError> {
    let profile = load_profile(app, user).await?;
    sqlx::query("INSERT INTO data_export_events (user_id) VALUES ($1)").bind(user).execute(&app.pool).await.map_err(internal)?;
    let rows = |sql: &'static str| {
        let pool = app.pool.clone();
        async move {
            sqlx::query_scalar::<_, Value>(sql).bind(user).fetch_all(&pool).await.map_err(internal)
        }
    };
    Ok(json!({
        "exported_at": chrono::Utc::now(),
        "profile": profile,
        "chat_messages": rows("SELECT to_jsonb(m) - 'user_id' FROM chat_messages m WHERE user_id = $1 ORDER BY id").await?,
        "newsletter_events": rows("SELECT to_jsonb(e) - 'user_id' FROM newsletter_events e WHERE user_id = $1 ORDER BY id").await?,
        "data_export_events": rows("SELECT to_jsonb(e) - 'user_id' FROM data_export_events e WHERE user_id = $1 ORDER BY id").await?,
        "staff_pings": rows("SELECT to_jsonb(s) - 'user_id' FROM staff_pings s WHERE user_id = $1 ORDER BY id").await?,
        "token_usage": rows("SELECT to_jsonb(t) - 'user_id' FROM chat_token_usage t WHERE user_id = $1 ORDER BY created_at").await?,
    }))
}

// ── chat ────────────────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema)]
pub struct ConversationRef {
    /// Conversation id.
    id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
pub struct SendInput {
    /// The conversation; absent starts a new one.
    id: Option<Uuid>,
    text: String,
    /// The UI language (`en`, `de`); the assistant replies in it.
    #[serde(default = "en")]
    lang: String,
}
fn en() -> String {
    "en".into()
}

#[derive(Serialize, JsonSchema)]
pub struct Sent {
    /// The conversation the message went to (new or given).
    id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
pub struct AnswerInput {
    id: Uuid,
    call_id: String,
    /// The answer; absent when the user dismissed the question.
    content: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ApproveInput {
    id: Uuid,
    call_id: String,
    approved: bool,
    reason: Option<String>,
    /// Approve every further call in this conversation. Ignored for a
    /// purchase, which is only ever approved by itself.
    #[serde(default)]
    all: bool,
    /// Required (true) to approve a call that buys something (its approval
    /// carries `purchase`); 400 without it.
    #[serde(default)]
    confirm_purchase: bool,
}

#[derive(Deserialize, JsonSchema)]
pub struct SearchInput {
    /// Words to find (prefixes match: "konf" finds "Konfiguration").
    #[serde(deserialize_with = "text")]
    #[schemars(with = "String")]
    q: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct RenameInput {
    id: Uuid,
    title: String,
}

// ── admin ───────────────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema)]
pub struct UserSearch {
    /// Substring of the email or name.
    #[serde(deserialize_with = "text")]
    #[schemars(with = "String")]
    q: String,
}

/// Query strings arrive coerced (`?q=123` is a number); a search term is text.
fn text<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => s,
        other => other.to_string(),
    })
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct UserHit {
    id: Uuid,
    email: String,
    name: String,
    /// Has a prompt extension.
    has_extension: bool,
    /// Their plan (personal team's).
    plan_id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct UserRef {
    user_id: Uuid,
}

#[derive(Deserialize, JsonSchema)]
pub struct ExtensionInput {
    user_id: Uuid,
    content: String,
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct Extension {
    content: String,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, JsonSchema)]
pub struct PlanInfo {
    #[serde(flatten)]
    plan: plan_ai_accounts::Plan,
    /// Users on it.
    users: i64,
}

#[derive(Deserialize, JsonSchema)]
pub struct PlanInput {
    id: String,
    name: String,
    /// Tokens per user per rolling hour; 0 = unlimited.
    hourly_input_tokens: u64,
    hourly_output_tokens: u64,
}

#[derive(Deserialize, JsonSchema)]
pub struct SetPlanInput {
    user_id: Uuid,
    plan_id: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct PingFilter {
    #[serde(default)]
    include_resolved: bool,
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct Ping {
    id: i64,
    user_id: Uuid,
    email: String,
    reason: String,
    message: String,
    resolved_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize, JsonSchema)]
pub struct PingId {
    id: i64,
}

#[derive(Deserialize, JsonSchema)]
pub struct MessageFilter {
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    100
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct AdminMessage {
    id: i64,
    user_id: Uuid,
    email: String,
    /// The conversation's title.
    conversation: Option<String>,
    role: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

pub fn registry(auth: Arc<dyn plan_ai_api_mcp::Authenticator>) -> Registry<AppState> {
    let mut reg = Registry::new(auth)
        .info("plan.ai chat", env!("CARGO_PKG_VERSION"))
        .instructions("The plan.ai chat: your profile, conversations with the plan.ai assistants, and (for admins) users, prompt extensions, staff pings and stats.");

    reg.resource("profile", "profile", "Your profile and settings")
        .get("Your profile.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            let mut profile = load_profile(&app, user_of(&p)?).await?;
            profile.impersonating = !p.scopes["impersonating_from"].is_null();
            profile.budget = Some(chat::budget(&app, profile.user_id).await?);
            Ok(profile)
        })
        .update("Change language, theme or newsletter subscription.", |app: AppState, p: Arc<Principal>, u: ProfileUpdate| async move {
            require_not_impersonating(&p)?;
            let user = user_of(&p)?;
            ensure_profile(&app, user).await?;
            update_profile(&app, user, u).await?;
            load_profile(&app, user).await
        })
        .custom("export", Risk::ReadOnly, OnItem::No, "Everything stored about you, as JSON.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            export(&app, user_of(&p)?).await
        })
        .custom("request_deletion", Risk::Destructive, OnItem::No, "Ask for your account and data to be deleted.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            require_not_impersonating(&p)?;
            let user = user_of(&p)?;
            ensure_profile(&app, user).await?;
            sqlx::query("UPDATE profiles SET deletion_requested_at = COALESCE(deletion_requested_at, now()) WHERE user_id = $1")
                .bind(user)
                .execute(&app.pool)
                .await
                .map_err(internal)?;
            Ok(OK)
        });

    reg.resource("chat", "chat", "Your conversations with the plan.ai assistant")
        .list("Your conversations, most recent first.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            chat::list(&app, user_of(&p)?).await
        })
        .custom("search", Risk::ReadOnly, OnItem::No, "Search your own conversations (titles and messages); snippets mark matches between U+E000 and U+E001.", |app: AppState, p: Arc<Principal>, i: SearchInput| async move {
            chat::search(&app, user_of(&p)?, &i.q).await
        })
        .custom("history", Risk::ReadOnly, OnItem::No, "A conversation's messages and what it waits on.", |app: AppState, p: Arc<Principal>, c: ConversationRef| async move {
            chat::history(&app, user_of(&p)?, c.id).await
        })
        .custom("send", Risk::Mutating, OnItem::No, "Send a message (no id: start a new conversation); the reply streams over /api/v1/chat/events.", |app: AppState, p: Arc<Principal>, i: SendInput| async move {
            require_not_impersonating(&p)?;
            let user = user_of(&p)?;
            ensure_profile(&app, user).await?;
            Ok(Sent { id: chat::send(&app, user, i.id, &i.text, &i.lang).await? })
        })
        .custom("answer", Risk::Mutating, OnItem::No, "Answer a question the assistant asked.", |app: AppState, p: Arc<Principal>, i: AnswerInput| async move {
            require_not_impersonating(&p)?;
            chat::answer(&app, user_of(&p)?, i.id, &i.call_id, i.content.as_deref()).await?;
            Ok(OK)
        })
        .custom("approve", Risk::Mutating, OnItem::No, "Approve or deny a tool call waiting for you.", |app: AppState, p: Arc<Principal>, i: ApproveInput| async move {
            require_not_impersonating(&p)?;
            chat::approve(&app, user_of(&p)?, i.id, &i.call_id, i.approved, i.reason, i.all, i.confirm_purchase).await?;
            Ok(OK)
        })
        .custom("rename", Risk::Mutating, OnItem::No, "Rename a conversation.", |app: AppState, p: Arc<Principal>, i: RenameInput| async move {
            require_not_impersonating(&p)?;
            chat::rename(&app, user_of(&p)?, i.id, &i.title).await?;
            Ok(OK)
        })
        .custom("remove", Risk::Destructive, OnItem::No, "Delete a conversation and its messages.", |app: AppState, p: Arc<Principal>, c: ConversationRef| async move {
            require_not_impersonating(&p)?;
            chat::delete(&app, user_of(&p)?, c.id).await?;
            Ok(OK)
        });

    reg.resource("user", "user", "Users (admin)").list("Search users by email or name.", |app: AppState, p: Arc<Principal>, s: UserSearch| async move {
        p.require_admin()?;
        sqlx::query_as(
            "SELECT u.id, u.email, u.name, e.user_id IS NOT NULL AS has_extension, t.plan_id
             FROM accounts.users u LEFT JOIN prompt_extensions e ON e.user_id = u.id
             JOIN accounts.teams t ON t.owner_id = u.id AND t.personal AND t.deleted_at IS NULL
             WHERE u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%'
             ORDER BY u.email LIMIT 20",
        )
        .bind(s.q.replace(['%', '_'], ""))
        .fetch_all(&app.pool)
        .await
        .map_err(internal)
        .map(|v: Vec<UserHit>| v)
    });

    reg.resource("prompt_extension", "prompt_extension", "Per-user system prompt extensions (admin)")
        .list("A user's prompt extension (empty list: none).", |app: AppState, p: Arc<Principal>, i: UserRef| async move {
            p.require_admin()?;
            sqlx::query_as("SELECT content, updated_at FROM prompt_extensions WHERE user_id = $1")
                .bind(i.user_id)
                .fetch_all(&app.pool)
                .await
                .map_err(internal)
                .map(|v: Vec<Extension>| v)
        })
        .custom("set", Risk::Mutating, OnItem::No, "Set a user's extension; it applies from their next conversation.", |app: AppState, p: Arc<Principal>, i: ExtensionInput| async move {
            p.require_admin()?;
            sqlx::query(
                "INSERT INTO prompt_extensions (user_id, content) VALUES ($1,$2)
                 ON CONFLICT (user_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()",
            )
            .bind(i.user_id)
            .bind(&i.content)
            .execute(&app.pool)
            .await
            .map_err(internal)?;
            Ok(OK)
        })
        .custom("remove", Risk::Destructive, OnItem::No, "Remove a user's extension.", |app: AppState, p: Arc<Principal>, i: UserRef| async move {
            p.require_admin()?;
            sqlx::query("DELETE FROM prompt_extensions WHERE user_id = $1").bind(i.user_id).execute(&app.pool).await.map_err(internal)?;
            Ok(OK)
        });

    reg.resource("plan", "plan", "Plans: hourly token budgets, assigned to users by admins (no charges)")
        .list("Every plan with its limits, and how many users are on it.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            p.require_admin()?;
            let plans = app.accounts.plans().await?;
            let counts: Vec<(String, i64)> = sqlx::query_as("SELECT plan_id, count(*) FROM accounts.teams WHERE personal AND deleted_at IS NULL GROUP BY plan_id")
                .fetch_all(&app.pool)
                .await
                .map_err(internal)?;
            Ok(plans
                .into_iter()
                .map(|plan| {
                    let users = counts.iter().find(|(id, _)| *id == plan.id).map(|(_, n)| *n).unwrap_or(0);
                    PlanInfo { users, plan }
                })
                .collect::<Vec<_>>())
        })
        .custom("put", Risk::Mutating, OnItem::No, "Create or change a plan's name and limits (hourly_input_tokens, hourly_output_tokens; 0 = unlimited). Plans are free: the price stays 0.", |app: AppState, p: Arc<Principal>, i: PlanInput| async move {
            p.require_admin()?;
            if i.id.trim().is_empty() || i.name.trim().is_empty() {
                return Err(ApiError::bad_request("a plan needs an id and a name"));
            }
            let plan = plan_ai_accounts::Plan {
                id: i.id.trim().to_string(),
                name: i.name.trim().to_string(),
                price_cents: 0,
                currency: "EUR".into(),
                window_days: 30,
                limits: [
                    (crate::config::HOURLY_INPUT.to_string(), i.hourly_input_tokens),
                    (crate::config::HOURLY_OUTPUT.to_string(), i.hourly_output_tokens),
                ]
                .into(),
            };
            app.accounts.put_plan(&plan).await
        });

    reg.resource("user", "user", "Users (admin)").custom("set_plan", Risk::Mutating, OnItem::No, "Put a user on a plan (their personal team's).", |app: AppState, p: Arc<Principal>, i: SetPlanInput| async move {
        p.require_admin()?;
        let user = app.accounts.user(i.user_id).await?.ok_or_else(|| ApiError::not_found("no such user"))?;
        let team = app.accounts.personal_team(&user).await?;
        let by = user_of(&p).unwrap_or(user.id);
        app.accounts.assign_plan(team.id, &i.plan_id, by).await?;
        chat::budget(&app, user.id).await
    });

    reg.resource("staff_ping", "staff_ping", "Requests for a human from the assistants (admin)")
        .list("Staff pings, newest first.", |app: AppState, p: Arc<Principal>, f: PingFilter| async move {
            p.require_admin()?;
            sqlx::query_as(
                "SELECT s.id, s.user_id, u.email, s.reason, s.message, s.resolved_at, s.created_at
                 FROM staff_pings s JOIN accounts.users u ON u.id = s.user_id
                 WHERE $1 OR s.resolved_at IS NULL ORDER BY s.created_at DESC LIMIT 200",
            )
            .bind(f.include_resolved)
            .fetch_all(&app.pool)
            .await
            .map_err(internal)
            .map(|v: Vec<Ping>| v)
        })
        .custom("resolve", Risk::Mutating, OnItem::No, "Mark a ping resolved.", |app: AppState, p: Arc<Principal>, i: PingId| async move {
            p.require_admin()?;
            sqlx::query("UPDATE staff_pings SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL").bind(i.id).execute(&app.pool).await.map_err(internal)?;
            Ok(OK)
        });

    reg.resource("message", "message", "Chat traffic (admin)").list("The latest chat messages of all users.", |app: AppState, p: Arc<Principal>, f: MessageFilter| async move {
        p.require_admin()?;
        sqlx::query_as(
            "SELECT m.id, m.user_id, u.email, c.title AS conversation, m.role, m.content, m.created_at
             FROM chat_messages m JOIN accounts.users u ON u.id = m.user_id
             LEFT JOIN conversations c ON m.agent_id = c.agent_id OR m.agent_id = ANY(c.previous_agents) ORDER BY m.id DESC LIMIT $1",
        )
        .bind(f.limit.clamp(1, 1000))
        .fetch_all(&app.pool)
        .await
        .map_err(internal)
        .map(|v: Vec<AdminMessage>| v)
    });

    reg.resource("stats", "stats", "Dashboard numbers (admin)").get("Counts and hourly series for the dashboard.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
        p.require_admin()?;
        let scalar = |sql: &'static str| {
            let pool = app.pool.clone();
            async move { sqlx::query_scalar::<_, i64>(sql).fetch_one(&pool).await.map_err(internal) }
        };
        let series = |sql: &'static str| {
            let pool = app.pool.clone();
            async move { sqlx::query_scalar::<_, Value>(sql).fetch_all(&pool).await.map_err(internal) }
        };
        Ok(json!({
            "messages_today": scalar("SELECT count(*) FROM chat_messages WHERE role = 'user' AND created_at >= date_trunc('day', now())").await?,
            "messages_total": scalar("SELECT count(*) FROM chat_messages WHERE role = 'user'").await?,
            "active_users_today": scalar("SELECT count(DISTINCT user_id) FROM chat_messages WHERE created_at >= date_trunc('day', now())").await?,
            "unresolved_pings": scalar("SELECT count(*) FROM staff_pings WHERE resolved_at IS NULL").await?,
            "users_total": scalar("SELECT count(*) FROM accounts.users").await?,
            // Last 48 hours, per hour.
            "activity": series(
                "SELECT jsonb_build_object('hour', h, 'messages', count(m.id))
                 FROM generate_series(date_trunc('hour', now()) - interval '47 hours', date_trunc('hour', now()), interval '1 hour') h
                 LEFT JOIN chat_messages m ON m.role = 'user' AND date_trunc('hour', m.created_at) = h GROUP BY h ORDER BY h"
            ).await?,
            "tokens": series(
                "SELECT jsonb_build_object('hour', h, 'input', COALESCE(sum(t.input_tokens),0), 'output', COALESCE(sum(t.output_tokens),0), 'cached', COALESCE(sum(t.cached_tokens),0))
                 FROM generate_series(date_trunc('hour', now()) - interval '47 hours', date_trunc('hour', now()), interval '1 hour') h
                 LEFT JOIN chat_token_usage t ON date_trunc('hour', t.created_at) = h GROUP BY h ORDER BY h"
            ).await?,
            "top_users": series(
                "SELECT jsonb_build_object('email', u.email, 'input', sum(t.input_tokens), 'output', sum(t.output_tokens))
                 FROM chat_token_usage t JOIN accounts.users u ON u.id = t.user_id
                 WHERE t.created_at > now() - interval '24 hours' GROUP BY u.email ORDER BY sum(t.input_tokens + t.output_tokens) DESC LIMIT 10"
            ).await?,
        }))
    });

    reg
}

#[cfg(test)]
mod tests {
    #[test]
    fn numeric_search_terms_stay_text() {
        let s: super::UserSearch = serde_json::from_value(serde_json::json!({ "q": 123 })).unwrap();
        assert_eq!(s.q, "123");
    }
}
