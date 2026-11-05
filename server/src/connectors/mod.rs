//! Connectors: MCP servers users and teams add themselves (like Claude's
//! custom connectors), offered to the assistant next to the configured apps.
//!
//! - A connector belongs to a **team** (plan-ai-accounts). Every member sees
//!   and uses it; only the team's **admins** add, change or remove it. A
//!   user's personal connectors are their personal team's, where they are
//!   admin. Accounts waiting for approval have none.
//! - **Auth**: a bearer token (one per connector, shared by the team),
//!   OAuth (generic MCP OAuth, dynamic client registration required), either
//!   `shared` (one connection, made by a team admin, used for every member)
//!   or `per_member` (everyone connects their own account), or none.
//! - **Names** the assistant sees (unique per user): a personal connector
//!   keeps its name (`docs`); a team connector is `<team>/<name>`
//!   (`acme/crm`), `<team>` being the team's name in lowercase with anything
//!   but letters, digits and `-` turned into `-` (at most 24 characters). If
//!   two of the user's teams come out the same (or as `me`), each gets `-`
//!   and the first six hex digits of its id (`acme-3f2a1b/crm`). A configured
//!   app or deployment of the same name wins over a personal connector,
//!   which is then `me/<name>`.
//! - **Reach**: https, public addresses only (`plan_ai_connector::net`),
//!   checked on save and on every connection; answers are size-limited by
//!   the connector.
//! - **Secrets** (bearer tokens, OAuth tokens and client secrets) are
//!   encrypted at rest ([`crypto`]) and never returned: the API shows a
//!   bearer token's last four characters, or "set".

pub mod crypto;
pub mod oauth;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use plan_ai_accounts::{Accounts, Membership, Role};
use plan_ai_api_mcp::ApiError;
use plan_ai_connector::net::{self, Guard};
use plan_ai_connector::oauth::OAuthClient;
use plan_ai_connector::{Target, TargetAuth};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::{AppAuth, Config};
use crypto::Crypto;

/// Connectors one team may have.
pub const MAX_PER_TEAM: i64 = 25;

fn internal(e: impl std::fmt::Display) -> ApiError {
    tracing::error!("connectors: {e:#}");
    ApiError::internal(e.to_string())
}

/// Which connector: one of a team's, or an OAuth app from the config.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Key {
    Db(Uuid),
    App(String),
}

impl Key {
    /// `<uuid>`, `c:<uuid>` or `app:<name>`.
    pub fn parse(s: &str) -> Option<Key> {
        if let Some(name) = s.strip_prefix("app:") {
            return (!name.is_empty()).then(|| Key::App(name.to_owned()));
        }
        s.strip_prefix("c:").unwrap_or(s).parse().ok().map(Key::Db)
    }

    /// As stored (`connector` columns) and as the connector's `TargetAuth::Oauth` key.
    pub fn stored(&self) -> String {
        match self {
            Key::Db(id) => format!("c:{id}"),
            Key::App(name) => format!("app:{name}"),
        }
    }

    /// As the API names it.
    pub fn api_id(&self) -> String {
        match self {
            Key::Db(id) => id.to_string(),
            Key::App(name) => format!("app:{name}"),
        }
    }
}

#[derive(sqlx::FromRow, Clone)]
pub(crate) struct Row {
    pub id: Uuid,
    pub team_id: Uuid,
    pub name: String,
    pub description: String,
    pub url: String,
    pub auth: String,
    pub oauth_mode: Option<String>,
    pub bearer_token: Option<Vec<u8>>,
    pub token_hint: Option<String>,
}

const ROW_COLS: &str = "id, team_id, name, description, url, auth, oauth_mode, bearer_token, token_hint";

/// A connector as one user sees it.
pub(crate) struct Visible {
    pub membership: Membership,
    pub row: Row,
    /// The name the assistant knows it by, for this user.
    pub service: String,
}

// ── API types ───────────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum OauthMode {
    /// One connection for the team, made by an admin.
    Shared,
    /// Every member connects their own account.
    PerMember,
}

impl OauthMode {
    fn as_str(self) -> &'static str {
        match self {
            OauthMode::Shared => "shared",
            OauthMode::PerMember => "per_member",
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum AuthInput {
    /// A static token, sent as `Authorization: Bearer`.
    Bearer { token: String },
    /// MCP OAuth; the server must support dynamic client registration.
    Oauth { mode: OauthMode },
    /// No authentication (public servers).
    None,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateInput {
    /// The team; absent: your personal team. You must be its admin.
    pub team_id: Option<Uuid>,
    /// Lowercase letters, digits, `-` and `_`, at most 40; unique in the team.
    pub name: String,
    /// One line for the assistant: what the server is for.
    #[serde(default)]
    pub description: String,
    /// The server's MCP endpoint (Streamable HTTP), https.
    pub url: String,
    pub auth: AuthInput,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateInput {
    pub id: Uuid,
    pub name: Option<String>,
    pub description: Option<String>,
    /// A new URL; OAuth connectors register again and lose their connections.
    pub url: Option<String>,
    /// A new token (bearer connectors).
    pub token: Option<String>,
    /// A new OAuth mode; existing connections end.
    pub mode: Option<OauthMode>,
}

#[derive(Deserialize, JsonSchema)]
pub struct RefInput {
    /// A connector's id from the list (`app:<name>` for a configured app).
    pub id: String,
}

#[derive(Serialize, JsonSchema, Clone)]
pub struct TeamView {
    pub id: Uuid,
    pub name: String,
    /// Your personal team: these are your own connectors.
    pub personal: bool,
    /// `admin`, `write` or `read`.
    pub role: String,
    /// You may add, change and remove its connectors.
    pub can_manage: bool,
}

#[derive(Serialize, JsonSchema, Clone)]
pub struct ConnectorView {
    /// What `connector_update`, `_delete`, `_connect`, `_disconnect` take.
    pub id: String,
    /// None for a configured app.
    pub team_id: Option<Uuid>,
    pub name: String,
    /// The name the assistant knows it by (e.g. `acme/crm`).
    pub service: String,
    pub description: String,
    pub url: String,
    /// `bearer`, `oauth` or `none`.
    pub auth: String,
    /// `shared` or `per_member` (OAuth).
    pub oauth_mode: Option<String>,
    /// A bearer token's last four characters (`…abcd`), or `set`; never the token.
    pub token: Option<String>,
    /// `ready` (bearer, none), `connected`, `connect_first` or `needs_reconnect`.
    pub status: String,
    /// Why it needs reconnecting.
    pub status_detail: Option<String>,
    /// You may change or remove it.
    pub can_manage: bool,
    /// You may connect or disconnect it (OAuth).
    pub can_connect: bool,
    /// `team`, or `config` for an app the operator configured.
    pub source: String,
}

#[derive(Serialize, JsonSchema)]
pub struct ConnectorList {
    /// Connectors can be added here (the server has an encryption key).
    pub enabled: bool,
    pub teams: Vec<TeamView>,
    pub connectors: Vec<ConnectorView>,
}

#[derive(Serialize, JsonSchema, Debug)]
pub struct ConnectUrl {
    /// Open in the browser where you're signed in to the chat.
    pub url: String,
}

// ── naming ──────────────────────────────────────────────────────────

/// A team's part of a team connector's service name.
pub fn team_slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(24).collect();
    let out = out.trim_end_matches('-').to_owned();
    if out.is_empty() { "team".into() } else { out }
}

/// Service names for `items` (team, connector name) as `user` sees them;
/// `taken` holds the names of configured apps and deployments. See the
/// module docs for the rule.
pub fn service_names(user: Uuid, items: &[(&plan_ai_accounts::Team, &str)], taken: &HashSet<String>) -> Vec<String> {
    let personal = |t: &plan_ai_accounts::Team| t.personal && t.owner_id == user;
    let mut by_slug: HashMap<String, HashSet<Uuid>> = HashMap::new();
    for (t, _) in items.iter().filter(|(t, _)| !personal(t)) {
        by_slug.entry(team_slug(&t.name)).or_default().insert(t.id);
    }
    items
        .iter()
        .map(|(t, name)| {
            if personal(t) {
                return if taken.contains(*name) { format!("me/{name}") } else { (*name).to_owned() };
            }
            let slug = team_slug(&t.name);
            let clash = slug == "me" || by_slug.get(&slug).is_some_and(|ids| ids.len() > 1);
            let slug = if clash { format!("{slug}-{}", &t.id.simple().to_string()[..6]) } else { slug };
            format!("{slug}/{name}")
        })
        .collect()
}

fn valid_name(name: &str) -> Result<String, ApiError> {
    let n = name.trim().to_owned();
    let ok = !n.is_empty()
        && n.len() <= 40
        && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        && n.as_bytes()[0].is_ascii_alphanumeric();
    if ok { Ok(n) } else { Err(ApiError::bad_request("a connector's name is 1–40 lowercase letters, digits, - or _, starting with a letter or digit")) }
}

fn token_hint(token: &str) -> String {
    let chars: Vec<char> = token.chars().collect();
    if chars.len() >= 12 { format!("…{}", chars[chars.len() - 4..].iter().collect::<String>()) } else { "set".into() }
}

fn valid_token(token: &str) -> Result<String, ApiError> {
    let t = token.trim();
    if t.is_empty() || t.len() > 8192 || t.chars().any(|c| c.is_control() || c == ' ') {
        return Err(ApiError::bad_request("the token must be 1–8192 visible characters without spaces"));
    }
    Ok(t.to_owned())
}

// ── the store ───────────────────────────────────────────────────────

pub struct Connectors {
    pub pool: PgPool,
    pub cfg: &'static Config,
    pub accounts: Arc<Accounts>,
    crypto: Option<Crypto>,
    /// What user-defined servers may be (https, public addresses); tests loosen it.
    pub guard: Guard,
    oauth_users: OAuthClient,
    oauth_apps: OAuthClient,
    /// The chat's external URL: OAuth redirects and connect links.
    pub base_url: String,
}

impl Connectors {
    pub fn new(pool: PgPool, cfg: &'static Config, accounts: Arc<Accounts>, guard: Guard, base_url: String) -> anyhow::Result<Self> {
        let crypto = cfg.secrets.connector_key().map_err(anyhow::Error::msg)?.map(|k| Crypto::new(&k));
        Ok(Self {
            pool,
            cfg,
            accounts,
            crypto,
            guard,
            oauth_users: OAuthClient::new(guard).map_err(anyhow::Error::msg)?,
            // The operator's own OAuth apps may live anywhere.
            oauth_apps: OAuthClient::new(Guard::OPEN).map_err(anyhow::Error::msg)?,
            base_url: base_url.trim_end_matches('/').to_owned(),
        })
    }

    /// Whether connectors can be stored (the encryption key is set).
    pub fn enabled(&self) -> bool {
        self.crypto.is_some()
    }

    pub(crate) fn crypto(&self) -> Result<&Crypto, ApiError> {
        self.crypto.as_ref().ok_or_else(|| ApiError::not_found("connectors aren't set up on this server (no [secrets].connector_encryption_key)"))
    }

    /// Fails when connectors were stored but there is no key to read them.
    pub async fn check_startup(&self) -> anyhow::Result<()> {
        if self.crypto.is_some() {
            return Ok(());
        }
        let stored: i64 = sqlx::query_scalar("SELECT (SELECT count(*) FROM connectors) + (SELECT count(*) FROM connector_connections)").fetch_one(&self.pool).await?;
        anyhow::ensure!(stored == 0, "{stored} connectors or connections are stored, but [secrets].connector_encryption_key isn't set: add it to the secrets file");
        Ok(())
    }

    pub fn redirect_uri(&self) -> String {
        format!("{}/connectors/oauth/callback", self.base_url)
    }

    pub fn connect_link(&self, key: &Key) -> String {
        format!("{}/connectors/oauth/start?connector={}", self.base_url, url::form_urlencoded::byte_serialize(key.api_id().as_bytes()).collect::<String>())
    }

    pub(crate) fn oauth_client(&self, key: &Key) -> &OAuthClient {
        match key {
            Key::Db(_) => &self.oauth_users,
            Key::App(_) => &self.oauth_apps,
        }
    }

    /// The approved user's email, or None (pending: no connectors).
    async fn approved_email(&self, user: Uuid) -> Result<Option<String>, ApiError> {
        Ok(self.accounts.user(user).await?.filter(|u| u.approved).map(|u| u.email))
    }

    /// The configured OAuth app `name`, if `email` may see it.
    pub(crate) fn config_app(&self, name: &str, email: &str) -> Option<&'static crate::config::App> {
        self.cfg.apps.iter().find(|a| a.name == name && a.emails.admit(email) && a.mcp.as_ref().is_some_and(|m| m.auth == AppAuth::Oauth))
    }

    /// The connectors `user` sees, with their service names.
    pub(crate) async fn visible(&self, user: Uuid, taken: &HashSet<String>) -> Result<Vec<Visible>, ApiError> {
        if self.approved_email(user).await?.is_none() {
            return Ok(vec![]);
        }
        let memberships = self.accounts.memberships(user).await?;
        let teams: Vec<Uuid> = memberships.iter().map(|m| m.team.id).collect();
        let rows: Vec<Row> = sqlx::query_as(&format!("SELECT {ROW_COLS} FROM connectors WHERE team_id = ANY($1) ORDER BY created_at"))
            .bind(&teams)
            .fetch_all(&self.pool)
            .await
            .map_err(internal)?;
        let items: Vec<(&plan_ai_accounts::Team, &str)> = rows
            .iter()
            .filter_map(|r| memberships.iter().find(|m| m.team.id == r.team_id).map(|m| (&m.team, r.name.as_str())))
            .collect();
        let names = service_names(user, &items, taken);
        Ok(rows
            .into_iter()
            .zip(names)
            .filter_map(|(row, service)| {
                let membership = memberships.iter().find(|m| m.team.id == row.team_id)?.clone();
                Some(Visible { membership, row, service })
            })
            .collect())
    }

    /// The connector's targets for `user` (`taken`: names already used).
    pub async fn targets(&self, user: Uuid, taken: &HashSet<String>) -> Result<Vec<Target>, ApiError> {
        let mut out = vec![];
        for v in self.visible(user, taken).await? {
            let auth = match v.row.auth.as_str() {
                "bearer" => {
                    let sealed = v.row.bearer_token.as_deref().unwrap_or_default();
                    match self.crypto()?.open(&format!("connector-bearer:{}", v.row.id), sealed) {
                        Ok(token) => TargetAuth::Bearer { token },
                        Err(e) => {
                            tracing::error!(connector = %v.row.id, "{e:#}");
                            continue;
                        }
                    }
                }
                "oauth" => TargetAuth::Oauth { connection: Key::Db(v.row.id).stored() },
                _ => TargetAuth::None,
            };
            let description = if v.row.description.is_empty() { format!("{}'s MCP server {}", v.membership.team.name, v.row.url) } else { v.row.description.clone() };
            out.push(Target { name: v.service, description, kind: "custom".into(), mcp_url: v.row.url, auth, public_only: true });
        }
        Ok(out)
    }

    async fn row(&self, id: Uuid) -> Result<Row, ApiError> {
        sqlx::query_as(&format!("SELECT {ROW_COLS} FROM connectors WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(internal)?
            .ok_or_else(|| ApiError::not_found("no such connector"))
    }

    /// The row, if `user` is in its team (else "no such connector").
    pub(crate) async fn row_for_member(&self, user: Uuid, id: Uuid) -> Result<(Row, Role), ApiError> {
        if self.approved_email(user).await?.is_none() {
            return Err(ApiError::forbidden("your account is waiting for an admin to approve it"));
        }
        let row = self.row(id).await?;
        let (role, _) = self.accounts.role(user, row.team_id).await?.ok_or_else(|| ApiError::not_found("no such connector"))?;
        Ok((row, role))
    }

    async fn require_admin(&self, user: Uuid, team: Uuid) -> Result<(), ApiError> {
        match self.accounts.role(user, team).await? {
            Some((Role::Admin, _)) => Ok(()),
            Some(_) => Err(ApiError::forbidden("only the team's admins can add, change or remove its connectors")),
            None => Err(ApiError::not_found("no such team")),
        }
    }

    /// A user-defined server's URL, checked: https, public addresses.
    async fn checked_url(&self, url: &str) -> Result<String, ApiError> {
        let u = net::check_url(url.trim(), self.guard).await.map_err(|e| ApiError::bad_request(e.to_string()))?;
        if u.as_str().len() > 2048 {
            return Err(ApiError::bad_request("the URL is too long"));
        }
        Ok(u.to_string())
    }

    // ── API ─────────────────────────────────────────────────────────

    pub async fn list(&self, user: Uuid, taken: &HashSet<String>) -> Result<ConnectorList, ApiError> {
        let Some(email) = self.approved_email(user).await? else {
            return Ok(ConnectorList { enabled: false, teams: vec![], connectors: vec![] });
        };
        let memberships = self.accounts.memberships(user).await?;
        let teams = memberships
            .iter()
            .map(|m| TeamView {
                id: m.team.id,
                name: m.team.name.clone(),
                personal: m.team.personal && m.team.owner_id == user,
                role: m.role.as_str().into(),
                can_manage: m.role == Role::Admin,
            })
            .collect();
        let mut connectors = vec![];
        if self.enabled() {
            for v in self.visible(user, taken).await? {
                connectors.push(self.view(user, &v).await?);
            }
        }
        // Configured OAuth apps: everyone connects their own account.
        for a in self.cfg.apps.iter().filter(|a| a.emails.admit(&email) && a.mcp.as_ref().is_some_and(|m| m.auth == AppAuth::Oauth)) {
            let key = Key::App(a.name.clone());
            let (status, status_detail) = self.connection_status(&key, Some(user)).await?;
            connectors.push(ConnectorView {
                id: key.api_id(),
                team_id: None,
                name: a.name.clone(),
                service: a.name.clone(),
                description: a.description.clone(),
                url: a.mcp.as_ref().map(|m| m.url.clone()).unwrap_or_default(),
                auth: "oauth".into(),
                oauth_mode: Some("per_member".into()),
                token: None,
                status,
                status_detail,
                can_manage: false,
                can_connect: self.enabled(),
                source: "config".into(),
            });
        }
        Ok(ConnectorList { enabled: self.enabled(), teams, connectors })
    }

    async fn view(&self, user: Uuid, v: &Visible) -> Result<ConnectorView, ApiError> {
        let admin = v.membership.role == Role::Admin;
        let shared = v.row.oauth_mode.as_deref() == Some("shared");
        let (status, status_detail) = if v.row.auth == "oauth" {
            self.connection_status(&Key::Db(v.row.id), (!shared).then_some(user)).await?
        } else {
            ("ready".into(), None)
        };
        Ok(ConnectorView {
            id: v.row.id.to_string(),
            team_id: Some(v.row.team_id),
            name: v.row.name.clone(),
            service: v.service.clone(),
            description: v.row.description.clone(),
            url: v.row.url.clone(),
            auth: v.row.auth.clone(),
            oauth_mode: v.row.oauth_mode.clone(),
            token: v.row.token_hint.clone(),
            status,
            status_detail,
            can_manage: admin,
            can_connect: v.row.auth == "oauth" && (admin || !shared),
            source: "team".into(),
        })
    }

    /// `connected`, `needs_reconnect` (with why) or `connect_first`.
    pub(crate) async fn connection_status(&self, key: &Key, user: Option<Uuid>) -> Result<(String, Option<String>), ApiError> {
        let row: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT status, error FROM connector_connections WHERE connector = $1 AND user_id IS NOT DISTINCT FROM $2",
        )
        .bind(key.stored())
        .bind(user)
        .fetch_optional(&self.pool)
        .await
        .map_err(internal)?;
        Ok(match row {
            None => ("connect_first".into(), None),
            Some((status, error)) => (status, error),
        })
    }

    async fn view_of(&self, user: Uuid, id: Uuid, taken: &HashSet<String>) -> Result<ConnectorView, ApiError> {
        let v = self.visible(user, taken).await?.into_iter().find(|v| v.row.id == id).ok_or_else(|| ApiError::not_found("no such connector"))?;
        self.view(user, &v).await
    }

    pub async fn create(&self, user: Uuid, i: CreateInput, taken: &HashSet<String>) -> Result<ConnectorView, ApiError> {
        let crypto = self.crypto()?;
        let account = self.accounts.user(user).await?.filter(|u| u.approved).ok_or_else(|| ApiError::forbidden("your account is waiting for an admin to approve it"))?;
        let team = match i.team_id {
            Some(t) => t,
            None => self.accounts.personal_team(&account).await?.id,
        };
        self.require_admin(user, team).await?;
        let name = valid_name(&i.name)?;
        let description: String = i.description.trim().chars().take(300).collect();
        let url = self.checked_url(&i.url).await?;
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM connectors WHERE team_id = $1").bind(team).fetch_one(&self.pool).await.map_err(internal)?;
        if count >= MAX_PER_TEAM {
            return Err(ApiError::bad_request(format!("a team can have at most {MAX_PER_TEAM} connectors")));
        }
        let id = Uuid::new_v4();
        let key = Key::Db(id);
        // OAuth: discover and register now, so a server that can't be used is never saved.
        let registered = match &i.auth {
            AuthInput::Oauth { .. } => Some(self.discover_and_register(&key, &url).await?),
            _ => None,
        };
        let (auth, mode, sealed, hint) = match &i.auth {
            AuthInput::Bearer { token } => {
                let token = valid_token(token)?;
                ("bearer", None, Some(crypto.seal(&format!("connector-bearer:{id}"), &token)), Some(token_hint(&token)))
            }
            AuthInput::Oauth { mode } => ("oauth", Some(mode.as_str()), None, None),
            AuthInput::None => ("none", None, None, None),
        };
        let mut tx = self.pool.begin().await.map_err(internal)?;
        sqlx::query(
            "INSERT INTO connectors (id, team_id, name, description, url, auth, oauth_mode, bearer_token, token_hint, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(id)
        .bind(team)
        .bind(&name)
        .bind(&description)
        .bind(&url)
        .bind(auth)
        .bind(mode)
        .bind(&sealed)
        .bind(&hint)
        .bind(user)
        .execute(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(d) if d.is_unique_violation() => ApiError::conflict(format!("the team has a connector named {name} already")),
            _ => internal(e),
        })?;
        if let Some((d, c)) = registered {
            self.store_client(&mut tx, &key, &url, &d, &c).await?;
        }
        tx.commit().await.map_err(internal)?;
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = %id, %team, auth, url, "connector added");
        self.view_of(user, id, taken).await
    }

    pub async fn update(&self, user: Uuid, i: UpdateInput, taken: &HashSet<String>) -> Result<ConnectorView, ApiError> {
        let crypto = self.crypto()?;
        let (row, _) = self.row_for_member(user, i.id).await?;
        self.require_admin(user, row.team_id).await?;
        let key = Key::Db(row.id);
        let name = i.name.as_deref().map(valid_name).transpose()?.unwrap_or(row.name.clone());
        let description = i.description.map(|d| d.trim().chars().take(300).collect::<String>()).unwrap_or(row.description.clone());
        let url = match &i.url {
            Some(u) => self.checked_url(u).await?,
            None => row.url.clone(),
        };
        let url_changed = url != row.url;
        if i.token.is_some() && row.auth != "bearer" {
            return Err(ApiError::bad_request("only bearer connectors have a token"));
        }
        if i.mode.is_some() && row.auth != "oauth" {
            return Err(ApiError::bad_request("only OAuth connectors have a mode"));
        }
        let registered = if url_changed && row.auth == "oauth" { Some(self.discover_and_register(&key, &url).await?) } else { None };
        let (sealed, hint) = match &i.token {
            Some(t) => {
                let t = valid_token(t)?;
                (Some(crypto.seal(&format!("connector-bearer:{}", row.id), &t)), Some(token_hint(&t)))
            }
            None => (row.bearer_token.clone(), row.token_hint.clone()),
        };
        let mode = i.mode.map(|m| m.as_str().to_owned()).or(row.oauth_mode.clone());
        let mut tx = self.pool.begin().await.map_err(internal)?;
        sqlx::query("UPDATE connectors SET name = $2, description = $3, url = $4, bearer_token = $5, token_hint = $6, oauth_mode = $7, updated_at = now() WHERE id = $1")
            .bind(row.id)
            .bind(&name)
            .bind(&description)
            .bind(&url)
            .bind(&sealed)
            .bind(&hint)
            .bind(&mode)
            .execute(&mut *tx)
            .await
            .map_err(|e| match &e {
                sqlx::Error::Database(d) if d.is_unique_violation() => ApiError::conflict(format!("the team has a connector named {name} already")),
                _ => internal(e),
            })?;
        // Another server, or connections of another kind: the old ones end.
        if url_changed || mode != row.oauth_mode {
            sqlx::query("DELETE FROM connector_connections WHERE connector = $1").bind(key.stored()).execute(&mut *tx).await.map_err(internal)?;
        }
        if let Some((d, c)) = registered {
            self.store_client(&mut tx, &key, &url, &d, &c).await?;
        }
        tx.commit().await.map_err(internal)?;
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = %row.id, "connector changed");
        self.view_of(user, row.id, taken).await
    }

    pub async fn delete(&self, user: Uuid, id: &str) -> Result<(), ApiError> {
        let Some(Key::Db(id)) = Key::parse(id) else { return Err(ApiError::bad_request("configured apps can't be removed here")) };
        let (row, _) = self.row_for_member(user, id).await?;
        self.require_admin(user, row.team_id).await?;
        sqlx::query("DELETE FROM connectors WHERE id = $1").bind(id).execute(&self.pool).await.map_err(internal)?;
        sqlx::query("DELETE FROM connector_oauth_states WHERE connector = $1").bind(Key::Db(id).stored()).execute(&self.pool).await.map_err(internal)?;
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = %id, "connector removed");
        Ok(())
    }

    /// Who the connection for `key` belongs to (None: the team's shared
    /// one), if `user` may connect it.
    pub(crate) async fn connect_slot(&self, user: Uuid, key: &Key) -> Result<Option<Uuid>, ApiError> {
        self.crypto()?;
        match key {
            Key::App(name) => {
                let email = self.approved_email(user).await?.ok_or_else(|| ApiError::forbidden("your account is waiting for an admin to approve it"))?;
                self.config_app(name, &email).ok_or_else(|| ApiError::not_found("no such connector"))?;
                Ok(Some(user))
            }
            Key::Db(id) => {
                let (row, role) = self.row_for_member(user, *id).await?;
                match row.oauth_mode.as_deref() {
                    Some("shared") if role == Role::Admin => Ok(None),
                    Some("shared") => Err(ApiError::forbidden("this connector's connection is shared by the team: a team admin connects it")),
                    Some(_) => Ok(Some(user)),
                    None => Err(ApiError::bad_request("only OAuth connectors are connected")),
                }
            }
        }
    }

    /// The link that starts connecting `key` (checks the user may).
    pub async fn connect(&self, user: Uuid, id: &str) -> Result<ConnectUrl, ApiError> {
        let key = Key::parse(id).ok_or_else(|| ApiError::bad_request("not a connector id"))?;
        self.connect_slot(user, &key).await?;
        Ok(ConnectUrl { url: self.connect_link(&key) })
    }

    pub async fn disconnect(&self, user: Uuid, id: &str) -> Result<(), ApiError> {
        let key = Key::parse(id).ok_or_else(|| ApiError::bad_request("not a connector id"))?;
        let slot = self.connect_slot(user, &key).await?;
        sqlx::query("DELETE FROM connector_connections WHERE connector = $1 AND user_id IS NOT DISTINCT FROM $2")
            .bind(key.stored())
            .bind(slot)
            .execute(&self.pool)
            .await
            .map_err(internal)?;
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = key.stored(), shared = slot.is_none(), "connector disconnected");
        Ok(())
    }

    /// The user's connectors and connections, without secrets (data export).
    pub async fn export(&self, user: Uuid) -> Result<serde_json::Value, ApiError> {
        let rows: Vec<serde_json::Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('connector', connector, 'status', status, 'expires_at', expires_at, 'created_at', created_at)
             FROM connector_connections WHERE user_id = $1 OR connected_by = $1 ORDER BY created_at",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        let created: Vec<serde_json::Value> = sqlx::query_scalar(
            "SELECT jsonb_build_object('id', id, 'team_id', team_id, 'name', name, 'url', url, 'auth', auth, 'created_at', created_at)
             FROM connectors WHERE created_by = $1 ORDER BY created_at",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        Ok(serde_json::json!({ "connectors_added": created, "connections": rows }))
    }
}

#[cfg(test)]
pub(crate) mod tests;

#[cfg(test)]
mod naming_tests {
    use super::*;

    fn team(name: &str, personal: bool, owner: Uuid) -> plan_ai_accounts::Team {
        plan_ai_accounts::Team { id: Uuid::new_v4(), name: name.into(), personal, owner_id: owner, plan_id: "p".into(), billing_team_id: None, created_at: chrono::Utc::now() }
    }

    #[test]
    fn service_names_are_unique_per_user() {
        let me = Uuid::new_v4();
        let mine = team("Ada Lovelace", true, me);
        let acme = team("ACME Corp.", false, Uuid::new_v4());
        let acme2 = team("acme corp", false, Uuid::new_v4());
        let other = team("Me", false, Uuid::new_v4());
        let someone_elses_personal = team("Bob", true, Uuid::new_v4());
        let taken: HashSet<String> = ["prometheus".to_string()].into();
        let items = [(&mine, "docs"), (&mine, "prometheus"), (&acme, "crm"), (&acme2, "crm"), (&other, "x"), (&someone_elses_personal, "y")];
        let names = service_names(me, &items, &taken);
        assert_eq!(names[0], "docs");
        assert_eq!(names[1], "me/prometheus", "a configured app keeps its name");
        assert!(names[2].starts_with("acme-corp-") && names[2].ends_with("/crm"), "{}", names[2]);
        assert!(names[3].starts_with("acme-corp-") && names[2] != names[3]);
        assert!(names[4].starts_with("me-") && names[4].ends_with("/x"), "{}", names[4]);
        assert_eq!(names[5], "bob/y");
        let set: HashSet<&String> = names.iter().collect();
        assert_eq!(set.len(), names.len());
        assert!(names.iter().all(|n| !n.contains('.')), "the approval hook splits service.tool on the first dot");
        assert_eq!(team_slug("  Ünïcode — Team!! "), "n-code-team");
        assert_eq!(team_slug("!!!"), "team");
        assert_eq!(team_slug(&"a".repeat(40)).len(), 24);
    }

    #[test]
    fn names_tokens_and_keys() {
        assert!(valid_name("crm").is_ok() && valid_name("my_crm-2").is_ok());
        for bad in ["", "CRM", "a.b", "a/b", "-x", &"a".repeat(41)] {
            assert!(valid_name(bad).is_err(), "{bad}");
        }
        assert_eq!(token_hint("abcdefghijkl1234"), "…1234");
        assert_eq!(token_hint("short"), "set");
        assert!(valid_token("a b").is_err() && valid_token("").is_err() && valid_token(" t0k3n ").unwrap() == "t0k3n");
        let id = Uuid::new_v4();
        assert_eq!(Key::parse(&id.to_string()), Some(Key::Db(id)));
        assert_eq!(Key::parse(&format!("c:{id}")), Some(Key::Db(id)));
        assert_eq!(Key::parse("app:crm"), Some(Key::App("crm".into())));
        assert_eq!(Key::parse("nope"), None);
    }
}
