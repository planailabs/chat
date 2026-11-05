//! OAuth connections (MCP OAuth, never Zitadel), for OAuth connectors and
//! configured OAuth apps.
//!
//! Connecting: `GET /connectors/oauth/start?connector=<id>` (signed in)
//! checks the user may connect it, makes a PKCE pair and a state, stores
//! them (the verifier encrypted) bound to the user and to this browser (a
//! cookie whose hash is stored), and redirects to the authorization server.
//! `GET /connectors/oauth/callback` takes the state only from the same
//! user with the same cookie, within ten minutes and once, exchanges the
//! code and stores the tokens encrypted.
//!
//! The connector gets tokens through [`Tokens`] (a `TokenSource`): an
//! access token about to expire is refreshed first (one refresh at a time
//! per connection, by row lock). A refresh the authorization server refuses,
//! no refresh token, or a 401 from the service marks the connection
//! `needs_reconnect`; the agent and the settings then say so, with the link.

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Redirect, Response};
use plan_ai_api_mcp::ApiError;
use plan_ai_auth::WebUser;
use plan_ai_connector::oauth::{Discovery, OAuthError, Pkce, RegisteredClient, random_token};
use plan_ai_connector::{ConnectionStatus, Target, TargetAuth, TokenError, TokenSource};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{Connectors, Key, internal};

/// How long a started connection may take.
const FLOW_MINUTES: i32 = 10;
/// Refresh this long before the access token expires.
const REFRESH_MARGIN_SECS: i64 = 60;
const COOKIE: &str = "plan_ai_connector_oauth";

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn slot_name(slot: Option<Uuid>) -> String {
    slot.map(|u| u.to_string()).unwrap_or_else(|| "shared".into())
}

fn oauth_err(e: OAuthError) -> ApiError {
    ApiError::bad_request(e.to_string())
}

#[derive(sqlx::FromRow)]
struct Conn {
    access_token: Vec<u8>,
    refresh_token: Option<Vec<u8>>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    status: String,
    error: Option<String>,
}

impl Connectors {
    /// Discovery and dynamic client registration for `url`.
    pub(crate) async fn discover_and_register(&self, key: &Key, url: &str) -> Result<(Discovery, RegisteredClient), ApiError> {
        let client = self.oauth_client(key);
        let d = client.discover(url).await.map_err(oauth_err)?;
        let c = client.register(&d, &self.redirect_uri(), "plan.ai chat").await.map_err(oauth_err)?;
        Ok((d, c))
    }

    pub(crate) async fn store_client(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        key: &Key,
        url: &str,
        d: &Discovery,
        c: &RegisteredClient,
    ) -> Result<(), ApiError> {
        let crypto = self.crypto()?;
        let secret = c.client_secret.as_deref().map(|s| crypto.seal(&format!("oauth-client:{}", key.stored()), s));
        let id = match key {
            Key::Db(id) => Some(*id),
            Key::App(_) => None,
        };
        sqlx::query(
            "INSERT INTO connector_oauth_clients (connector, connector_id, mcp_url, discovery, client_id, client_secret, auth_method)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (connector) DO UPDATE SET mcp_url = EXCLUDED.mcp_url, discovery = EXCLUDED.discovery, client_id = EXCLUDED.client_id,
                 client_secret = EXCLUDED.client_secret, auth_method = EXCLUDED.auth_method, created_at = now()",
        )
        .bind(key.stored())
        .bind(id)
        .bind(url)
        .bind(sqlx::types::Json(d))
        .bind(&c.client_id)
        .bind(secret)
        .bind(&c.auth_method)
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
        Ok(())
    }

    /// The registered client for `key` at `url`; registered now if there is
    /// none for that URL (configured apps register on first use).
    async fn registered(&self, key: &Key, url: &str) -> Result<(Discovery, RegisteredClient), ApiError> {
        let row: Option<(String, sqlx::types::Json<Discovery>, String, Option<Vec<u8>>, String)> =
            sqlx::query_as("SELECT mcp_url, discovery, client_id, client_secret, auth_method FROM connector_oauth_clients WHERE connector = $1")
                .bind(key.stored())
                .fetch_optional(&self.pool)
                .await
                .map_err(internal)?;
        if let Some((registered_for, d, client_id, secret, auth_method)) = row
            && registered_for == url
        {
            let client_secret = match secret {
                Some(s) => Some(self.crypto()?.open(&format!("oauth-client:{}", key.stored()), &s).map_err(internal)?),
                None => None,
            };
            return Ok((d.0, RegisteredClient { client_id, client_secret, auth_method }));
        }
        let (d, c) = self.discover_and_register(key, url).await?;
        let mut tx = self.pool.begin().await.map_err(internal)?;
        self.store_client(&mut tx, key, url, &d, &c).await?;
        tx.commit().await.map_err(internal)?;
        Ok((d, c))
    }

    /// The MCP URL of `key` (for `user`, who must be allowed to see it).
    async fn mcp_url(&self, user: Uuid, key: &Key) -> Result<String, ApiError> {
        match key {
            Key::Db(id) => Ok(self.row_for_member(user, *id).await?.0.url),
            Key::App(name) => Ok(self.cfg.apps.iter().find(|a| &a.name == name).and_then(|a| a.mcp.as_ref()).map(|m| m.url.clone()).ok_or_else(|| ApiError::not_found("no such connector"))?),
        }
    }

    /// Step 1: where to send the browser, and the nonce for its cookie.
    pub async fn start(&self, user: Uuid, key: &Key) -> Result<(String, String), ApiError> {
        let slot = self.connect_slot(user, key).await?;
        let url = self.mcp_url(user, key).await?;
        let (d, c) = self.registered(key, &url).await?;
        let pkce = Pkce::new();
        let state = random_token();
        let nonce = random_token();
        let state_hash = sha256_hex(&state);
        let verifier = self.crypto()?.seal(&format!("oauth-state:{state_hash}"), &pkce.verifier);
        sqlx::query("DELETE FROM connector_oauth_states WHERE created_at < now() - make_interval(mins => $1)").bind(FLOW_MINUTES).execute(&self.pool).await.map_err(internal)?;
        sqlx::query("INSERT INTO connector_oauth_states (state_hash, connector, user_id, shared, browser_hash, code_verifier) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&state_hash)
            .bind(key.stored())
            .bind(user)
            .bind(slot.is_none())
            .bind(sha256_hex(&nonce))
            .bind(verifier)
            .execute(&self.pool)
            .await
            .map_err(internal)?;
        Ok((self.oauth_client(key).authorize_url(&d, &c, &self.redirect_uri(), &state, &pkce), nonce))
    }

    /// Step 2: the authorization server sent the browser back. Returns the
    /// connector's name.
    pub async fn callback(&self, user: Uuid, state: &str, code: &str, nonce: Option<&str>) -> Result<String, ApiError> {
        let state_hash = sha256_hex(state);
        // Taken once, whatever happens next.
        let row: Option<(String, Uuid, bool, String, Vec<u8>, bool)> = sqlx::query_as(
            "DELETE FROM connector_oauth_states WHERE state_hash = $1
             RETURNING connector, user_id, shared, browser_hash, code_verifier, created_at > now() - make_interval(mins => $2)",
        )
        .bind(&state_hash)
        .bind(FLOW_MINUTES)
        .fetch_optional(&self.pool)
        .await
        .map_err(internal)?;
        let Some((stored_key, started_by, shared, browser_hash, verifier, fresh)) = row else {
            return Err(ApiError::bad_request("this sign-in link is unknown or was used already; start connecting again"));
        };
        // The same signed-in user, in the same browser.
        if started_by != user || nonce.map(sha256_hex).as_deref() != Some(browser_hash.as_str()) {
            tracing::warn!(target: "plan_ai_chat::audit", %user, %started_by, connector = stored_key, "OAuth callback from another session refused");
            return Err(ApiError::forbidden("this connection was started in another session; start connecting again here"));
        }
        if !fresh {
            return Err(ApiError::bad_request("connecting took too long; start again"));
        }
        let key = Key::parse(&stored_key).ok_or_else(|| internal("a stored connector key doesn't parse"))?;
        // Still allowed (roles may have changed meanwhile).
        let slot = self.connect_slot(user, &key).await?;
        if slot.is_none() != shared {
            return Err(ApiError::forbidden("the connector's mode changed; start connecting again"));
        }
        let verifier = self.crypto()?.open(&format!("oauth-state:{state_hash}"), &verifier).map_err(internal)?;
        let url = self.mcp_url(user, &key).await?;
        let (d, c) = self.registered(&key, &url).await?;
        let tokens = self.oauth_client(&key).exchange_code(&d, &c, code, &verifier, &self.redirect_uri()).await.map_err(oauth_err)?;
        self.save_tokens(&key, slot, Some(user), &tokens.access_token, tokens.refresh_token.as_deref(), tokens.expires_in).await?;
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = key.stored(), shared, "connector connected");
        Ok(match &key {
            Key::App(name) => name.clone(),
            Key::Db(id) => self.row_for_member(user, *id).await?.0.name,
        })
    }

    async fn save_tokens(&self, key: &Key, slot: Option<Uuid>, by: Option<Uuid>, access: &str, refresh: Option<&str>, expires_in: Option<u64>) -> Result<(), ApiError> {
        let crypto = self.crypto()?;
        let aad = format!("{}:{}", key.stored(), slot_name(slot));
        let access = crypto.seal(&format!("oauth-token:{aad}"), access);
        let refresh = refresh.map(|r| crypto.seal(&format!("oauth-refresh:{aad}"), r));
        let expires = expires_in.map(|s| chrono::Utc::now() + chrono::Duration::seconds(s.min(10 * 365 * 86400) as i64));
        let id = match key {
            Key::Db(id) => Some(*id),
            Key::App(_) => None,
        };
        sqlx::query(
            "INSERT INTO connector_connections (id, connector, connector_id, user_id, connected_by, access_token, refresh_token, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (connector, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
                 connected_by = EXCLUDED.connected_by, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
                 expires_at = EXCLUDED.expires_at, status = 'connected', error = NULL, updated_at = now()",
        )
        .bind(Uuid::new_v4())
        .bind(key.stored())
        .bind(id)
        .bind(slot)
        .bind(by)
        .bind(access)
        .bind(refresh)
        .bind(expires)
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        Ok(())
    }

    async fn mark_reconnect(&self, key: &Key, slot: Option<Uuid>, why: &str) {
        let res = sqlx::query("UPDATE connector_connections SET status = 'needs_reconnect', error = $3, updated_at = now() WHERE connector = $1 AND user_id IS NOT DISTINCT FROM $2")
            .bind(key.stored())
            .bind(slot)
            .bind(why)
            .execute(&self.pool)
            .await;
        if let Err(e) = res {
            tracing::error!(connector = key.stored(), "marking a connection for reconnecting: {e}");
        }
    }

    /// Whose connection an OAuth target uses for `tenant`.
    async fn slot_of(&self, tenant: Uuid, key: &Key) -> Result<Option<Uuid>, String> {
        match key {
            Key::App(_) => Ok(Some(tenant)),
            Key::Db(id) => {
                let mode: Option<Option<String>> = sqlx::query_scalar("SELECT oauth_mode FROM connectors WHERE id = $1").bind(id).fetch_optional(&self.pool).await.map_err(|e| e.to_string())?;
                Ok(if mode.flatten().as_deref() == Some("shared") { None } else { Some(tenant) })
            }
        }
    }

    fn not_connected(&self, service: &str, key: &Key, slot: Option<Uuid>) -> String {
        let link = self.connect_link(key);
        match slot {
            Some(_) => format!("{service} isn't connected to the user's account yet. Ask them to connect it first (Settings → Connectors, or open {link})."),
            None => format!("{service} isn't connected yet. A team admin has to connect it (Settings → Connectors, or {link})."),
        }
    }

    fn reconnect(&self, service: &str, key: &Key, why: &str) -> String {
        format!("{service} needs to be connected again ({why}). Ask the user to reconnect it (Settings → Connectors, or open {}).", self.connect_link(key))
    }

    /// A fresh access token, refreshing it first when it's about to expire.
    async fn access_token(&self, tenant: Uuid, target: &Target, key: &Key) -> Result<String, TokenError> {
        let failed = |e: &dyn std::fmt::Display| TokenError::Failed(format!("{}: {e}", target.name));
        let crypto = self.crypto().map_err(|e| failed(&e))?;
        let slot = self.slot_of(tenant, key).await.map_err(|e| failed(&e))?;
        let aad = format!("{}:{}", key.stored(), slot_name(slot));
        let mut tx = self.pool.begin().await.map_err(|e| failed(&e))?;
        // Locked: concurrent calls wait for one refresh instead of each spending the refresh token.
        let conn: Option<Conn> = sqlx::query_as(
            "SELECT access_token, refresh_token, expires_at, status, error FROM connector_connections
             WHERE connector = $1 AND user_id IS NOT DISTINCT FROM $2 FOR UPDATE",
        )
        .bind(key.stored())
        .bind(slot)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| failed(&e))?;
        let Some(conn) = conn else { return Err(TokenError::NotConnected(self.not_connected(&target.name, key, slot))) };
        if conn.status == "needs_reconnect" {
            return Err(TokenError::NeedsReconnect(self.reconnect(&target.name, key, conn.error.as_deref().unwrap_or("it was refused"))));
        }
        let soon = chrono::Utc::now() + chrono::Duration::seconds(REFRESH_MARGIN_SECS);
        if conn.expires_at.is_none_or(|e| e > soon) {
            return crypto.open(&format!("oauth-token:{aad}"), &conn.access_token).map_err(|e| failed(&e));
        }
        let Some(refresh) = conn.refresh_token else {
            drop(tx);
            let why = "the access token expired and there is no refresh token";
            self.mark_reconnect(key, slot, why).await;
            return Err(TokenError::NeedsReconnect(self.reconnect(&target.name, key, why)));
        };
        let refresh = crypto.open(&format!("oauth-refresh:{aad}"), &refresh).map_err(|e| failed(&e))?;
        let (d, c) = self.registered(key, &target.mcp_url).await.map_err(|e| failed(&e))?;
        match self.oauth_client(key).refresh(&d, &c, &refresh).await {
            Ok(t) => {
                let access = crypto.seal(&format!("oauth-token:{aad}"), &t.access_token);
                // No new refresh token: the old one stays valid.
                let refresh = crypto.seal(&format!("oauth-refresh:{aad}"), t.refresh_token.as_deref().unwrap_or(&refresh));
                let expires = t.expires_in.map(|s| chrono::Utc::now() + chrono::Duration::seconds(s.min(10 * 365 * 86400) as i64));
                sqlx::query(
                    "UPDATE connector_connections SET access_token = $3, refresh_token = $4, expires_at = $5, updated_at = now()
                     WHERE connector = $1 AND user_id IS NOT DISTINCT FROM $2",
                )
                .bind(key.stored())
                .bind(slot)
                .bind(access)
                .bind(refresh)
                .bind(expires)
                .execute(&mut *tx)
                .await
                .map_err(|e| failed(&e))?;
                tx.commit().await.map_err(|e| failed(&e))?;
                Ok(t.access_token)
            }
            // The grant is gone: someone has to connect again.
            Err(e @ OAuthError::Refused { .. }) => {
                drop(tx);
                let why = format!("refreshing the token failed: {e}");
                self.mark_reconnect(key, slot, &why).await;
                Err(TokenError::NeedsReconnect(self.reconnect(&target.name, key, &why)))
            }
            // Unreachable or confused: try again later, nothing is lost.
            Err(e) => Err(failed(&e)),
        }
    }
}

/// The connector's tokens for OAuth targets.
pub struct Tokens(pub Arc<Connectors>);

fn key_of(target: &Target) -> Option<Key> {
    match &target.auth {
        TargetAuth::Oauth { connection } => Key::parse(connection),
        _ => None,
    }
}

#[async_trait::async_trait]
impl TokenSource for Tokens {
    async fn token(&self, tenant: &str, target: &Target) -> Result<String, TokenError> {
        let (Ok(user), Some(key)) = (tenant.parse::<Uuid>(), key_of(target)) else {
            return Err(TokenError::Failed(format!("{}: not a chat user or connector", target.name)));
        };
        self.0.access_token(user, target, &key).await
    }

    async fn rejected(&self, tenant: &str, target: &Target, _token: &str) -> String {
        let why = "the service refused the token";
        let (Ok(user), Some(key)) = (tenant.parse::<Uuid>(), key_of(target)) else { return format!("{}: {why}", target.name) };
        match self.0.slot_of(user, &key).await {
            Ok(slot) => self.0.mark_reconnect(&key, slot, why).await,
            Err(e) => tracing::error!(connector = key.stored(), "{e}"),
        }
        tracing::info!(target: "plan_ai_chat::audit", %user, connector = key.stored(), "connector token refused: needs reconnecting");
        self.0.reconnect(&target.name, &key, why)
    }

    async fn status(&self, tenant: &str, target: &Target) -> Option<ConnectionStatus> {
        let user: Uuid = tenant.parse().ok()?;
        let key = key_of(target)?;
        let slot = self.0.slot_of(user, &key).await.ok()?;
        let (status, error) = self.0.connection_status(&key, slot).await.ok()?;
        match status.as_str() {
            "connect_first" => Some(ConnectionStatus { status, message: self.0.not_connected(&target.name, &key, slot) }),
            "needs_reconnect" => Some(ConnectionStatus { status, message: self.0.reconnect(&target.name, &key, error.as_deref().unwrap_or("it was refused")) }),
            _ => None,
        }
    }
}

// ── routes ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StartQuery {
    connector: String,
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn page(status: StatusCode, title: &str, text: &str, back_soon: bool) -> Response {
    let refresh = if back_soon { r#"<meta http-equiv="refresh" content="2;url=/">"# } else { "" };
    let body = format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">{refresh}<title>{t}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}}</style></head>
<body><h1>{t}</h1><p>{x}</p><p><a href="/">Back to the chat</a></p></body></html>"#,
        t = escape(title),
        x = escape(text)
    );
    (status, [(header::CACHE_CONTROL, "no-store")], Html(body)).into_response()
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|c| c.trim().strip_prefix(&format!("{name}=")).map(str::to_owned))
}

/// The signed-in, approved user of a browser request.
async fn browser_user(app: &crate::state::AppState, user: Option<&WebUser>) -> Result<Uuid, Response> {
    let Some(user) = user else { return Err(page(StatusCode::UNAUTHORIZED, "Not signed in", "Sign in to the chat first.", false)) };
    match app.accounts.principal(user).await {
        Ok(p) if p.scopes["pending"] != serde_json::json!(true) => Ok(user.id),
        Ok(_) => Err(page(StatusCode::FORBIDDEN, "Not yet", "Your account is waiting for an admin to approve it.", false)),
        Err(e) => Err(page(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong", &e.to_string(), false)),
    }
}

fn connectors(app: &crate::state::AppState) -> Result<&Arc<Connectors>, Response> {
    app.connectors.as_ref().ok_or_else(|| page(StatusCode::NOT_FOUND, "Not available", "Connectors aren't set up on this server.", false))
}

pub async fn start_route(State(app): State<crate::state::AppState>, req: axum::extract::Request) -> Response {
    let Ok(Query(q)) = Query::<StartQuery>::try_from_uri(req.uri()) else {
        return page(StatusCode::BAD_REQUEST, "Can't connect", "No connector given.", false);
    };
    let c = match connectors(&app) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let user = match browser_user(&app, req.extensions().get::<WebUser>()).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if req.extensions().get::<WebUser>().is_some_and(|u| u.impersonating_from.is_some()) {
        return page(StatusCode::FORBIDDEN, "Can't connect", "Connections can't be made while impersonating.", false);
    }
    let Some(key) = Key::parse(&q.connector) else { return page(StatusCode::BAD_REQUEST, "Can't connect", "Unknown connector.", false) };
    match c.start(user, &key).await {
        Ok((to, nonce)) => {
            let secure = if c.base_url.starts_with("https://") { "; Secure" } else { "" };
            let cookie = format!("{COOKIE}={nonce}; Path=/connectors/oauth; HttpOnly; SameSite=Lax; Max-Age={}{secure}", FLOW_MINUTES * 60);
            ([(header::SET_COOKIE, cookie)], Redirect::to(&to)).into_response()
        }
        Err(e) => page(e.status(), "Can't connect", &e.to_string(), false),
    }
}

pub async fn callback_route(State(app): State<crate::state::AppState>, req: axum::extract::Request) -> Response {
    let Ok(Query(q)) = Query::<CallbackQuery>::try_from_uri(req.uri()) else {
        return page(StatusCode::BAD_REQUEST, "Not connected", "The authorization server's answer is malformed.", false);
    };
    let c = match connectors(&app) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let user = match browser_user(&app, req.extensions().get::<WebUser>()).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    if let Some(e) = &q.error {
        // Spend the state anyway, so it can't be replayed.
        if let Some(s) = &q.state {
            let _ = sqlx::query("DELETE FROM connector_oauth_states WHERE state_hash = $1").bind(sha256_hex(s)).execute(&app.pool).await;
        }
        let why = q.error_description.as_deref().unwrap_or(e);
        return page(StatusCode::BAD_REQUEST, "Not connected", &format!("The service didn't grant access: {why}"), false);
    }
    let (Some(code), Some(state)) = (&q.code, &q.state) else {
        return page(StatusCode::BAD_REQUEST, "Not connected", "The authorization server's answer has no code.", false);
    };
    let nonce = cookie_value(req.headers(), COOKIE);
    let clear = format!("{COOKIE}=; Path=/connectors/oauth; HttpOnly; SameSite=Lax; Max-Age=0");
    let res = match c.callback(user, state, code, nonce.as_deref()).await {
        Ok(name) => page(StatusCode::OK, "Connected", &format!("{name} is connected. The assistant can use it now."), true),
        Err(e) => page(e.status(), "Not connected", &e.to_string(), false),
    };
    let mut res = res;
    if let Ok(v) = clear.parse() {
        res.headers_mut().append(header::SET_COOKIE, v);
    }
    res
}
