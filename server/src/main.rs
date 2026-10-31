mod agent_tools;
mod api;
mod chat;
mod hook;
mod config;
mod state;
mod subnet;

use std::convert::Infallible;
use std::sync::Arc;

use axum::Router;
use axum::extract::{Query, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{Next, from_fn};
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
    let app = state::init(cfg).await?;

    let auth_layers = if dev_no_auth() {
        tracing::warn!("DEV_ONLY_NO_AUTH=1: no sign-in, every request is dev@localhost (admin)");
        vec![]
    } else {
        let auth = cfg.auth.as_ref().ok_or_else(|| anyhow::anyhow!("no [auth] in the config: configure OIDC, or run a debug build with DEV_ONLY_NO_AUTH=1"))?;
        plan_ai_auth::build_auth_layers(auth, &cfg.database.url).await.0
    };

    let registry = api::registry(Arc::new(plan_ai_accounts::TokenAuth(app.accounts.clone())));
    let api = Router::new()
        .route("/api/v1/chat/events", get(chat_events).with_state(app.clone()))
        .merge(registry.http_router(app.clone()))
        .layer(from_fn(session_principal))
        .layer(from_fn(auth_unless_bearer));

    let dist = &cfg.web.static_dir;
    let spa = ServeDir::new(dist).fallback(ServeFile::new(dist.join("index.html")));
    let mut web = Router::new().merge(api).fallback_service(spa);
    if !auth_layers.is_empty() {
        web = web.route("/auth/login", get(plan_ai_auth::login_page)).route("/auth/logout", get(plan_ai_auth::logout_handler));
    }
    for layer in auth_layers {
        web = web.layer(layer);
    }

    // Subnet calls back with the callback secret: the approval hook and the
    // agents' own tools.
    let agent_mcp = agent_tools::registry(&cfg.subnet.callback_secret).mcp_service(app.clone());
    let callbacks = Router::new().route("/hooks/pre_tool", post(hook::pre_tool)).with_state(app.clone()).route_service("/agent/mcp", agent_mcp);

    let mcp = registry.mcp_service(app.clone());
    let router = Router::new()
        .route_service("/mcp", mcp.clone())
        .route_service("/mcp/", mcp)
        .merge(callbacks)
        .merge(web)
        .layer(mac_mgmt_common::otel::http::trace_layer())
        .layer(from_fn(mac_mgmt_common::otel::http::record_request_metrics));

    let listener = tokio::net::TcpListener::bind(&cfg.web.listen).await?;
    tracing::info!("listening on {}", cfg.web.listen);
    axum::serve(listener, router).with_graceful_shutdown(shutdown()).await?;
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

/// API clients with a Bearer token authenticate in the handler; everyone
/// else needs a session.
async fn auth_unless_bearer(req: Request, next: Next) -> Response {
    if req.headers().contains_key(header::AUTHORIZATION) {
        return next.run(req).await;
    }
    plan_ai_auth::require_auth(req, next).await
}

/// A signed-in browser is an API caller too. Impersonation is recorded so
/// handlers keep the admin from changing the user's settings.
async fn session_principal(mut req: Request, next: Next) -> Response {
    if let Some(user) = req.extensions().get::<WebUser>() {
        let mut p = plan_ai_accounts::principal_for(user);
        p.scopes["impersonating_from"] = json!(user.impersonating_from);
        req.extensions_mut().insert(SessionPrincipal(Arc::new(p)));
    }
    next.run(req).await
}

#[derive(serde::Deserialize)]
struct EventsQuery {
    mode: String,
}

/// The live conversation in one mode, for the signed-in user (every tab).
async fn chat_events(State(app): State<AppState>, Query(q): Query<EventsQuery>, req: Request) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Response> {
    let user = req.extensions().get::<WebUser>().map(|u| u.id).ok_or_else(|| StatusCode::UNAUTHORIZED.into_response())?;
    chat::agent_type(&app, &q.mode).map_err(|e| (e.status(), e.to_string()).into_response())?;
    let mode = q.mode;
    let stream = BroadcastStream::new(app.events.subscribe()).filter_map(move |ev| match ev {
        Ok(ev) if ev.user == user && ev.mode == mode => Some(Ok(Event::default().event(ev.name).json_data(&ev.data).expect("json"))),
        Ok(_) => None,
        // Fell behind: the client refetches history.
        Err(_) => Some(Ok(Event::default().event("resync").data("{}"))),
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
