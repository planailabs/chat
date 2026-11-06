//! Interactive pages in conversations, shown by the browser in a sandboxed
//! iframe (`sandbox="allow-scripts"`, no origin, a CSP without network):
//!
//! - **Artifacts** the assistant publishes (`chat.artifact_publish`): HTML on
//!   the generative-ui suite (its `<ui-*>` components and the chat's design),
//!   versioned by name, with a KV view the page binds (`data-kv`) and
//!   optional backflow handlers (JavaScript, run by gui-runtime with only
//!   their KV: no network, no files).
//! - **MCP Apps views**: a service tool's `ui://` resource, kept with the
//!   call's input and result when the connector hands it over (`ChatViews`).
//!
//! Both talk to the chat over the MCP Apps protocol (the browser is the
//! host). What a page asks for comes here: its KV, backflow (a handler runs,
//! or the action goes to the assistant as a message), messages, model
//! context, and tool calls, which are judged like the assistant's own
//! (`hook::judge_present`); what needs the user comes back as `confirm`.

use std::collections::{BTreeMap, HashMap};
use std::sync::{LazyLock, Mutex};

use plan_ai_api_mcp::ApiError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::hook::{self, Call, Judgement, Risk};
use crate::state::App;
use crate::subnet::BrowserEvent;

const SUITE_CSS: &str = include_str!("../../generative-ui/suite/suite.css");
const SUITE_LIB: &str = include_str!("../../generative-ui/suite/lib.js");
const SUITE_RUNTIME: &str = include_str!("../../generative-ui/suite/runtime.js");

/// The suite's lib.js and runtime.js as one inline module: a page without
/// network can't import.
static SUITE_MODULE: LazyLock<String> = LazyLock::new(|| {
    let lib = SUITE_LIB.replace("export function ", "function ");
    let start = SUITE_RUNTIME.find("import {").expect("runtime.js imports lib.js");
    let tail = "from \"./lib.js\";";
    let end = start + SUITE_RUNTIME[start..].find(tail).expect("runtime.js imports lib.js") + tail.len();
    let runtime = format!("{}{}", &SUITE_RUNTIME[..start], &SUITE_RUNTIME[end..]);
    let runtime = runtime.replace("export { ctx, gui, sendBackflow };", "");
    format!("{lib}\n{runtime}")
});

const MAX_HTML: usize = 512 * 1024;
const MAX_HANDLER: usize = 64 * 1024;
const MAX_HANDLERS: usize = 16;
const MAX_KV: usize = 256 * 1024;
const MAX_ARTIFACTS: i64 = 100;

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::error!("{e:#}");
    ApiError::internal(e.to_string())
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max).collect::<String>()) }
}

// ─── Documents ──────────────────────────────────────────────────────────────

/// Byte offset of `needle` in `hay`, ignoring ASCII case.
fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    hay.to_ascii_lowercase().find(&needle.to_ascii_lowercase())
}

/// `insert` as the first thing in the document's head (a CSP meta only
/// governs what comes after it); a document without one gets a head.
fn into_head(html: &str, insert: &str) -> String {
    if let Some(h) = find_ci(html, "<head")
        && let Some(close) = html[h..].find('>')
    {
        let at = h + close + 1;
        return format!("{}{insert}{}", &html[..at], &html[at..]);
    }
    if let Some(h) = find_ci(html, "<html")
        && let Some(close) = html[h..].find('>')
    {
        let at = h + close + 1;
        return format!("{}<head>{insert}</head>{}", &html[..at], &html[at..]);
    }
    format!("<head>{insert}</head>{html}")
}

fn is_document(html: &str) -> bool {
    ["<html", "<head", "<body", "<!doctype"].iter().any(|t| find_ci(html, t).is_some())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// An artifact's CSP: inline code and data URLs only; no network, frames,
/// form posts or base changes.
const ARTIFACT_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/// An origin a view may declare: https/wss, host (wildcard subdomain
/// allowed), optional port, nothing that could end the CSP directive.
fn origin_ok(o: &str) -> bool {
    let rest = o.strip_prefix("https://").or_else(|| o.strip_prefix("wss://"));
    rest.is_some_and(|r| !r.is_empty() && r.len() < 200 && r.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '*' | ':')))
}

/// An MCP Apps view's CSP: the spec's restrictive default plus the origins
/// its `_meta.ui.csp` declares (anything malformed is dropped).
pub fn view_csp(ui: &Value) -> String {
    let list = |k: &str| -> String {
        ui["csp"][k].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|o| origin_ok(o)).map(|o| format!(" {o}")).collect()
    };
    let (res, connect, frames, base) = (list("resourceDomains"), list("connectDomains"), list("frameDomains"), list("baseUriDomains"));
    let or_none = |l: &str| if l.is_empty() { " 'none'".to_string() } else { l.to_string() };
    format!(
        "default-src 'none'; script-src 'self' 'unsafe-inline'{res}; style-src 'self' 'unsafe-inline'{res}; img-src 'self' data: blob:{res}; font-src 'self' data:{res}; media-src 'self' data: blob:{res}; connect-src{}; frame-src{}; base-uri{}; object-src 'none'; form-action 'none'",
        or_none(&connect),
        or_none(&frames),
        if base.is_empty() { " 'self'".to_string() } else { base },
    )
}

fn csp_meta(policy: &str) -> String {
    format!(r#"<meta http-equiv="Content-Security-Policy" content="{}">"#, esc(policy))
}

/// An artifact's page: the suite (styles, components, the bridge) around
/// the assistant's HTML, a fragment or a whole document.
pub fn artifact_document(html: &str, title: &str, surface: &str, version: i32, theme: Option<&str>) -> String {
    let scheme = match theme {
        Some("light") => "<style>:root{color-scheme:light}</style>",
        Some("dark") => "<style>:root{color-scheme:dark}</style>",
        _ => "",
    };
    let head = format!(
        "<meta charset=\"utf-8\">{}<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"gui-transport\" content=\"postmessage\"><meta name=\"surface\" content=\"{}\"><meta name=\"version\" content=\"{version}\"><style>{SUITE_CSS}</style>{scheme}<script type=\"module\">{}</script>",
        csp_meta(ARTIFACT_CSP),
        esc(surface),
        *SUITE_MODULE,
    );
    if is_document(html) {
        into_head(html, &head)
    } else {
        format!("<!doctype html><html><head>{head}<title>{}</title></head><body><main class=\"gui-surface\">{html}</main></body></html>", esc(title))
    }
}

/// A view's page: its own HTML under its CSP.
pub fn view_document(html: &str, ui: &Value) -> String {
    into_head(html, &format!("<meta charset=\"utf-8\">{}", csp_meta(&view_csp(ui))))
}

// ─── Storage ────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow, Clone)]
struct Row {
    id: Uuid,
    conversation_id: Uuid,
    kind: String,
    name: Option<String>,
    title: String,
    service: Option<String>,
}

const ROW: &str = "SELECT id, conversation_id, kind, name, title, service FROM artifacts";

/// The user's artifact (another user's is "not found").
async fn owned(app: &App, user: Uuid, id: Uuid) -> Result<Row, ApiError> {
    sqlx::query_as::<_, Row>(&format!("{ROW} WHERE id = $1 AND user_id = $2"))
        .bind(id)
        .bind(user)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found("no such page"))
}

async fn latest_version(app: &App, id: Uuid) -> Result<i32, ApiError> {
    sqlx::query_scalar::<_, Option<i32>>("SELECT max(version) FROM artifact_versions WHERE artifact_id = $1")
        .bind(id)
        .fetch_one(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found("the page has no version"))
}

async fn kv_of(app: &App, id: Uuid) -> Result<(Map<String, Value>, Map<String, Value>), ApiError> {
    let row: Option<(Value, Value)> = sqlx::query_as("SELECT kv, kv_private FROM artifact_state WHERE artifact_id = $1").bind(id).fetch_optional(&app.pool).await.map_err(internal)?;
    let obj = |v: Value| match v {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    Ok(row.map(|(a, b)| (obj(a), obj(b))).unwrap_or_default())
}

fn emit(app: &App, user: Uuid, conversation: Uuid, name: &'static str, mut data: Value) {
    data["conversation"] = json!(conversation);
    let _ = app.events.send(BrowserEvent { user, name, data });
}

/// The conversation an agent's call comes from.
pub async fn conversation_of(app: &App, user: Uuid, agent: &str) -> Result<Uuid, ApiError> {
    sqlx::query_scalar("SELECT id FROM conversations WHERE agent_id = $1 AND user_id = $2")
        .bind(agent)
        .bind(user)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::bad_request("artifacts belong to a chat conversation; this call isn't from one"))
}

// ─── The assistant's tools ──────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema)]
pub struct HandlerInput {
    /// JavaScript defining `function handle(event, host) { … }`: `event` is
    /// {action, value, component}; `host.kv.get/set/all`, `host.kvPrivate.*`,
    /// `host.emit(name, data)` (an event you read with artifact_events),
    /// `host.log`, `host.crypto.*`. Its return value is the page's response.
    /// No network, no files.
    pub source: String,
    /// Wall-clock limit per run, ms (default 2000, at most 5000).
    pub wall_ms: Option<u64>,
}

#[derive(Deserialize, JsonSchema)]
pub struct PublishInput {
    /// The page's name in this conversation (a-z, 0-9, - and _). Publishing
    /// the same name again adds a version the user sees instead.
    pub name: String,
    /// What the user sees on its card.
    pub title: String,
    /// The page: HTML with the suite's `<ui-*>` components (see the
    /// `artifacts` skill), a fragment or a whole document. Or `components`.
    pub html: Option<String>,
    /// Instead of `html`: a component tree, e.g. [{"type":"heading","text":"…"},
    /// {"type":"chart","chart_type":"line","data":{…}}] (the skill lists them).
    pub components: Option<Vec<Value>>,
    /// Backflow handlers by action (`data-action` of a button or form):
    /// they run on the server when the user acts and update the KV view.
    /// An action without one comes to you as a message instead.
    pub handlers: Option<BTreeMap<String, HandlerInput>>,
    /// Values for the page's KV view (merged into what it has), bound in the
    /// HTML with `data-kv="key"` (dotted keys reach into objects).
    pub kv: Option<Map<String, Value>>,
}

#[derive(Serialize, JsonSchema)]
pub struct Published {
    pub artifact: Uuid,
    pub name: String,
    pub title: String,
    pub version: i32,
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 64 && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') && n.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

pub async fn publish(app: &App, user: Uuid, conversation: Uuid, i: PublishInput) -> Result<Published, ApiError> {
    if !valid_name(&i.name) {
        return Err(ApiError::bad_request("name: 1-64 of a-z, 0-9, - and _, starting with a letter or digit"));
    }
    let title = i.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(ApiError::bad_request("title: 1-120 characters"));
    }
    let html = match (i.html, i.components) {
        (Some(h), None) => h,
        (None, Some(c)) => {
            let tree: Vec<gui_schema::Component> = serde_json::from_value(Value::Array(c)).map_err(|e| ApiError::bad_request(format!("components: {e}")))?;
            gui_schema::render_all(&tree)
        }
        _ => return Err(ApiError::bad_request("give either html or components")),
    };
    if html.trim().is_empty() || html.len() > MAX_HTML {
        return Err(ApiError::bad_request(format!("the page must be 1 byte to {} KiB", MAX_HTML / 1024)));
    }
    let mut handlers = Map::new();
    for (action, h) in i.handlers.unwrap_or_default() {
        if action.is_empty() || action.len() > 64 {
            return Err(ApiError::bad_request("handler actions: 1-64 characters"));
        }
        if h.source.len() > MAX_HANDLER || !h.source.contains("handle") {
            return Err(ApiError::bad_request(format!("handler {action}: at most {} KiB of JavaScript defining handle(event, host)", MAX_HANDLER / 1024)));
        }
        handlers.insert(action, json!({ "lang": "js", "source": h.source, "wall_ms": h.wall_ms.unwrap_or(2000).clamp(100, 5000) }));
    }
    if handlers.len() > MAX_HANDLERS {
        return Err(ApiError::bad_request(format!("at most {MAX_HANDLERS} handlers")));
    }

    let mut tx = app.pool.begin().await.map_err(internal)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM artifacts WHERE conversation_id = $1").bind(conversation).fetch_one(&mut *tx).await.map_err(internal)?;
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM artifacts WHERE conversation_id = $1 AND name = $2 FOR UPDATE")
        .bind(conversation)
        .bind(&i.name)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
    let id = match existing {
        Some(id) => {
            sqlx::query("UPDATE artifacts SET title = $2, updated_at = now() WHERE id = $1").bind(id).bind(title).execute(&mut *tx).await.map_err(internal)?;
            id
        }
        None => {
            if count >= MAX_ARTIFACTS {
                return Err(ApiError::bad_request(format!("a conversation holds at most {MAX_ARTIFACTS} pages; publish a new version of one instead")));
            }
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO artifacts (id, user_id, conversation_id, kind, name, title) VALUES ($1, $2, $3, 'artifact', $4, $5)")
                .bind(id)
                .bind(user)
                .bind(conversation)
                .bind(&i.name)
                .bind(title)
                .execute(&mut *tx)
                .await
                .map_err(internal)?;
            id
        }
    };
    let version: i32 = sqlx::query_scalar(
        "INSERT INTO artifact_versions (artifact_id, version, html, handlers)
         SELECT $1, COALESCE(max(version), 0) + 1, $2, $3 FROM artifact_versions WHERE artifact_id = $1 RETURNING version",
    )
    .bind(id)
    .bind(&html)
    .bind(Value::Object(handlers))
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    let kv = Value::Object(i.kv.unwrap_or_default());
    if kv.to_string().len() > MAX_KV {
        return Err(ApiError::bad_request(format!("kv: at most {} KiB", MAX_KV / 1024)));
    }
    sqlx::query(
        "INSERT INTO artifact_state (artifact_id, kv) VALUES ($1, $2)
         ON CONFLICT (artifact_id) DO UPDATE SET kv = artifact_state.kv || EXCLUDED.kv, updated_at = now()",
    )
    .bind(id)
    .bind(&kv)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Published { artifact: id, name: i.name, title: title.to_string(), version })
}

#[derive(Serialize, JsonSchema)]
pub struct Listed {
    pub artifact: Uuid,
    pub name: Option<String>,
    pub title: String,
    pub kind: String,
    pub service: Option<String>,
    pub versions: i32,
    pub unread_events: i64,
}

/// The conversation's pages.
pub async fn list(app: &App, conversation: Uuid) -> Result<Vec<Listed>, ApiError> {
    let rows: Vec<(Uuid, Option<String>, String, String, Option<String>, Option<i32>, i64)> = sqlx::query_as(
        "SELECT a.id, a.name, a.title, a.kind, a.service,
                (SELECT max(version) FROM artifact_versions v WHERE v.artifact_id = a.id),
                (SELECT count(*) FROM artifact_events e WHERE e.artifact_id = a.id AND e.read_at IS NULL)
         FROM artifacts a WHERE a.conversation_id = $1 ORDER BY a.created_at",
    )
    .bind(conversation)
    .fetch_all(&app.pool)
    .await
    .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|(artifact, name, title, kind, service, versions, unread_events)| Listed { artifact, name, title, kind, service, versions: versions.unwrap_or(0), unread_events })
        .collect())
}

#[derive(Deserialize, JsonSchema)]
pub struct NameInput {
    /// The page's name (artifact_list), or an MCP Apps view's id.
    pub name: String,
    /// A version (default: the latest).
    pub version: Option<i32>,
}

async fn by_name(app: &App, conversation: Uuid, name: &str) -> Result<Row, ApiError> {
    let id = name.parse::<Uuid>().ok();
    sqlx::query_as::<_, Row>(&format!("{ROW} WHERE conversation_id = $1 AND (name = $2 OR id = $3)"))
        .bind(conversation)
        .bind(name)
        .bind(id)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found(format!("no page {name:?} in this conversation (artifact_list shows them)")))
}

/// One page as stored: its HTML, handlers, KV views, and what it reported.
pub async fn get(app: &App, conversation: Uuid, i: NameInput) -> Result<Value, ApiError> {
    let a = by_name(app, conversation, &i.name).await?;
    let version = match i.version {
        Some(v) => v,
        None => latest_version(app, a.id).await?,
    };
    let (html, handlers, meta): (String, Value, Value) = sqlx::query_as("SELECT html, handlers, meta FROM artifact_versions WHERE artifact_id = $1 AND version = $2")
        .bind(a.id)
        .bind(version)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found(format!("no version {version}")))?;
    let (kv, kv_private) = kv_of(app, a.id).await?;
    let context: Option<Value> = sqlx::query_scalar("SELECT model_context FROM artifacts WHERE id = $1").bind(a.id).fetch_one(&app.pool).await.map_err(internal)?;
    let handlers: Map<String, Value> = handlers.as_object().cloned().unwrap_or_default().into_iter().map(|(k, v)| (k, v["source"].clone())).collect();
    Ok(json!({
        "artifact": a.id, "name": a.name, "title": a.title, "kind": a.kind, "service": a.service,
        "version": version, "latest": latest_version(app, a.id).await?,
        "html": html, "handlers": handlers, "kv": kv, "kv_private": kv_private,
        "tool": if a.kind == "mcp_app" { json!({ "name": meta["tool"], "arguments": meta["arguments"] }) } else { Value::Null },
        "model_context": context,
    }))
}

#[derive(Deserialize, JsonSchema)]
pub struct EventsInput {
    /// One page's events (default: every page of the conversation).
    pub name: Option<String>,
    /// Also events you've read before (default: only new ones).
    #[serde(default)]
    pub all: bool,
}

/// What happened on the conversation's pages since the last read: the
/// user's actions and handlers' events (marked read).
pub async fn events(app: &App, conversation: Uuid, i: EventsInput) -> Result<Value, ApiError> {
    let only = match &i.name {
        Some(n) => Some(by_name(app, conversation, n).await?.id),
        None => None,
    };
    let rows: Vec<(i64, Uuid, String, Option<i32>, String, String, Option<Value>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT e.id, a.id, a.title, e.version, e.source, e.action, e.value, e.created_at
         FROM artifact_events e JOIN artifacts a ON a.id = e.artifact_id
         WHERE a.conversation_id = $1 AND ($2::uuid IS NULL OR a.id = $2) AND ($3 OR e.read_at IS NULL)
         ORDER BY e.id DESC LIMIT 100",
    )
    .bind(conversation)
    .bind(only)
    .bind(i.all)
    .fetch_all(&app.pool)
    .await
    .map_err(internal)?;
    let ids: Vec<i64> = rows.iter().map(|r| r.0).collect();
    sqlx::query("UPDATE artifact_events SET read_at = now() WHERE id = ANY($1) AND read_at IS NULL").bind(&ids).execute(&app.pool).await.map_err(internal)?;
    let events: Vec<Value> = rows
        .into_iter()
        .rev()
        .map(|(_, artifact, title, version, source, action, value, at)| json!({ "artifact": artifact, "title": title, "version": version, "source": source, "action": action, "value": value, "at": at }))
        .collect();
    Ok(json!({ "events": events }))
}

#[derive(Deserialize, JsonSchema)]
pub struct SetKvInput {
    pub name: String,
    /// Values merged into the page's KV view; the page updates at once (no
    /// new version). A `null` removes a key.
    pub values: Map<String, Value>,
}

/// Merge values into a page's KV view and push it to the user's browsers.
pub async fn set_kv(app: &App, user: Uuid, conversation: Uuid, i: SetKvInput) -> Result<Value, ApiError> {
    let a = by_name(app, conversation, &i.name).await?;
    let (mut kv, _) = kv_of(app, a.id).await?;
    for (k, v) in i.values {
        if v.is_null() {
            kv.remove(&k);
        } else {
            kv.insert(k, v);
        }
    }
    let kv = Value::Object(kv);
    if kv.to_string().len() > MAX_KV {
        return Err(ApiError::bad_request(format!("kv: at most {} KiB", MAX_KV / 1024)));
    }
    sqlx::query("INSERT INTO artifact_state (artifact_id, kv) VALUES ($1, $2) ON CONFLICT (artifact_id) DO UPDATE SET kv = EXCLUDED.kv, updated_at = now()")
        .bind(a.id)
        .bind(&kv)
        .execute(&app.pool)
        .await
        .map_err(internal)?;
    emit(app, user, conversation, "artifact_kv", json!({ "artifact": a.id, "kv": kv }));
    Ok(json!({ "kv": kv }))
}

/// Pages' reports (ui/update-model-context) the assistant hasn't had yet,
/// for the next message's context; taken once.
pub async fn take_model_context(app: &App, conversation: Uuid) -> Result<Option<String>, ApiError> {
    let rows: Vec<(String, Value)> = sqlx::query_as(
        "UPDATE artifacts SET context_pending = false WHERE conversation_id = $1 AND context_pending RETURNING title, model_context",
    )
    .bind(conversation)
    .fetch_all(&app.pool)
    .await
    .map_err(internal)?;
    if rows.is_empty() {
        return Ok(None);
    }
    Ok(Some(rows.into_iter().map(|(title, ctx)| format!("The page \"{title}\" reports: {}", truncate(&ctx.to_string(), 4000))).collect::<Vec<_>>().join("\n")))
}

// ─── The browser's side ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DocQuery {
    pub version: Option<i32>,
    pub theme: Option<String>,
}

/// A page for the iframe (`srcdoc`), with what the host needs to drive it.
pub async fn document(app: &App, user: Uuid, id: Uuid, q: DocQuery) -> Result<Value, ApiError> {
    let a = owned(app, user, id).await?;
    let latest = latest_version(app, id).await?;
    let version = q.version.unwrap_or(latest);
    let (html, meta): (String, Value) = sqlx::query_as("SELECT html, meta FROM artifact_versions WHERE artifact_id = $1 AND version = $2")
        .bind(id)
        .bind(version)
        .fetch_optional(&app.pool)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::not_found(format!("no version {version}")))?;
    let doc = match a.kind.as_str() {
        "artifact" => artifact_document(&html, &a.title, &format!("chat/{}/{}", a.conversation_id, a.name.as_deref().unwrap_or("page")), version, q.theme.as_deref()),
        _ => view_document(&html, &meta["ui"]),
    };
    Ok(json!({
        "id": id, "kind": a.kind, "title": a.title, "name": a.name, "service": a.service,
        "conversation": a.conversation_id, "version": version, "latest": latest, "html": doc,
        "tool": if a.kind == "mcp_app" { json!({ "name": meta["tool"], "arguments": meta["arguments"], "result": meta["result"], "definition": meta["definition"] }) } else { Value::Null },
        "prefers_border": meta["ui"]["prefersBorder"],
    }))
}

pub async fn kv(app: &App, user: Uuid, id: Uuid) -> Result<Value, ApiError> {
    owned(app, user, id).await?;
    Ok(json!({ "kv": kv_of(app, id).await?.0 }))
}

#[derive(Deserialize)]
pub struct BackflowInput {
    pub action: String,
    pub component: Option<String>,
    #[serde(default)]
    pub value: Value,
    pub version: Option<String>,
    #[serde(default = "en")]
    pub lang: String,
}

fn en() -> String {
    "en".into()
}

/// What a handler returned and the KV views it left.
struct Ran {
    response: Value,
    kv: Option<Map<String, Value>>,
    kv_private: Option<Map<String, Value>>,
    emitted: Vec<(String, Value)>,
}

/// Runs a handler in gui-runtime (QuickJS with its memory and time limits),
/// with nothing but its KV: no network, no files.
async fn run_handler(source: String, wall_ms: u64, event: gui_schema::Event, kv: Map<String, Value>, kv_private: Map<String, Value>) -> Result<Ran, String> {
    let run = tokio::task::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(format!("plan-ai-chat-handler-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).map_err(|e| format!("handler dir: {e}"))?;
        let entry = dir.join("main.js");
        let out = std::fs::write(&entry, &source).map_err(|e| format!("handler file: {e}")).and_then(|()| {
            let def = gui_schema::HandlerDef {
                lang: gui_schema::HandlerLang::Js,
                entry: "main.js".into(),
                capabilities: gui_schema::Capabilities { http: vec![], fs: false, kv: true },
                limits: gui_schema::Limits { wall_ms, mem_mb: 32, http_calls: 0, ..Default::default() },
            };
            gui_runtime::run_handler(&def, &dir, &dir, &event, kv, kv_private).map_err(|e| e.to_string())
        });
        let _ = std::fs::remove_dir_all(&dir);
        out
    });
    let outcome = tokio::time::timeout(std::time::Duration::from_millis(wall_ms + 2000), run)
        .await
        .map_err(|_| "the handler didn't finish in time".to_string())?
        .map_err(|e| format!("the handler crashed: {e}"))??;
    Ok(Ran {
        response: outcome.response.body,
        kv: outcome.public.changed.then_some(outcome.public.map),
        kv_private: outcome.private.changed.then_some(outcome.private.map),
        emitted: outcome.emitted.into_iter().map(|e| (e.name, e.data)).collect(),
    })
}

/// The user acted on an artifact: its handler runs (the KV view it leaves
/// goes to the user's browsers), or, without one, the action goes to the
/// assistant as a message.
pub async fn backflow(app: &App, user: Uuid, id: Uuid, i: BackflowInput) -> Result<Value, ApiError> {
    let a = owned(app, user, id).await?;
    if a.kind != "artifact" {
        return Err(ApiError::bad_request("only artifacts take backflow"));
    }
    if i.action.is_empty() || i.action.len() > 64 {
        return Err(ApiError::bad_request("action: 1-64 characters"));
    }
    if i.value.to_string().len() > 64 * 1024 {
        return Err(ApiError::payload_too_large("the action's value is over 64 KiB"));
    }
    let version = match i.version.as_deref().and_then(|v| v.parse::<i32>().ok()) {
        Some(v) => v,
        None => latest_version(app, id).await?,
    };
    let handlers: Option<Value> = sqlx::query_scalar("SELECT handlers FROM artifact_versions WHERE artifact_id = $1 AND version = $2").bind(id).bind(version).fetch_optional(&app.pool).await.map_err(internal)?;
    let handler = handlers.as_ref().map(|h| h[&i.action].clone()).filter(|h| h.is_object());
    let record = |source: &'static str, action: String, value: Value, read: bool| {
        sqlx::query("INSERT INTO artifact_events (artifact_id, version, source, action, value, read_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)")
            .bind(id)
            .bind(version)
            .bind(source)
            .bind(action)
            .bind(value)
            .bind(read)
    };

    let Some(handler) = handler else {
        // No handler: it's for the assistant, as the user's message.
        record("user", i.action.clone(), i.value.clone(), true).execute(&app.pool).await.map_err(internal)?;
        let value = if i.value.is_null() { String::new() } else { format!(": {}", truncate(&i.value.to_string(), 1500)) };
        let text = format!("[On the page \"{}\"] {}{value}", a.title, i.action);
        crate::chat::send(app, user, Some(a.conversation_id), &text, &i.lang).await?;
        return Ok(json!({ "response": null, "sent": true }));
    };

    // One run at a time per page: the handler reads and writes its KV.
    let mut tx = app.pool.begin().await.map_err(internal)?;
    sqlx::query("INSERT INTO artifact_state (artifact_id) VALUES ($1) ON CONFLICT DO NOTHING").bind(id).execute(&mut *tx).await.map_err(internal)?;
    let (kv, kv_private): (Value, Value) = sqlx::query_as("SELECT kv, kv_private FROM artifact_state WHERE artifact_id = $1 FOR UPDATE").bind(id).fetch_one(&mut *tx).await.map_err(internal)?;
    let obj = |v: Value| v.as_object().cloned().unwrap_or_default();
    let event = gui_schema::Event {
        schema_version: gui_schema::EVENT_SCHEMA_VERSION.into(),
        action: i.action.clone(),
        component: i.component.clone(),
        value: i.value.clone(),
        surface: format!("chat/{}/{}", a.conversation_id, a.name.as_deref().unwrap_or("page")),
        version: Some(version.to_string()),
        scope: gui_schema::Scope::Public,
        source: Some("ui".into()),
        received_at: chrono::Utc::now().to_rfc3339(),
    };
    let source = handler["source"].as_str().unwrap_or_default().to_string();
    let wall_ms = handler["wall_ms"].as_u64().unwrap_or(2000).clamp(100, 5000);
    record("user", i.action.clone(), i.value.clone(), false).execute(&mut *tx).await.map_err(internal)?;
    let ran = match run_handler(source, wall_ms, event, obj(kv.clone()), obj(kv_private)).await {
        Ok(r) => r,
        Err(e) => {
            tx.commit().await.map_err(internal)?;
            tracing::info!(artifact = %id, action = i.action, "handler failed: {e}");
            return Err(ApiError::bad_request(format!("the page's handler failed: {e}")));
        }
    };
    let kv_now = ran.kv.map(Value::Object).unwrap_or(kv);
    if kv_now.to_string().len() > MAX_KV {
        return Err(ApiError::bad_request(format!("the handler's KV view is over {} KiB", MAX_KV / 1024)));
    }
    sqlx::query("UPDATE artifact_state SET kv = $2, kv_private = COALESCE($3, kv_private), updated_at = now() WHERE artifact_id = $1")
        .bind(id)
        .bind(&kv_now)
        .bind(ran.kv_private.map(Value::Object))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    for (name, data) in ran.emitted.into_iter().take(32) {
        record("handler", truncate(&name, 64), data, false).execute(&mut *tx).await.map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    emit(app, user, a.conversation_id, "artifact_kv", json!({ "artifact": id, "kv": kv_now }));
    Ok(json!({ "response": ran.response, "kv": kv_now }))
}

#[derive(Deserialize)]
pub struct MessageInput {
    pub text: String,
    #[serde(default = "en")]
    pub lang: String,
}

/// The page sends the user's message (ui/message).
pub async fn message(app: &App, user: Uuid, id: Uuid, i: MessageInput) -> Result<Value, ApiError> {
    let a = owned(app, user, id).await?;
    crate::chat::send(app, user, Some(a.conversation_id), &i.text, &i.lang).await?;
    Ok(json!({}))
}

/// The page reports what the assistant should know (ui/update-model-context);
/// the next message carries it.
pub async fn context(app: &App, user: Uuid, id: Uuid, report: Value) -> Result<Value, ApiError> {
    owned(app, user, id).await?;
    if report.to_string().len() > 16 * 1024 {
        return Err(ApiError::payload_too_large("model context: at most 16 KiB"));
    }
    sqlx::query("UPDATE artifacts SET model_context = $2, context_pending = true WHERE id = $1").bind(id).bind(report).execute(&app.pool).await.map_err(internal)?;
    Ok(json!({}))
}

#[derive(Deserialize)]
pub struct CallInput {
    pub name: String,
    #[serde(default)]
    pub arguments: Map<String, Value>,
    /// The user confirmed this call in the chat (after a `confirm` answer).
    #[serde(default)]
    pub confirmed: bool,
}

/// Each page's recent calls, for the static check (duplicates, loops).
// ponytail: in memory, last 20 per page, forgotten on restart; persist if pages run long sessions.
static PAGE_CALLS: LazyLock<Mutex<HashMap<Uuid, Vec<Call>>>> = LazyLock::new(Default::default);

fn risk_of_tool(tool: Option<&rmcp::model::Tool>, name: &str) -> Risk {
    match tool.and_then(|t| t.annotations.as_ref()) {
        Some(a) if a.read_only_hint == Some(true) => Risk::ReadOnly,
        Some(a) if a.destructive_hint == Some(true) => Risk::Destructive,
        Some(a) if a.destructive_hint == Some(false) => Risk::Mutating,
        _ => hook::risk_of(name),
    }
}

fn tool_error(why: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": why.into() }], "isError": true })
}

/// A page calls a tool (MCP Apps `tools/call`). An artifact has the
/// connector's three tools (list_services, list_tools, call_tool); a view
/// has its own service's tools that it may call. Calls are judged like the
/// assistant's; purchases never happen from a page.
pub async fn call(app: &App, user: Uuid, id: Uuid, i: CallInput) -> Result<Value, ApiError> {
    let a = owned(app, user, id).await?;
    let connector = app.connector.as_ref().ok_or_else(|| ApiError::bad_request("no services are configured"))?;
    let tenant = user.to_string();
    let (service, tool, arguments, from_view) = match (a.kind.as_str(), i.name.as_str()) {
        ("artifact", "list_services") => {
            return Ok(match connector.service_entries(&tenant).await {
                Ok(s) => json!({ "content": [], "structuredContent": { "services": s } }),
                Err(e) => tool_error(format!("listing your services failed: {e}")),
            });
        }
        ("artifact", "list_tools") => {
            let service = i.arguments.get("service").and_then(Value::as_str).ok_or_else(|| ApiError::bad_request("list_tools needs {service}"))?;
            return Ok(match connector.service_tools(&tenant, service).await {
                Ok(t) => json!({ "content": [], "structuredContent": { "service": service, "tools": t } }),
                Err(e) => tool_error(e),
            });
        }
        ("artifact", "call_tool") => {
            let field = |k: &str| i.arguments.get(k).and_then(Value::as_str).map(str::to_owned);
            let (Some(service), Some(tool)) = (field("service"), field("tool")) else {
                return Err(ApiError::bad_request("call_tool needs {service, tool, arguments}"));
            };
            let args = i.arguments.get("arguments").and_then(Value::as_object).cloned().unwrap_or_default();
            (service, tool, args, false)
        }
        ("artifact", other) => return Ok(tool_error(format!("unknown tool {other}: a page has list_services, list_tools and call_tool"))),
        (_, tool) => (a.service.clone().unwrap_or_default(), tool.to_string(), i.arguments.clone(), true),
    };

    let call = Call { name: format!("{service}.{tool}"), args: Value::Object(arguments.clone()) };
    let client = format!("page: {}", truncate(&a.title, 60));
    let as_connector = json!({ "service": service, "tool": tool, "arguments": arguments });
    if let Some(purchases) = &app.purchases
        && purchases.check(&tenant, "connector.call_tool", &as_connector).await.is_some()
    {
        audit(app, user, &client, &call.name, "deny", "purchases aren't made from pages").await;
        return Ok(tool_error("This would buy something; purchases aren't made from pages. Ask the assistant in the chat instead."));
    }
    let listed = connector.tool(&tenant, &service, &tool).await.ok().flatten();
    let risk = risk_of_tool(listed.as_ref(), &call.name);
    let history = PAGE_CALLS.lock().expect("page calls").get(&id).cloned().unwrap_or_default();
    let reason = format!("(called by the page \"{}\" in the chat, while the user has it open)", a.title);
    let verdict = match hook::judge_present(app, &call, risk, &history, &reason).await {
        Judgement::Allow(why) => Ok(why),
        Judgement::Deny(why) => Err(why),
        Judgement::Ask(_) if i.confirmed => Ok("confirmed by the user".into()),
        Judgement::Ask(why) => {
            let message = format!("The page \"{}\" wants to run {} with {}.\n{why}", a.title, call.name, truncate(&call.args.to_string(), 600));
            return Ok(json!({ "confirm": { "message": message, "tool": call.name } }));
        }
    };
    match verdict {
        Ok(why) => {
            audit(app, user, &client, &call.name, "allow", &why).await;
            {
                let mut calls = PAGE_CALLS.lock().expect("page calls");
                if calls.len() > 10_000 {
                    calls.clear();
                }
                let h = calls.entry(id).or_default();
                h.push(call.clone());
                let excess = h.len().saturating_sub(20);
                h.drain(..excess);
            }
            let result = if from_view {
                connector.call_from_app(&tenant, &service, &tool, Some(arguments)).await
            } else {
                connector.call(&tenant, &service, &tool, Some(arguments)).await
            };
            serde_json::to_value(result).map_err(internal)
        }
        Err(why) => {
            audit(app, user, &client, &call.name, "deny", &why).await;
            Ok(tool_error(why))
        }
    }
}

/// Kept with the MCP clients' calls (Settings, data export).
async fn audit(app: &App, user: Uuid, client: &str, tool: &str, decision: &str, why: &str) {
    tracing::info!(target: "plan_ai_chat::pages", %user, client, tool, decision, why, "page tool call");
    let res = sqlx::query("INSERT INTO mcp_calls (user_id, client, tool, decision, reason) VALUES ($1, $2, $3, $4, $5)")
        .bind(user)
        .bind(client)
        .bind(tool)
        .bind(decision)
        .bind(why)
        .execute(&app.pool)
        .await;
    if let Err(e) = res {
        tracing::error!(%user, tool, "recording a page's call: {e}");
    }
}

// ─── MCP Apps views from the connector ──────────────────────────────────────

/// Keeps the views of the assistant's service calls (see
/// `plan_ai_connector::views`), in the calling agent's conversation.
pub struct ChatViews(pub sqlx::PgPool);

#[async_trait::async_trait]
impl plan_ai_connector::ViewSink for ChatViews {
    async fn view(&self, v: plan_ai_connector::ToolView) -> Result<String, String> {
        let user: Uuid = v.tenant.parse().map_err(|e| format!("tenant: {e}"))?;
        let agent = v.caller.as_ref().and_then(|m| m.get("subnet/agent")).and_then(Value::as_str).ok_or("no calling agent")?;
        let conversation: Uuid = sqlx::query_scalar("SELECT id FROM conversations WHERE agent_id = $1 AND user_id = $2")
            .bind(agent)
            .bind(user)
            .fetch_optional(&self.0)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("not a chat conversation")?;
        let html = plan_ai_connector::views::view_html(&v.resource).ok_or("the view isn't text")?;
        if html.len() > 4 * MAX_HTML {
            return Err("the view is over 2 MiB".into());
        }
        let ui = plan_ai_connector::views::view_meta(&v.resource);
        let label = v.tool.title.clone().or_else(|| v.tool.annotations.as_ref().and_then(|a| a.title.clone())).unwrap_or_else(|| v.tool.name.to_string());
        let title = truncate(&format!("{} · {label}", v.service), 120);
        let mut definition = serde_json::to_value(&v.tool).unwrap_or(Value::Null);
        if let Some(d) = definition.as_object_mut() {
            d.remove("icons");
        }
        let meta = json!({ "tool": v.tool.name, "definition": definition, "arguments": v.arguments, "result": v.result, "ui": ui });
        let id = Uuid::new_v4();
        let mut tx = self.0.begin().await.map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO artifacts (id, user_id, conversation_id, kind, title, service) VALUES ($1, $2, $3, 'mcp_app', $4, $5)")
            .bind(id)
            .bind(user)
            .bind(conversation)
            .bind(&title)
            .bind(&v.service)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO artifact_versions (artifact_id, version, html, meta) VALUES ($1, 1, $2, $3)")
            .bind(id)
            .bind(&html)
            .bind(&meta)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(id.to_string())
    }
}

/// The page a finished tool call made, for its message in the chat: an
/// artifact the assistant published, or a service tool's view.
pub async fn of_tool_result(pool: &sqlx::PgPool, tool: &str, content: &str) -> Option<Value> {
    let id: Uuid = match tool {
        "chat.artifact_publish" => serde_json::from_str::<Value>(content).ok()?["artifact"].as_str()?.parse().ok()?,
        "connector.call_tool" => plan_ai_connector::views::view_id_in(content)?.parse().ok()?,
        _ => return None,
    };
    let row: (String, String, Option<i32>) = sqlx::query_as("SELECT a.kind, a.title, (SELECT max(version) FROM artifact_versions v WHERE v.artifact_id = a.id) FROM artifacts a WHERE a.id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()??;
    Some(json!({ "id": id, "kind": row.0, "title": row.1, "version": row.2 }))
}

// ─── Routes ─────────────────────────────────────────────────────────────────

mod http {
    use axum::extract::{Extension, Path, Query, State};
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use plan_ai_api_mcp::{ApiError, SessionPrincipal};
    use serde_json::Value;
    use uuid::Uuid;

    use crate::state::AppState;

    type Out = Result<Json<Value>, ApiError>;

    /// The signed-in, approved user; changes (`write`) not while impersonating.
    fn user(p: &Option<Extension<SessionPrincipal>>, write: bool) -> Result<Uuid, ApiError> {
        let Some(Extension(p)) = p else { return Err(ApiError::unauthorized("pages are for signed-in browsers")) };
        if write {
            crate::api::require_not_impersonating(&p.0)?;
        }
        crate::api::user_of(&p.0)
    }

    async fn document(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>, Query(q): Query<super::DocQuery>) -> Out {
        super::document(&app, user(&p, false)?, id, q).await.map(Json)
    }
    async fn kv(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>) -> Out {
        super::kv(&app, user(&p, false)?, id).await.map(Json)
    }
    async fn backflow(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>, Json(i): Json<super::BackflowInput>) -> Out {
        super::backflow(&app, user(&p, true)?, id, i).await.map(Json)
    }
    async fn call(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>, Json(i): Json<super::CallInput>) -> Out {
        super::call(&app, user(&p, true)?, id, i).await.map(Json)
    }
    async fn message(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>, Json(i): Json<super::MessageInput>) -> Out {
        super::message(&app, user(&p, true)?, id, i).await.map(Json)
    }
    async fn context(State(app): State<AppState>, p: Option<Extension<SessionPrincipal>>, Path(id): Path<Uuid>, Json(i): Json<Value>) -> Out {
        super::context(&app, user(&p, true)?, id, i).await.map(Json)
    }

    /// The browser's side of pages (the iframe host): `/api/v1/pages/{id}…`.
    pub fn routes(app: AppState) -> Router {
        Router::new()
            .route("/api/v1/pages/{id}", get(document))
            .route("/api/v1/pages/{id}/kv", get(kv))
            .route("/api/v1/pages/{id}/backflow", post(backflow))
            .route("/api/v1/pages/{id}/call", post(call))
            .route("/api/v1/pages/{id}/message", post(message))
            .route("/api/v1/pages/{id}/context", post(context))
            .with_state(app)
    }
}

pub use http::routes;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_suite_inlines_as_one_module() {
        let m = &*SUITE_MODULE;
        assert!(!m.contains("from \"./lib.js\""), "no import left");
        assert!(!m.lines().any(|l| l.trim_start().starts_with("export ")), "no export left");
        assert!(m.contains("function niceTicks") && m.contains("customElements.define(\"ui-chart\""));
        assert!(!m.contains("</script"), "the module can sit in a <script>");
    }

    #[test]
    fn a_fragment_gets_the_suite_and_the_csp_first() {
        let doc = artifact_document("<ui-heading>Hi</ui-heading>", "T <x>", "chat/c/p", 3, Some("light"));
        let head = &doc[..doc.find("</head>").unwrap()];
        assert!(head.starts_with("<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\""));
        assert!(head.contains("connect-src 'none'") && head.contains("<meta name=\"gui-transport\" content=\"postmessage\">"));
        assert!(head.contains("<meta name=\"version\" content=\"3\">") && head.contains(":root{color-scheme:light}"));
        assert!(doc.contains("<title>T &lt;x&gt;</title>") && doc.contains("<main class=\"gui-surface\"><ui-heading>Hi</ui-heading></main>"));
    }

    #[test]
    fn a_document_gets_them_at_the_top_of_its_head() {
        let doc = artifact_document("<!DOCTYPE html><HTML><HEAD lang=x><script>a()</script></HEAD><body>b</body></HTML>", "t", "s", 1, None);
        let csp = doc.find("Content-Security-Policy").unwrap();
        assert!(csp < doc.find("<script>a()").unwrap(), "the CSP governs the page's own scripts");
        assert!(doc.starts_with("<!DOCTYPE html><HTML><HEAD lang=x><meta charset"));
        let bare = view_document("<p>x</p>", &Value::Null);
        assert!(bare.starts_with("<head><meta charset=\"utf-8\"><meta http-equiv"));
        let html_only = into_head("<html lang=en><body>x</body></html>", "<i>");
        assert_eq!(html_only, "<html lang=en><head><i></head><body>x</body></html>");
    }

    #[test]
    fn view_csp_takes_only_wellformed_origins() {
        let ui = json!({ "csp": {
            "connectDomains": ["https://api.example.com", "http://plain.example", "https://x; script-src *"],
            "resourceDomains": ["https://*.cdn.example:8443"],
        } });
        let csp = view_csp(&ui);
        assert!(csp.contains("connect-src https://api.example.com;"), "{csp}");
        assert!(!csp.contains("plain.example") && !csp.contains("script-src *"), "{csp}");
        assert!(csp.contains("script-src 'self' 'unsafe-inline' https://*.cdn.example:8443;"), "{csp}");
        assert!(csp.contains("frame-src 'none'") && csp.contains("object-src 'none'"));
        let default = view_csp(&Value::Null);
        assert!(default.contains("connect-src 'none'") && default.contains("base-uri 'self'"));
    }

    #[test]
    fn names() {
        assert!(valid_name("sales-q3") && valid_name("a_1"));
        assert!(!valid_name("") && !valid_name("-x") && !valid_name("Sales") && !valid_name("a b") && !valid_name(&"x".repeat(65)));
    }

    #[test]
    fn handlers_run_with_their_kv_and_nothing_else() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let event = |action: &str| gui_schema::Event {
            schema_version: gui_schema::EVENT_SCHEMA_VERSION.into(),
            action: action.into(),
            component: None,
            value: json!({ "by": 2 }),
            surface: "chat/c/p".into(),
            version: None,
            scope: gui_schema::Scope::Public,
            source: Some("ui".into()),
            received_at: "t".into(),
        };
        let src = r#"function handle(event, host) {
            host.kv.set("hits", (host.kv.get("hits") || 0) + event.value.by);
            host.emit("bumped", { hits: host.kv.get("hits") });
            return { ok: true };
        }"#;
        let mut kv = Map::new();
        kv.insert("hits".into(), json!(1));
        let ran = rt.block_on(run_handler(src.into(), 2000, event("bump"), kv, Map::new())).unwrap();
        assert_eq!(ran.response, json!({ "ok": true }));
        assert_eq!(ran.kv.unwrap()["hits"], json!(3));
        assert_eq!(ran.emitted, vec![("bumped".to_string(), json!({ "hits": 3 }))]);

        let fetch = r#"function handle(event, host) { return host.http.fetch({ url: "https://example.com" }); }"#;
        assert!(rt.block_on(run_handler(fetch.into(), 2000, event("x"), Map::new(), Map::new())).is_err(), "no network");
        let spin = "function handle() { for (;;) {} }";
        assert!(rt.block_on(run_handler(spin.into(), 200, event("x"), Map::new(), Map::new())).is_err(), "time limit");
    }
}
