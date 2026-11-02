mod agent_tools;
mod api;
mod chat;
mod hook;
mod config;
mod connector;
mod public_mcp;
mod purchase;
mod state;
mod subnet;

use std::convert::Infallible;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{Next, from_fn, from_fn_with_state};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use futures::Stream;
use plan_ai_api_mcp::SessionPrincipal;
use plan_ai_auth::WebUser;
use serde_json::json;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

/// `DEV_ONLY_NO_AUTH=1` in a debug build: everyone is dev@localhost (admin).
fn dev_no_auth() -> bool {
    cfg!(debug_assertions) && std::env::var("DEV_ONLY_NO_AUTH").as_deref() == Ok("1")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider().install_default().expect("install rustls crypto provider");
    mac_mgmt_common::otel::init("plan-ai-chat", "info");
    let cfg = config::load();
    let (app, connector) = state::init(cfg).await?;
    {
        let app = app.clone();
        tokio::spawn(async move {
            if let Err(e) = chat::upgrade_outdated(&app).await {
                tracing::error!("upgrading outdated conversation agents: {e:#}");
            }
        });
    }

    let auth_layers = if dev_no_auth() {
        tracing::warn!("DEV_ONLY_NO_AUTH=1: no sign-in, every request is dev@localhost (admin)");
        vec![]
    } else {
        let auth = cfg.auth.as_ref().ok_or_else(|| anyhow::anyhow!("no [auth] in the config: configure OIDC, or run a debug build with DEV_ONLY_NO_AUTH=1"))?;
        plan_ai_auth::build_auth_layers(auth, &cfg.database.url).await.0
    };

    let registry = Arc::new(api::registry(Arc::new(plan_ai_accounts::TokenAuth(app.accounts.clone()))));
    let api = Router::new()
        .route("/api/v1/chat/events", get(chat_events).with_state(app.clone()))
        .merge(registry.http_router(app.clone()))
        .layer(from_fn_with_state(app.clone(), session_principal))
        .layer(from_fn(auth_unless_bearer));

    let dist = &cfg.web.static_dir;
    let spa = ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html")));
    // The dashboard's tabs are client-side paths under /dashboard/.
    let dashboard = ServeFile::new(dist.join("dashboard").join("index.html"));
    let mut web = Router::new()
        .merge(api)
        .route_service("/dashboard", dashboard.clone())
        .nest_service("/dashboard/", dashboard)
        .fallback_service(spa);
    // OAuth for outside MCP clients (/public/mcp): sign-in and consent ride
    // on the session, so only with real sign-in configured.
    let oauth = match &cfg.auth {
        Some(auth) if !auth_layers.is_empty() => {
            let base = auth.external_url.trim_end_matches('/').to_string();
            let oauth_cfg = plan_ai_oauth::Config::new(&base, vec![format!("{base}/public/mcp")], "plan.ai agent");
            let server = plan_ai_oauth::OAuthServer::connect(&cfg.database.url, oauth_cfg, Arc::new(Approved(app.clone()))).await?;
            web = web.merge(server.consent_routes().layer(from_fn(plan_ai_auth::require_auth)));
            Some((server, format!("{base}/public/mcp")))
        }
        _ => None,
    };
    if !auth_layers.is_empty() {
        web = web.route("/auth/login", get(plan_ai_auth::login_page)).route("/auth/logout", get(plan_ai_auth::logout_handler));
    }
    for layer in auth_layers {
        web = web.layer(layer);
    }

    // Subnet calls back with the callback secret: the approval hook and the
    // agents' own tools.
    let agent_mcp = agent_tools::registry(&cfg.subnet.callback_secret).mcp_service(app.clone());
    let mut callbacks = Router::new().route("/hooks/pre_tool", post(hook::pre_tool)).with_state(app.clone()).route_service("/agent/mcp", agent_mcp);
    if let Some(c) = &connector {
        callbacks = callbacks.route_service("/connector/mcp", c.service());
    }

    let mcp = registry.mcp_service(app.clone());
    let mut router = Router::new()
        .route_service("/mcp", mcp.clone())
        .route_service("/mcp/", mcp)
        .merge(callbacks);
    if let Some((server, resource)) = oauth {
        let (app, registry, connector) = (app.clone(), registry.clone(), connector.clone());
        let public = rmcp::transport::streamable_http_server::StreamableHttpService::new(
            move || Ok(public_mcp::PublicMcp::new(app.clone(), registry.clone(), connector.clone())),
            Arc::new(rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default()),
            Default::default(),
        );
        router = router.merge(server.public_routes()).merge(
            Router::new()
                .route_service("/public/mcp", public)
                .layer(from_fn_with_state((server, resource), plan_ai_oauth::OAuthServer::protect)),
        );
    }
    let router = router
        .merge(web)
        .layer(mac_mgmt_common::otel::http::trace_layer())
        .layer(from_fn(mac_mgmt_common::otel::http::record_request_metrics));

    let listener = tokio::net::TcpListener::bind(&cfg.web.listen).await?;
    tracing::info!("listening on {}", cfg.web.listen);
    // Graceful shutdown waits for every open connection, and a browser's
    // event stream (/api/v1/chat/events) never ends by itself: without a
    // bound, every stop waited out systemd's 90 s and then got killed.
    let (stopping, stop) = tokio::sync::oneshot::channel::<()>();
    let serve = axum::serve(listener, router).with_graceful_shutdown(async move {
        shutdown().await;
        let _ = stopping.send(());
    });
    tokio::select! {
        served = serve => served?,
        _ = async {
            let _ = stop.await;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        } => tracing::info!("connections still open after 5 s; stopping anyway"),
    }
    mac_mgmt_common::otel::shutdown();
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}

/// Who may connect an MCP client: an account an admin has approved.
struct Approved(AppState);

#[async_trait::async_trait]
impl plan_ai_oauth::Admission for Approved {
    async fn admit(&self, user: &WebUser) -> Result<(), String> {
        let p = self.0.accounts.principal(user).await.map_err(|e| e.to_string())?;
        if p.scopes["pending"] == json!(true) {
            return Err("Your account is waiting for an admin to approve it. Once it is approved, you can connect apps.".into());
        }
        Ok(())
    }
}

/// API clients with a Bearer token authenticate in the handler; everyone
/// else needs a session.
async fn auth_unless_bearer(req: Request, next: Next) -> Response {
    if req.headers().contains_key(header::AUTHORIZATION) {
        return next.run(req).await;
    }
    // The SPA's fetches can't follow a sign-in redirect: they get a 401 and
    // send the browser to /auth/login themselves.
    let api = req.uri().path().starts_with("/api/");
    let res = plan_ai_auth::require_auth(req, next).await;
    if api && res.status().is_redirection() {
        return (StatusCode::UNAUTHORIZED, axum::Json(json!({ "error": "unauthorized", "message": "sign in first" }))).into_response();
    }
    res
}

/// A signed-in browser is an API caller too. Impersonation is recorded so
/// handlers keep the admin from changing the user's settings. The user's
/// Zitadel subject is recorded for the connector.
async fn session_principal(State(app): State<AppState>, mut req: Request, next: Next) -> Response {
    if let (Some(user), Some(sub)) = (req.extensions().get::<WebUser>(), req.extensions().get::<plan_ai_auth::OidcSubject>()) {
        let res = sqlx::query(
            "INSERT INTO profiles (user_id, subject) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET subject = EXCLUDED.subject WHERE profiles.subject IS DISTINCT FROM EXCLUDED.subject",
        )
        .bind(user.id)
        .bind(&sub.subject)
        .execute(&app.pool)
        .await;
        if let Err(e) = res {
            tracing::error!("recording the Zitadel subject of {}: {e}", user.email);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    if let Some(user) = req.extensions().get::<WebUser>() {
        let mut p = match app.accounts.principal(user).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("the principal of {}: {e}", user.email);
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };
        p.scopes["impersonating_from"] = json!(user.impersonating_from);
        req.extensions_mut().insert(SessionPrincipal(Arc::new(p)));
    }
    next.run(req).await
}

/// Every conversation of the signed-in user, live (each event names its
/// `conversation`), for all their tabs.
async fn chat_events(State(app): State<AppState>, req: Request) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Response> {
    let user = req.extensions().get::<WebUser>().map(|u| u.id).ok_or_else(|| StatusCode::UNAUTHORIZED.into_response())?;
    let stream = BroadcastStream::new(app.events.subscribe()).filter_map(move |ev| match ev {
        Ok(ev) if ev.user == user => Some(Ok(Event::default().event(ev.name).json_data(&ev.data).expect("json"))),
        Ok(_) => None,
        // Fell behind: the client refetches what it shows.
        Err(_) => Some(Ok(Event::default().event("resync").data("{}"))),
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
