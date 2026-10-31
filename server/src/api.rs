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
pub struct Mode {
    /// `sales` or `machine_config`.
    mode: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct SendInput {
    mode: String,
    text: String,
    /// The UI language (`en`, `de`); the assistant replies in it.
    #[serde(default = "en")]
    lang: String,
}
fn en() -> String {
    "en".into()
}

#[derive(Deserialize, JsonSchema)]
pub struct AnswerInput {
    mode: String,
    call_id: String,
    /// The answer; absent when the user dismissed the question.
    content: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ApproveInput {
    mode: String,
    call_id: String,
    approved: bool,
    reason: Option<String>,
    /// Approve every further call in this conversation.
    #[serde(default)]
    all: bool,
}

#[derive(Serialize, JsonSchema)]
pub struct ModeInfo {
    id: String,
    /// Offered to you (modes acting on a service need it reachable).
    available: bool,
    /// You have a conversation in it.
    active: bool,
}

// ── admin ───────────────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema)]
pub struct UserSearch {
    /// Substring of the email or name.
    q: String,
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct UserHit {
    id: Uuid,
    email: String,
    name: String,
    /// Modes with a prompt extension.
    extension_modes: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct UserMode {
    user_id: Uuid,
    /// Absent: every mode.
    mode: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct ExtensionInput {
    user_id: Uuid,
    mode: String,
    content: String,
}

#[derive(Serialize, JsonSchema, sqlx::FromRow)]
pub struct Extension {
    mode: String,
    content: String,
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
    mode: String,
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

    reg.resource("chat", "chat", "Conversations with the plan.ai assistants")
        .list("Chat modes and whether you have a conversation in each.", |app: AppState, p: Arc<Principal>, _: Empty| async move {
            let user = user_of(&p)?;
            let mut out = vec![];
            for mode in app.cfg.subnet.types.keys() {
                out.push(ModeInfo {
                    id: mode.clone(),
                    available: chat::available(&app, user, mode).await?,
                    active: chat::current_agent(&app, user, mode).await?.is_some(),
                });
            }
            Ok(out)
        })
        .custom("history", Risk::ReadOnly, OnItem::No, "The conversation in a mode and what it waits on.", |app: AppState, p: Arc<Principal>, m: Mode| async move {
            chat::history(&app, user_of(&p)?, &m.mode).await
        })
        .custom("send", Risk::Mutating, OnItem::No, "Send a message; the reply streams over /api/v1/chat/events.", |app: AppState, p: Arc<Principal>, i: SendInput| async move {
            require_not_impersonating(&p)?;
            let user = user_of(&p)?;
            ensure_profile(&app, user).await?;
            chat::send(&app, user, &i.mode, &i.text, &i.lang).await?;
            Ok(OK)
        })
        .custom("answer", Risk::Mutating, OnItem::No, "Answer a question the assistant asked.", |app: AppState, p: Arc<Principal>, i: AnswerInput| async move {
            require_not_impersonating(&p)?;
            chat::answer(&app, user_of(&p)?, &i.mode, &i.call_id, i.content.as_deref()).await?;
            Ok(OK)
        })
        .custom("approve", Risk::Mutating, OnItem::No, "Approve or deny a tool call waiting for you.", |app: AppState, p: Arc<Principal>, i: ApproveInput| async move {
            require_not_impersonating(&p)?;
            chat::approve(&app, user_of(&p)?, &i.mode, &i.call_id, i.approved, i.reason, i.all).await?;
            Ok(OK)
        })
        .custom("reset", Risk::Destructive, OnItem::No, "End the conversation; the next message starts a new one.", |app: AppState, p: Arc<Principal>, m: Mode| async move {
            require_not_impersonating(&p)?;
            chat::reset(&app, user_of(&p)?, &m.mode).await?;
            Ok(OK)
        });

    reg.resource("user", "user", "Users (admin)").list("Search users by email or name.", |app: AppState, p: Arc<Principal>, s: UserSearch| async move {
        p.require_admin()?;
        sqlx::query_as(
            "SELECT u.id, u.email, u.name, COALESCE(array_agg(e.mode) FILTER (WHERE e.mode IS NOT NULL), '{}') AS extension_modes
             FROM accounts.users u LEFT JOIN system_prompt_extensions e ON e.user_id = u.id
             WHERE u.email ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%'
             GROUP BY u.id ORDER BY u.email LIMIT 20",
        )
        .bind(s.q.replace(['%', '_'], ""))
        .fetch_all(&app.pool)
        .await
        .map_err(internal)
        .map(|v: Vec<UserHit>| v)
    });

    reg.resource("prompt_extension", "prompt_extension", "Per-user system prompt extensions (admin)")
        .list("A user's prompt extensions.", |app: AppState, p: Arc<Principal>, i: UserMode| async move {
            p.require_admin()?;
            sqlx::query_as("SELECT mode, content FROM system_prompt_extensions WHERE user_id = $1 AND ($2::text IS NULL OR mode = $2) ORDER BY mode")
                .bind(i.user_id)
                .bind(i.mode)
                .fetch_all(&app.pool)
                .await
                .map_err(internal)
                .map(|v: Vec<Extension>| v)
        })
        .update("Set a user's extension for a mode; it applies from their next conversation.", |app: AppState, p: Arc<Principal>, i: ExtensionInput| async move {
            p.require_admin()?;
            chat::agent_type(&app, &i.mode)?;
            sqlx::query(
                "INSERT INTO system_prompt_extensions (user_id, mode, content) VALUES ($1,$2,$3)
                 ON CONFLICT (user_id, mode) DO UPDATE SET content = EXCLUDED.content, updated_at = now()",
            )
            .bind(i.user_id)
            .bind(&i.mode)
            .bind(&i.content)
            .execute(&app.pool)
            .await
            .map_err(internal)?;
            Ok(OK)
        })
        .custom("remove", Risk::Destructive, OnItem::No, "Remove a user's extension for a mode.", |app: AppState, p: Arc<Principal>, i: UserMode| async move {
            p.require_admin()?;
            let mode = i.mode.ok_or_else(|| ApiError::bad_request("mode is required"))?;
            sqlx::query("DELETE FROM system_prompt_extensions WHERE user_id = $1 AND mode = $2").bind(i.user_id).bind(mode).execute(&app.pool).await.map_err(internal)?;
            Ok(OK)
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
            "SELECT m.id, m.user_id, u.email, m.mode, m.role, m.content, m.created_at
             FROM chat_messages m JOIN accounts.users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT $1",
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
