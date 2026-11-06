//! Rate limits on what can be abused from outside: OAuth client registration
//! and tokens, sign-in, messages, pages' actions, the public MCP endpoint.
//! Keyed by the client's address (`X-Real-IP` from nginx in front: the
//! server listens on localhost only), fixed windows, in memory.
// ponytail: one process, fixed windows; a shared store if the chat ever runs twice.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::http::{Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// (route class, client) → (window start, requests in it).
static WINDOWS: LazyLock<Mutex<HashMap<(&'static str, String), (Instant, u32)>>> = LazyLock::new(Default::default);

/// A request's class and its limit (requests per window), if it has one.
pub fn class_of(method: &Method, path: &str) -> Option<(&'static str, u32, Duration)> {
    let min = Duration::from_secs(60);
    let hour = Duration::from_secs(3600);
    Some(match (method, path) {
        (&Method::POST, "/oauth/register") => ("oauth-register", 20, hour),
        (&Method::POST, "/oauth/token") => ("oauth-token", 60, min),
        (_, "/oauth/authorize") => ("oauth-authorize", 60, min),
        (_, "/auth/login") | (_, "/auth/zitadel/callback") => ("sign-in", 60, min),
        (&Method::POST, "/api/v1/chat/send") => ("chat-send", 30, min),
        (&Method::POST, p) if p.starts_with("/api/v1/pages/") => ("pages", 240, min),
        (_, p) if p.starts_with("/public/mcp") => ("public-mcp", 600, min),
        (&Method::POST, p) if p.starts_with("/api/") => ("api-write", 600, min),
        _ => return None,
    })
}

/// Counts a request; `Err(seconds)` until its window ends when it's over.
pub fn take(class: &'static str, key: &str, limit: u32, window: Duration, now: Instant) -> Result<(), u64> {
    let mut w = WINDOWS.lock().expect("rate windows");
    if w.len() > 100_000 {
        w.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(3600));
    }
    let entry = w.entry((class, key.to_string())).or_insert((now, 0));
    if now.duration_since(entry.0) >= window {
        *entry = (now, 0);
    }
    if entry.1 >= limit {
        return Err((window - now.duration_since(entry.0)).as_secs().max(1));
    }
    entry.1 += 1;
    Ok(())
}

pub async fn limit(req: Request, next: Next) -> Response {
    let Some((class, limit, window)) = class_of(req.method(), req.uri().path()) else { return next.run(req).await };
    let client = req.headers().get("x-real-ip").and_then(|v| v.to_str().ok()).unwrap_or("local").to_string();
    match take(class, &client, limit, window, Instant::now()) {
        Ok(()) => next.run(req).await,
        Err(retry) => {
            tracing::warn!(class, client, "rate limited");
            (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, retry.to_string())], axum::Json(json!({ "error": "rate_limited", "message": format!("Too many requests; try again in {retry} s.") })))
                .into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_count_per_class_and_client() {
        let t0 = Instant::now();
        let w = Duration::from_secs(60);
        for _ in 0..3 {
            assert!(take("t-class", "1.2.3.4", 3, w, t0).is_ok());
        }
        assert!(take("t-class", "1.2.3.4", 3, w, t0).is_err(), "over the limit");
        assert!(take("t-class", "5.6.7.8", 3, w, t0).is_ok(), "another client");
        assert!(take("t-other", "1.2.3.4", 3, w, t0).is_ok(), "another class");
        assert!(take("t-class", "1.2.3.4", 3, w, t0 + w).is_ok(), "a new window");
    }

    #[test]
    fn classes() {
        assert_eq!(class_of(&Method::POST, "/oauth/register").map(|c| c.0), Some("oauth-register"));
        assert_eq!(class_of(&Method::POST, "/api/v1/pages/x/call").map(|c| c.0), Some("pages"));
        assert_eq!(class_of(&Method::GET, "/api/v1/chat").map(|c| c.0), None, "reads aren't limited");
        assert_eq!(class_of(&Method::POST, "/hooks/pre_tool"), None, "the hub's callbacks aren't");
    }
}
