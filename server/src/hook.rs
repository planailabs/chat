//! Layered approval of tool calls, as subnet's `pre_tool` URL hook:
//!
//! 1. **Static**: allow-listed tools pass; duplicates, loops and writes
//!    without a prior read are denied (no model cost).
//! 2. **Validator model** (optional, mutating and destructive calls): a cheap
//!    model judges the call against the agent's reason and recent calls. A
//!    rejection denies; an approval lets a mutating call through.
//! 3. **The user**: destructive calls, and mutating ones the validator didn't
//!    approve, are answered `ask`; subnet logs `approval_requested` and the
//!    browser shows approve/deny (`chat.approve`). "Approve all" on the
//!    conversation skips this layer.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Risk {
    ReadOnly,
    Mutating,
    Destructive,
}

/// plan-ai-api-mcp tools are `<resource>_<action>`.
// ponytail: risk by name; unknown verbs count as mutating (the user decides).
// Upgrade: read the target's readOnlyHint/destructiveHint from list_tools.
pub fn risk_of(tool: &str) -> Risk {
    let action = tool.rsplit(['_', '.']).next().unwrap_or(tool);
    match action {
        "list" | "get" | "search" | "history" | "export" | "schema" | "catalog" => Risk::ReadOnly,
        "delete" | "remove" | "reset" | "destroy" | "purge" => Risk::Destructive,
        _ => Risk::Mutating,
    }
}

fn reads(tool: &str) -> bool {
    risk_of(tool) == Risk::ReadOnly
}

fn glob(pattern: &str, name: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => pattern == name,
    }
}

/// A call as the hook judges it: connector calls are judged as the target tool.
#[derive(Debug, PartialEq)]
pub struct Call {
    pub name: String,
    pub args: Value,
}

pub fn effective(tool: &str, args: &Value) -> Call {
    if tool == "connector.call_tool" {
        let name = format!("{}.{}", args["service"].as_str().unwrap_or("?"), args["tool"].as_str().unwrap_or("?"));
        return Call { name, args: args["arguments"].clone() };
    }
    Call { name: tool.to_string(), args: args.clone() }
}

/// The agent's earlier calls (oldest first), from its transcript.
pub fn past_calls(transcript: &Value, current_call: &str) -> Vec<Call> {
    let mut out = vec![];
    for m in transcript["messages"].as_array().into_iter().flatten() {
        for c in m["tool_calls"].as_array().into_iter().flatten() {
            if c["id"] == current_call {
                continue;
            }
            let f = &c["function"];
            let args = f["arguments"].as_str().and_then(|a| serde_json::from_str(a).ok()).unwrap_or(Value::Null);
            let mut args = args;
            if let Some(o) = args.as_object_mut() {
                o.remove("_reason");
            }
            out.push(effective(f["name"].as_str().unwrap_or_default(), &args));
        }
    }
    out
}

/// Layer 1. `Some(reason)` denies.
pub fn static_check(call: &Call, risk: Risk, history: &[Call]) -> Option<String> {
    let name = &call.name;
    if history.iter().rev().take(3).any(|h| h == call) {
        return Some(format!("An identical call to `{name}` was made just before. Use its result instead of repeating it."));
    }
    if risk == Risk::Destructive && !history.iter().any(|h| reads(&h.name)) {
        return Some(format!("`{name}` changes things irreversibly and nothing was read first. Read the current state first."));
    }
    let repeats = history.iter().rev().take(10).filter(|h| &h.name == name).count();
    if repeats > 3 {
        return Some(format!("`{name}` was called {repeats} times in the last 10 calls. This looks like a loop; try another approach or ask the user."));
    }
    None
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Approved(String),
    Rejected(String),
}

/// Layer 2.
async fn validate(app: &AppState, call: &Call, risk: Risk, reason: &str, history: &[Call]) -> anyhow::Result<Option<Verdict>> {
    let a = &app.cfg.approval;
    let (Some(url), Some(model)) = (&a.validator_url, &a.validator_model) else { return Ok(None) };
    let recent: String = history.iter().rev().take(10).rev().map(|h| format!("- {}({})\n", h.name, truncate(&h.args.to_string(), 200))).collect();
    let prompt = format!(
        "Tool: `{}` ({risk:?})\nArgs: {}\nAgent's reason: \"{reason}\"\nRecent calls:\n{}\nDoes this call make sense given the reason and the history? Record your verdict with `approve` or `reject`.",
        call.name,
        truncate(&call.args.to_string(), 2000),
        if recent.is_empty() { "(none)\n".into() } else { recent },
    );
    let verdict_tool = |name: &str, what: &str| {
        json!({ "type": "function", "function": { "name": name, "description": what,
            "parameters": { "type": "object", "properties": { "reasoning": { "type": "string" } }, "required": ["reasoning"] } } })
    };
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": "You validate tool calls of an assistant that acts for a user on plan.ai services. Approve calls that are reasonable for the stated intent; reject ones that are wrong, redundant or dangerous. Always give brief reasoning." },
            { "role": "user", "content": prompt },
        ],
        "tools": [verdict_tool("approve", "The call is reasonable."), verdict_tool("reject", "The call is wrong, redundant or dangerous.")],
        "tool_choice": "required",
    });
    let mut req = app.http.post(format!("{}/chat/completions", url.trim_end_matches('/'))).json(&body);
    if let Some(key) = &a.validator_api_key {
        req = req.bearer_auth(key);
    }
    let res: Value = req.send().await?.error_for_status()?.json().await?;
    parse_verdict(&res).map(Some)
}

pub fn parse_verdict(res: &Value) -> anyhow::Result<Verdict> {
    let call = &res["choices"][0]["message"]["tool_calls"][0]["function"];
    let reasoning = call["arguments"].as_str().and_then(|a| serde_json::from_str::<Value>(a).ok()).and_then(|a| a["reasoning"].as_str().map(String::from)).unwrap_or_default();
    match call["name"].as_str() {
        Some("approve") => Ok(Verdict::Approved(reasoning)),
        Some("reject") => Ok(Verdict::Rejected(reasoning)),
        _ => anyhow::bail!("validator gave no verdict: {res}"),
    }
}

fn truncate(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Constant-time equality for the callback secret.
pub fn secret_ok(headers: &HeaderMap, secret: &str) -> bool {
    let Ok(got) = plan_ai_api_mcp::bearer_from_header(headers) else { return false };
    got.len() == secret.len() && got.bytes().zip(secret.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

#[derive(Deserialize)]
pub struct HookCall {
    agent: HookAgent,
    input: HookInput,
}
#[derive(Deserialize)]
struct HookAgent {
    id: String,
}
#[derive(Deserialize)]
struct HookInput {
    tool: String,
    #[serde(default)]
    args: Value,
    call_id: String,
    #[serde(default)]
    reason: Option<String>,
}

fn decide(decision: &str, reason: impl Into<String>) -> Json<Value> {
    Json(json!({ "decision": decision, "reason": reason.into() }))
}

pub async fn pre_tool(State(app): State<AppState>, headers: HeaderMap, Json(h): Json<HookCall>) -> Result<Json<Value>, StatusCode> {
    if !secret_ok(&headers, &app.cfg.subnet.callback_secret) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let tool = &h.input.tool;
    if app.cfg.approval.allow.iter().any(|p| glob(p, tool)) {
        return Ok(decide("allow", "allow-listed"));
    }
    // Only our conversations: an unknown agent has no user to answer for it.
    let auto_approve: Option<bool> = sqlx::query_scalar("SELECT auto_approve FROM chat_agents WHERE agent_id = $1")
        .bind(&h.agent.id)
        .fetch_optional(&app.pool)
        .await
        .map_err(|e| {
            tracing::error!("approval hook: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let Some(auto_approve) = auto_approve else { return Ok(decide("deny", "not a chat conversation")) };

    let call = effective(tool, &h.input.args);
    let risk = risk_of(&call.name);
    let transcript = app.hub.transcript(&h.agent.id).await.map_err(|e| {
        tracing::error!("approval hook: transcript of {}: {e:#}", h.agent.id);
        StatusCode::BAD_GATEWAY
    })?;
    let history = past_calls(&transcript, &h.input.call_id);
    if let Some(why) = static_check(&call, risk, &history) {
        return Ok(decide("deny", why));
    }
    if risk == Risk::ReadOnly {
        return Ok(decide("allow", "read-only"));
    }

    let reason = h.input.reason.as_deref().unwrap_or("(none given)");
    let verdict = match validate(&app, &call, risk, reason, &history).await {
        Ok(v) => v,
        Err(e) => {
            // The user still decides; they're told the validator didn't run.
            tracing::warn!("validator failed for {}: {e:#}", call.name);
            return Ok(decide("ask", format!("The safety check couldn't run ({e}); please review this call.")));
        }
    };
    match verdict {
        Some(Verdict::Rejected(why)) => Ok(decide("deny", format!("Rejected by the safety check: {why}"))),
        Some(Verdict::Approved(why)) if risk == Risk::Mutating || auto_approve => Ok(decide("allow", why)),
        None if auto_approve => Ok(decide("allow", "the user approved all calls in this conversation")),
        Some(Verdict::Approved(why)) => Ok(decide("ask", why)),
        None => Ok(decide("ask", "")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, args: Value) -> Call {
        Call { name: name.into(), args }
    }

    #[test]
    fn risk_by_action() {
        assert_eq!(risk_of("mac-mgmt.skill_list"), Risk::ReadOnly);
        assert_eq!(risk_of("mac-mgmt.skill_delete"), Risk::Destructive);
        assert_eq!(risk_of("mac-mgmt.config_update"), Risk::Mutating);
    }

    #[test]
    fn connector_calls_are_judged_as_their_target() {
        let c = effective("connector.call_tool", &json!({ "service": "mac-mgmt", "tool": "skill_delete", "arguments": { "id": 1 } }));
        assert_eq!(c, call("mac-mgmt.skill_delete", json!({ "id": 1 })));
    }

    #[test]
    fn static_layer() {
        let del = call("svc.skill_delete", json!({ "id": 1 }));
        assert!(static_check(&del, Risk::Destructive, &[]).unwrap().contains("nothing was read"));
        let read = call("svc.skill_list", json!({}));
        assert_eq!(static_check(&del, Risk::Destructive, &[read]), None);
        let dup = call("svc.config_update", json!({ "a": 1 }));
        assert!(static_check(&dup, Risk::Mutating, &[call("svc.config_update", json!({ "a": 1 }))]).unwrap().contains("identical"));
        let loopy: Vec<Call> = (0..4).map(|i| call("svc.config_update", json!({ "a": i }))).collect();
        assert!(static_check(&call("svc.config_update", json!({ "a": 9 })), Risk::Mutating, &loopy).unwrap().contains("loop"));
    }

    #[test]
    fn history_from_transcript() {
        let t = json!({ "messages": [
            { "role": "assistant", "tool_calls": [
                { "id": "a", "function": { "name": "connector.call_tool", "arguments": "{\"service\":\"s\",\"tool\":\"x_list\",\"arguments\":{},\"_reason\":\"r\"}" } },
                { "id": "now", "function": { "name": "chat.product_get", "arguments": "{}" } },
            ] },
        ] });
        assert_eq!(past_calls(&t, "now"), vec![call("s.x_list", json!({}))]);
    }

    #[test]
    fn verdicts() {
        let res = |name: &str| json!({ "choices": [{ "message": { "tool_calls": [{ "function": { "name": name, "arguments": "{\"reasoning\":\"ok\"}" } }] } }] });
        assert_eq!(parse_verdict(&res("approve")).unwrap(), Verdict::Approved("ok".into()));
        assert_eq!(parse_verdict(&res("reject")).unwrap(), Verdict::Rejected("ok".into()));
        assert!(parse_verdict(&json!({})).is_err());
    }

    #[test]
    fn secret_compare() {
        let mut h = HeaderMap::new();
        h.insert("authorization", "Bearer s3cret".parse().unwrap());
        assert!(secret_ok(&h, "s3cret"));
        assert!(!secret_ok(&h, "s3creT"));
        assert!(!secret_ok(&HeaderMap::new(), "s3cret"));
    }
}
