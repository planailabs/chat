//! Restarts without cutting chats off: before the chat or the hub stops, the
//! conversations' running agents get a quick pause (their in-flight model
//! call or tool calls finish, nothing new starts) and are recorded; once the
//! chat follows the hub again it resumes them. An agent a restart caught
//! anyway (the hub crashed) recovers by itself in the hub.

use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::state::App;

/// Phases in which an agent is doing something a stop would cut.
fn working(a: &Value) -> bool {
    matches!(a["phase"].as_str(), Some("thinking" | "tools" | "hooking" | "compacting")) && a["paused"] != true
}

/// Quick-pauses the conversations' working agents (with their workers) and
/// waits up to `wait` for them to reach a step boundary. Returns how many.
pub async fn pause_running(app: &App, wait: Duration) -> anyhow::Result<usize> {
    let agents = app.hub.call("list_agents", json!({})).await?;
    let ours: Vec<String> = sqlx::query_scalar("SELECT agent_id FROM conversations").fetch_all(&app.pool).await?;
    let mut paused = vec![];
    for a in agents.as_array().into_iter().flatten() {
        let Some(id) = a["id"].as_str() else { continue };
        if a["parent"].is_null() && ours.iter().any(|o| o == id) && working(a) {
            match app.hub.call("pause", json!({ "id": id, "mode": "quick", "tree": true })).await {
                Ok(_) => {
                    sqlx::query("INSERT INTO paused_for_restart (agent_id) VALUES ($1) ON CONFLICT DO NOTHING").bind(id).execute(&app.pool).await?;
                    paused.push(id.to_string());
                }
                Err(e) => tracing::warn!(agent = id, "pausing before a restart: {e:#}"),
            }
        }
    }
    let started = Instant::now();
    while !paused.is_empty() && started.elapsed() < wait {
        let agents = app.hub.call("list_agents", json!({})).await?;
        let still = agents.as_array().into_iter().flatten().filter(|a| a["id"].as_str().is_some_and(|id| paused.iter().any(|p| p == id)) && a["paused"] != true).count();
        if still == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    tracing::info!(count = paused.len(), waited_ms = started.elapsed().as_millis() as u64, "paused running conversations for a restart");
    Ok(paused.len())
}

/// Resumes what `pause_running` paused (with their workers).
pub async fn resume_paused(hub: &crate::subnet::Hub, pool: &sqlx::PgPool) -> anyhow::Result<usize> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT agent_id FROM paused_for_restart").fetch_all(pool).await?;
    let mut resumed = 0;
    for id in ids {
        match hub.call("resume", json!({ "id": id, "tree": true })).await {
            Ok(_) => resumed += 1,
            // Gone, cancelled or upgraded meanwhile: nothing left to resume.
            Err(e) => tracing::info!(agent = id, "resuming after a restart: {e:#}"),
        }
        sqlx::query("DELETE FROM paused_for_restart WHERE agent_id = $1").bind(&id).execute(pool).await?;
    }
    if resumed > 0 {
        tracing::info!(count = resumed, "resumed conversations paused for a restart");
    }
    Ok(resumed)
}

/// `POST /hooks/pause_for_restart` (callback secret): the hub's ExecStop asks
/// before it stops.
pub async fn pause_route(axum::extract::State(app): axum::extract::State<crate::state::AppState>, headers: axum::http::HeaderMap) -> axum::http::StatusCode {
    if !crate::hook::secret_ok(&headers, &app.cfg.subnet.callback_secret) {
        return axum::http::StatusCode::UNAUTHORIZED;
    }
    match pause_running(&app, Duration::from_secs(45)).await {
        Ok(_) => axum::http::StatusCode::NO_CONTENT,
        Err(e) => {
            tracing::error!("pausing before the hub's restart: {e:#}");
            axum::http::StatusCode::BAD_GATEWAY
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn what_counts_as_working() {
        use serde_json::json;
        assert!(super::working(&json!({ "phase": "thinking" })));
        assert!(super::working(&json!({ "phase": "tools", "paused": false })));
        assert!(!super::working(&json!({ "phase": "tools", "paused": true })));
        assert!(!super::working(&json!({ "phase": "idle" })));
        assert!(!super::working(&json!({ "phase": "failed" })));
    }
}
