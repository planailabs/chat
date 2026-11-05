//! Connectors against a throwaway Postgres (initdb and pg_ctl on PATH, e.g.
//! the nix devshell; every test gets its own database) and an in-process
//! OAuth authorization server + MCP server.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use axum::extract::{Query, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine;
use plan_ai_accounts::{Accounts, Role, User};
use plan_ai_api_mcp::ApiError;
use plan_ai_connector::net::Guard;
use plan_ai_connector::{Connector, TargetAuth};
use rmcp::model::*;
use rmcp::service::RequestContext;
use rmcp::{RoleServer, ServerHandler};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::*;

// ── Postgres ──────────────────────────────────────────────────────────

fn server() -> &'static str {
    static URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    URL.get_or_init(|| {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/tmp/chat-connectors-pg");
        let run = |cmd: &mut std::process::Command| cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().expect("initdb/pg_ctl on PATH (nix develop)").success();
        let port_file = dir.join("port");
        if !dir.join("PG_VERSION").exists() {
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
            assert!(run(std::process::Command::new("initdb").args(["-U", "postgres", "--auth=trust", "-D"]).arg(&dir)));
            let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
            std::fs::write(&port_file, port.to_string()).unwrap();
        }
        let port = std::fs::read_to_string(&port_file).unwrap();
        if !run(std::process::Command::new("pg_ctl").arg("status").arg("-D").arg(&dir)) {
            assert!(run(std::process::Command::new("pg_ctl").arg("-D").arg(&dir).arg("-l").arg(dir.join("log")).args(["-w", "-o"]).arg(format!("-p {port} -h 127.0.0.1 -k '' -c fsync=off -c max_connections=300")).arg("start")));
        }
        format!("postgres://postgres@127.0.0.1:{port}")
    })
}

const KEY: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

fn config(extra: &str) -> &'static Config {
    let text = format!(
        r#"
        [database]
        url = "postgres://unused"
        [subnet]
        url = "http://hub"
        token = "t"
        callback_secret = "callback-secret-0123456789abcdef0123"
        [approval]
        [secrets]
        connector_encryption_key = "{KEY}"
        {extra}
        "#
    );
    let cfg: Config = toml::from_str(&text).unwrap();
    cfg.check().unwrap();
    Box::leak(Box::new(cfg))
}

struct Env {
    pool: PgPool,
    accounts: Arc<Accounts>,
    c: Arc<Connectors>,
    cfg: &'static Config,
}

async fn env(guard: Guard, extra: &str) -> Env {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let name = format!("t_{}", Uuid::new_v4().simple());
    let admin = PgPool::connect(&format!("{}/postgres", server())).await.unwrap();
    sqlx::query(&format!("CREATE DATABASE {name}")).execute(&admin).await.unwrap();
    let url = format!("{}/{name}", server());
    let accounts = Accounts::connect(&url, plan_ai_accounts::Config { admin_emails: vec![], default_plan: "standard".into() }, Arc::new(plan_ai_accounts::NoHooks)).await.unwrap();
    accounts.ensure_plans(&crate::config::Accounts::default().plans).await.unwrap();
    let pool = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let cfg = config(extra);
    let c = Arc::new(Connectors::new(pool.clone(), cfg, accounts.clone(), guard, "https://chat.test".into()).unwrap());
    Env { pool, accounts, c, cfg }
}

impl Env {
    async fn user(&self, email: &str) -> User {
        let u = self.accounts.upsert_user(email, None).await.unwrap();
        self.accounts.personal_team(&u).await.unwrap();
        u
    }

    /// `user` joins `team` with `role`, by invitation (as in the product).
    async fn join(&self, team: &plan_ai_accounts::Team, user: &User, role: Role) {
        let inv = self.accounts.invite(team.id, &user.email, role, &[], team.owner_id).await.unwrap();
        self.accounts.answer(user, inv.id, true).await.unwrap();
    }

    fn connector(&self) -> Connector {
        crate::connector::build(self.cfg, self.pool.clone(), Some(self.c.clone())).unwrap().0.unwrap()
    }
}

const LOOSE: Guard = Guard { require_https: false, allow_private: true };

fn bearer(team: Option<Uuid>, name: &str, url: &str, token: &str) -> CreateInput {
    CreateInput { team_id: team, name: name.into(), description: String::new(), url: url.into(), auth: AuthInput::Bearer { token: token.into() } }
}

fn status_of(e: &ApiError) -> u16 {
    e.status().as_u16()
}

// ── teams and permissions ─────────────────────────────────────────────

#[tokio::test]
async fn team_connectors_are_used_by_members_and_managed_by_admins() {
    let e = env(LOOSE, "").await;
    let (ada, bob, eve) = (e.user("ada@example.com").await, e.user("bob@example.com").await, e.user("eve@example.com").await);
    let acme = e.accounts.create_team(&ada, "ACME").await.unwrap();
    e.join(&acme, &bob, Role::Read).await;
    let none = HashSet::new();

    // Personal: in ada's personal team, hers alone.
    let mine = e.c.create(ada.id, bearer(None, "docs", "http://127.0.0.1:9/mcp", "personal-token-0001"), &none).await.unwrap();
    assert_eq!((mine.service.as_str(), mine.can_manage), ("docs", true));
    // A team's: every member sees it, by the team's name.
    let crm = e.c.create(ada.id, bearer(Some(acme.id), "crm", "http://127.0.0.1:9/mcp", "team-token-abcd1234"), &none).await.unwrap();
    assert_eq!(crm.service, "acme/crm");
    assert_eq!(crm.token.as_deref(), Some("…1234"), "only the last four characters");

    let bobs = e.c.list(bob.id, &none).await.unwrap();
    let seen: Vec<&str> = bobs.connectors.iter().map(|c| c.service.as_str()).collect();
    assert_eq!(seen, ["acme/crm"]);
    assert!(!bobs.connectors[0].can_manage);
    assert!(!serde_json::to_string(&bobs).unwrap().contains("team-token"), "no secrets through the API");
    assert!(bobs.teams.iter().any(|t| t.name == "ACME" && t.role == "read" && !t.can_manage));
    assert!(e.c.list(eve.id, &none).await.unwrap().connectors.is_empty());

    // Members use, admins manage, outsiders don't even see.
    let id: Uuid = crm.id.parse().unwrap();
    let change = |name: &str| UpdateInput { id, name: Some(name.into()), description: None, url: None, token: None, mode: None };
    assert_eq!(status_of(&e.c.update(bob.id, change("crm2"), &none).await.err().unwrap()), 403);
    assert_eq!(status_of(&e.c.delete(bob.id, &crm.id).await.unwrap_err()), 403);
    assert_eq!(status_of(&e.c.create(bob.id, bearer(Some(acme.id), "x", "http://127.0.0.1:9/mcp", "tok"), &none).await.err().unwrap()), 403);
    assert_eq!(status_of(&e.c.create(eve.id, bearer(Some(acme.id), "x", "http://127.0.0.1:9/mcp", "tok"), &none).await.err().unwrap()), 404);
    assert_eq!(status_of(&e.c.update(eve.id, change("x"), &none).await.err().unwrap()), 404);
    assert_eq!(status_of(&e.c.create(ada.id, bearer(Some(acme.id), "crm", "http://127.0.0.1:9/mcp", "tok"), &none).await.err().unwrap()), 409);
    // An admin promoted later may manage.
    e.accounts.set_member(acme.id, bob.id, Role::Admin, &[]).await.unwrap();
    let renamed = e.c.update(bob.id, change("sales"), &none).await.unwrap();
    assert_eq!(renamed.service, "acme/sales");

    // Encrypted at rest; the connector gets the token and the public-only rule.
    let stored: Vec<u8> = sqlx::query_scalar("SELECT bearer_token FROM connectors WHERE id = $1").bind(id).fetch_one(&e.pool).await.unwrap();
    assert!(!stored.windows(10).any(|w| w == b"team-token"));
    let targets = e.c.targets(bob.id, &none).await.unwrap();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].auth, TargetAuth::Bearer { token: "team-token-abcd1234".into() });
    assert!(targets[0].public_only);

    // A configured app's name wins over a personal connector.
    let taken: HashSet<String> = ["docs".to_string()].into();
    assert_eq!(e.c.targets(ada.id, &taken).await.unwrap().iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["me/docs", "acme/sales"]);

    e.c.delete(ada.id, &crm.id).await.unwrap();
    assert!(e.c.list(bob.id, &none).await.unwrap().connectors.is_empty());
}

#[tokio::test]
async fn pending_accounts_have_no_connectors() {
    let e = env(LOOSE, "").await;
    e.accounts.require_approval();
    let ada = e.user("ada@example.com").await;
    let err = e.c.create(ada.id, bearer(None, "docs", "http://127.0.0.1:9/mcp", "tok"), &HashSet::new()).await.err().unwrap();
    assert_eq!(status_of(&err), 403);
    assert!(e.c.list(ada.id, &HashSet::new()).await.unwrap().connectors.is_empty());
}

#[tokio::test]
async fn user_servers_must_be_public_https() {
    let e = env(Guard::PUBLIC, "").await;
    let ada = e.user("ada@example.com").await;
    for url in ["http://example.com/mcp", "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://localhost/mcp", "https://10.0.0.8/mcp", "https://169.254.169.254/", "file:///etc/passwd"] {
        let err = e.c.create(ada.id, bearer(None, "x", url, "tok"), &HashSet::new()).await.err().unwrap();
        assert_eq!(status_of(&err), 400, "{url}: {err}");
    }
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM connectors").fetch_one(&e.pool).await.unwrap();
    assert_eq!(n, 0);
}

// ── OAuth: mock authorization server + MCP server ─────────────────────

#[derive(Clone, Default)]
struct Mock {
    base: Arc<Mutex<String>>,
    dcr: Arc<std::sync::atomic::AtomicBool>,
    registrations: Arc<Mutex<u32>>,
    codes: Arc<Mutex<HashMap<String, (String, String)>>>,
    issued: Arc<Mutex<u32>>,
    /// Access tokens the MCP server accepts.
    valid: Arc<Mutex<HashSet<String>>>,
    refresh: Arc<Mutex<HashSet<String>>>,
    grants: Arc<Mutex<Vec<String>>>,
}

#[derive(Clone)]
struct Whoami;

impl ServerHandler for Whoami {
    fn get_info(&self) -> ServerInfo {
        ServerInfo { capabilities: ServerCapabilities::builder().enable_tools().build(), ..Default::default() }
    }
    async fn list_tools(&self, _: Option<PaginatedRequestParams>, _: RequestContext<RoleServer>) -> Result<ListToolsResult, ErrorData> {
        let tool = Tool {
            name: "whoami".into(),
            title: None,
            description: None,
            input_schema: Arc::new(json!({ "type": "object" }).as_object().unwrap().clone()),
            output_schema: None,
            annotations: Some(ToolAnnotations::new().read_only(true)),
            execution: None,
            icons: None,
            meta: None,
        };
        Ok(ListToolsResult { tools: vec![tool], next_cursor: None, meta: None })
    }
    async fn call_tool(&self, _: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResult, ErrorData> {
        let auth = context.extensions.get::<axum::http::request::Parts>().and_then(|p| p.headers.get("authorization")).and_then(|h| h.to_str().ok()).unwrap_or_default().to_owned();
        Ok(CallToolResult::success(vec![Content::text(auth)]))
    }
}

async fn mcp_guard(State(m): State<Mock>, req: Request, next: Next) -> Response {
    let token = req.headers().get("authorization").and_then(|h| h.to_str().ok()).and_then(|h| h.strip_prefix("Bearer ")).map(str::to_owned);
    if !token.is_some_and(|t| m.valid.lock().unwrap().contains(&t)) {
        let base = m.base.lock().unwrap().clone();
        return (StatusCode::UNAUTHORIZED, [("www-authenticate", format!(r#"Bearer resource_metadata="{base}/.well-known/oauth-protected-resource/mcp""#))]).into_response();
    }
    next.run(req).await
}

async fn mock(dcr: bool) -> (String, Mock) {
    let m = Mock::default();
    m.dcr.store(dcr, std::sync::atomic::Ordering::Relaxed);
    let mcp = rmcp::transport::streamable_http_server::StreamableHttpService::new(
        || Ok(Whoami),
        Arc::new(rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default()),
        Default::default(),
    );
    let mcp = Router::new().route_service("/mcp", mcp).layer(axum::middleware::from_fn_with_state(m.clone(), mcp_guard));
    let app = Router::new()
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            get(|State(m): State<Mock>| async move {
                let b = m.base.lock().unwrap().clone();
                Json(json!({ "resource": format!("{b}/mcp"), "authorization_servers": [b] }))
            }),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(|State(m): State<Mock>| async move {
                let b = m.base.lock().unwrap().clone();
                let mut meta = json!({ "issuer": b, "authorization_endpoint": format!("{b}/authorize"), "token_endpoint": format!("{b}/token"), "code_challenge_methods_supported": ["S256"] });
                if m.dcr.load(std::sync::atomic::Ordering::Relaxed) {
                    meta["registration_endpoint"] = json!(format!("{b}/register"));
                }
                Json(meta)
            }),
        )
        .route(
            "/register",
            post(|State(m): State<Mock>, Json(_b): Json<Value>| async move {
                *m.registrations.lock().unwrap() += 1;
                (StatusCode::CREATED, Json(json!({ "client_id": "dcr-client", "client_secret": "dcr-secret-value" })))
            }),
        )
        .route(
            "/authorize",
            get(|State(m): State<Mock>, Query(q): Query<HashMap<String, String>>| async move {
                let code = Uuid::new_v4().to_string();
                m.codes.lock().unwrap().insert(code.clone(), (q["code_challenge"].clone(), q["resource"].clone()));
                (StatusCode::FOUND, [("location", format!("{}?code={code}&state={}", q["redirect_uri"], q["state"]))])
            }),
        )
        .route(
            "/token",
            post(|State(m): State<Mock>, Form(f): Form<HashMap<String, String>>| async move {
                m.grants.lock().unwrap().push(f["grant_type"].clone());
                let issue = |m: &Mock| {
                    let n = {
                        let mut i = m.issued.lock().unwrap();
                        *i += 1;
                        *i
                    };
                    m.valid.lock().unwrap().insert(format!("at-{n}"));
                    m.refresh.lock().unwrap().insert(format!("rt-{n}"));
                    Json(json!({ "access_token": format!("at-{n}"), "token_type": "Bearer", "expires_in": 3600, "refresh_token": format!("rt-{n}") })).into_response()
                };
                let refused = || (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_grant" }))).into_response();
                match f["grant_type"].as_str() {
                    "authorization_code" => {
                        let Some((challenge, resource)) = m.codes.lock().unwrap().remove(&f["code"]) else { return refused() };
                        let derived = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(f["code_verifier"].as_bytes()));
                        if derived != challenge || resource != f["resource"] {
                            return refused();
                        }
                        issue(&m)
                    }
                    "refresh_token" if m.refresh.lock().unwrap().remove(&f["refresh_token"]) => issue(&m),
                    _ => refused(),
                }
            }),
        )
        .merge(mcp)
        .with_state(m.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", l.local_addr().unwrap());
    *m.base.lock().unwrap() = base.clone();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (base, m)
}

/// The browser's trip to the authorization server: the callback's state and code.
async fn authorize(url: &str) -> (String, String) {
    let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let res = http.get(url).send().await.unwrap();
    let back = url::Url::parse(res.headers()["location"].to_str().unwrap()).unwrap();
    assert!(back.as_str().starts_with("https://chat.test/connectors/oauth/callback?"), "{back}");
    let q: HashMap<String, String> = back.query_pairs().into_owned().collect();
    (q["state"].clone(), q["code"].clone())
}

fn oauth(team: Option<Uuid>, name: &str, url: &str, mode: OauthMode) -> CreateInput {
    CreateInput { team_id: team, name: name.into(), description: "CRM".into(), url: url.into(), auth: AuthInput::Oauth { mode } }
}

fn text(r: &CallToolResult) -> String {
    r.content.iter().filter_map(|c| c.as_text().map(|t| t.text.clone())).collect()
}

fn kind(r: &CallToolResult) -> String {
    r.structured_content.as_ref().and_then(|s| s["error"]["kind"].as_str()).unwrap_or("ok").to_owned()
}

#[tokio::test]
async fn per_member_oauth_connect_refresh_and_reconnect() {
    let (base, m) = mock(true).await;
    let e = env(LOOSE, "").await;
    let (ada, bob) = (e.user("ada@example.com").await, e.user("bob@example.com").await);
    let acme = e.accounts.create_team(&ada, "ACME").await.unwrap();
    e.join(&acme, &bob, Role::Read).await;
    let none = HashSet::new();
    let mcp = format!("{base}/mcp");

    // Discovery and registration happen on save; the client secret is sealed.
    let crm = e.c.create(ada.id, oauth(Some(acme.id), "crm", &mcp, OauthMode::PerMember), &none).await.unwrap();
    assert_eq!(*m.registrations.lock().unwrap(), 1);
    let secret: Vec<u8> = sqlx::query_scalar("SELECT client_secret FROM connector_oauth_clients").fetch_one(&e.pool).await.unwrap();
    assert!(!secret.windows(10).any(|w| w == b"dcr-secret"));
    let bob_view = |l: ConnectorList| l.connectors.into_iter().find(|c| c.id == crm.id).unwrap();
    let v = bob_view(e.c.list(bob.id, &none).await.unwrap());
    assert_eq!((v.status.as_str(), v.can_connect), ("connect_first", true));

    // Before connecting: the agent is told to connect first, with the link.
    let conn = e.connector();
    let tenant = bob.id.to_string();
    let r = conn.call(&tenant, "acme/crm", "whoami", None).await;
    assert_eq!(kind(&r), "not_connected");
    assert!(text(&r).contains("https://chat.test/connectors/oauth/start?connector="), "{}", text(&r));
    let listed = conn.service_entries(&tenant).await.unwrap();
    assert_eq!(listed.iter().find(|s| s["name"] == "acme/crm").unwrap()["status"], "connect_first");

    // The state is bound to the user and the browser, and works once.
    let key = Key::parse(&crm.id).unwrap();
    let (to, nonce) = e.c.start(bob.id, &key).await.unwrap();
    let (state, code) = authorize(&to).await;
    assert_eq!(status_of(&e.c.callback(ada.id, &state, &code, Some(&nonce)).await.unwrap_err()), 403, "another user");
    let (to, nonce) = e.c.start(bob.id, &key).await.unwrap();
    let (state, code) = authorize(&to).await;
    assert_eq!(status_of(&e.c.callback(bob.id, &state, &code, Some("another-browser")).await.unwrap_err()), 403, "another browser");
    let (to, nonce2) = e.c.start(bob.id, &key).await.unwrap();
    let _ = nonce;
    let (state, code) = authorize(&to).await;
    assert_eq!(e.c.callback(bob.id, &state, &code, Some(&nonce2)).await.unwrap(), "crm");
    assert_eq!(status_of(&e.c.callback(bob.id, &state, &code, Some(&nonce2)).await.unwrap_err()), 400, "replayed");

    let r = conn.call(&tenant, "acme/crm", "whoami", None).await;
    assert_eq!(text(&r), "Bearer at-1");
    assert_eq!(bob_view(e.c.list(bob.id, &none).await.unwrap()).status, "connected");
    // Per member: ada hasn't connected hers.
    assert_eq!(kind(&conn.call(&ada.id.to_string(), "acme/crm", "whoami", None).await), "not_connected");
    let at: Vec<u8> = sqlx::query_scalar("SELECT access_token FROM connector_connections").fetch_one(&e.pool).await.unwrap();
    assert!(!at.windows(4).any(|w| w == b"at-1"));

    // Expired: refreshed before use.
    sqlx::query("UPDATE connector_connections SET expires_at = now() - interval '1 minute'").execute(&e.pool).await.unwrap();
    assert_eq!(text(&conn.call(&tenant, "acme/crm", "whoami", None).await), "Bearer at-2");
    assert_eq!(m.grants.lock().unwrap().last().map(String::as_str), Some("refresh_token"));

    // The service stops taking the token (401): needs reconnecting.
    m.valid.lock().unwrap().clear();
    let r = conn.call(&tenant, "acme/crm", "whoami", None).await;
    assert_eq!(kind(&r), "needs_reconnect", "{}", text(&r));
    let v = bob_view(e.c.list(bob.id, &none).await.unwrap());
    assert_eq!(v.status, "needs_reconnect");
    assert!(v.status_detail.unwrap().contains("refused"));
    assert_eq!(kind(&conn.call(&tenant, "acme/crm", "whoami", None).await), "needs_reconnect", "stays so without calling the service");

    // Reconnect; then a refresh the server refuses also needs reconnecting.
    let (to, nonce) = e.c.start(bob.id, &key).await.unwrap();
    let (state, code) = authorize(&to).await;
    e.c.callback(bob.id, &state, &code, Some(&nonce)).await.unwrap();
    assert_eq!(text(&conn.call(&tenant, "acme/crm", "whoami", None).await), "Bearer at-3");
    m.refresh.lock().unwrap().clear();
    sqlx::query("UPDATE connector_connections SET expires_at = now()").execute(&e.pool).await.unwrap();
    let r = conn.call(&tenant, "acme/crm", "whoami", None).await;
    assert_eq!(kind(&r), "needs_reconnect");
    assert!(text(&r).contains("refreshing the token failed"), "{}", text(&r));

    // Disconnecting removes only bob's connection.
    e.c.disconnect(bob.id, &crm.id).await.unwrap();
    assert_eq!(bob_view(e.c.list(bob.id, &none).await.unwrap()).status, "connect_first");
}

#[tokio::test]
async fn a_shared_oauth_connection_is_made_by_an_admin_and_used_by_all() {
    let (base, _m) = mock(true).await;
    let e = env(LOOSE, "").await;
    let (ada, bob) = (e.user("ada@example.com").await, e.user("bob@example.com").await);
    let acme = e.accounts.create_team(&ada, "ACME").await.unwrap();
    e.join(&acme, &bob, Role::Write).await;
    let crm = e.c.create(ada.id, oauth(Some(acme.id), "crm", &format!("{base}/mcp"), OauthMode::Shared), &HashSet::new()).await.unwrap();
    let key = Key::parse(&crm.id).unwrap();
    assert_eq!(status_of(&e.c.start(bob.id, &key).await.unwrap_err()), 403, "members don't connect shared ones");
    assert_eq!(status_of(&e.c.connect(bob.id, &crm.id).await.unwrap_err()), 403);
    let conn = e.connector();
    let r = conn.call(&bob.id.to_string(), "acme/crm", "whoami", None).await;
    assert!(text(&r).contains("A team admin has to connect it"), "{}", text(&r));

    assert!(e.c.connect(ada.id, &crm.id).await.unwrap().url.starts_with("https://chat.test/connectors/oauth/start"));
    let (to, nonce) = e.c.start(ada.id, &key).await.unwrap();
    let (state, code) = authorize(&to).await;
    e.c.callback(ada.id, &state, &code, Some(&nonce)).await.unwrap();
    assert_eq!(text(&conn.call(&bob.id.to_string(), "acme/crm", "whoami", None).await), "Bearer at-1");
    assert_eq!(status_of(&e.c.disconnect(bob.id, &crm.id).await.unwrap_err()), 403);
}

#[tokio::test]
async fn an_oauth_server_without_registration_is_refused_on_save() {
    let (base, _m) = mock(false).await;
    let e = env(LOOSE, "").await;
    let ada = e.user("ada@example.com").await;
    let err = e.c.create(ada.id, oauth(None, "crm", &format!("{base}/mcp"), OauthMode::PerMember), &HashSet::new()).await.err().unwrap();
    assert_eq!(status_of(&err), 400);
    assert!(err.to_string().contains("dynamic client registration"), "{err}");
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM connectors").fetch_one(&e.pool).await.unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_configured_oauth_app_is_connected_per_user() {
    let (base, _m) = mock(true).await;
    let extra = format!(
        r#"
        [[apps]]
        name = "notes"
        description = "Notes"
        kind = "notes"
        mcp = {{ url = "{base}/mcp", auth = "oauth" }}
        emails = ["*@plan.ai"]
        "#
    );
    let e = env(Guard::PUBLIC, &extra).await;
    let (ada, eve) = (e.user("ada@plan.ai").await, e.user("eve@example.com").await);
    let none = HashSet::new();
    let listed = e.c.list(ada.id, &none).await.unwrap();
    let app = listed.connectors.iter().find(|c| c.id == "app:notes").unwrap();
    assert_eq!((app.source.as_str(), app.status.as_str()), ("config", "connect_first"));
    assert!(e.c.list(eve.id, &none).await.unwrap().connectors.is_empty(), "gated by emails");
    assert_eq!(status_of(&e.c.connect(eve.id, "app:notes").await.unwrap_err()), 404);

    // Registered on first use; the operator's server may be on loopback.
    let key = Key::App("notes".into());
    let (to, nonce) = e.c.start(ada.id, &key).await.unwrap();
    let (state, code) = authorize(&to).await;
    e.c.callback(ada.id, &state, &code, Some(&nonce)).await.unwrap();
    let conn = e.connector();
    assert_eq!(text(&conn.call(&ada.id.to_string(), "notes", "whoami", None).await), "Bearer at-1");
    assert_eq!(kind(&conn.call(&eve.id.to_string(), "notes", "whoami", None).await), "unknown_service");
}
