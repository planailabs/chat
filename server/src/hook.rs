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
//!
//! A **purchase** (a console tool that costs money, see `purchase`) skips
//! all of that: it is always answered `ask` with the console's quote, or
//! `deny` when it can't be priced — never allowed by the allow-list, the
//! validator or "approve all".

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
// Connector calls prefer the service's own hints (`advertised_risk`).
pub fn risk_of(tool: &str) -> Risk {
    let action = tool.rsplit(['_', '.']).next().unwrap_or(tool);
    match action {
        "list" | "get" | "search" | "history" | "export" | "schema" | "catalog" => Risk::ReadOnly,
        "delete" | "remove" | "reset" | "destroy" | "purge" => Risk::Destructive,
        _ => Risk::Mutating,
    }
}

/// What the service itself says about a connector target, from the latest
/// `connector.list_tools` result in the transcript (`{service, tools:
/// [{name, annotations}]}`): readOnlyHint → read-only, destructiveHint →
/// destructive, otherwise mutating. `None`: the agent hasn't listed it.
pub fn advertised_risk(transcript: &Value, call: &str) -> Option<Risk> {
    let (service, tool) = call.split_once('.')?;
    transcript["messages"].as_array()?.iter().rev().filter(|m| m["role"] == "tool").find_map(|m| {
        let listed: Value = serde_json::from_str(m["content"].as_str()?).ok()?;
        if listed["service"] != service {
            return None;
        }
        let t = listed["tools"].as_array()?.iter().find(|t| t["name"] == tool)?;
        let hints = &t["annotations"];
        Some(if hints["readOnlyHint"] == true {
            Risk::ReadOnly
        } else if hints["destructiveHint"] == true {
            Risk::Destructive
        } else {
            Risk::Mutating
        })
    })
}

fn reads(tool: &str) -> bool {
    risk_of(tool) == Risk::ReadOnly
}

pub(crate) fn glob(pattern: &str, name: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => pattern == name,
    }
}

/// A call as the hook judges it: connector calls are judged as the target tool.
#[derive(Debug, Clone, PartialEq)]
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
pub(crate) async fn validate(app: &crate::state::App, call: &Call, risk: Risk, reason: &str, history: &[Call]) -> anyhow::Result<Option<Verdict>> {
    let a = &app.cfg.approval;
    let (Some(url), Some(model)) = (&a.validator_url, &a.validator_model) else { return Ok(None) };
    let recent: String = history.iter().rev().take(10).rev().map(|h| format!("- {}({})\n", h.name, truncate(&h.args.to_string(), 200))).collect();
    let prompt = format!(
        "Tool: `{}` ({risk:?})\nArgs: {}\nAgent's reason: \"{reason}\"\nRecent calls:\n{}\nDoes this call make sense given the reason and the history? Record your verdict with the `approve` or `reject` tool, or start your reply with APPROVE: or REJECT: followed by one sentence why.",
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
        // "auto", not "required": thinking-mode models (deepseek) refuse a
        // forced tool choice. No verdict call is an error: the user decides.
        "tool_choice": "auto",
    });
    let mut req = app.http.post(format!("{}/chat/completions", url.trim_end_matches('/'))).json(&body);
    if let Some(key) = &a.validator_api_key {
        req = req.bearer_auth(key);
    }
    let res: Value = req.send().await?.error_for_status()?.json().await?;
    parse_verdict(&res).map(Some)
}

pub fn parse_verdict(res: &Value) -> anyhow::Result<Verdict> {
    let msg = &res["choices"][0]["message"];
    let call = &msg["tool_calls"][0]["function"];
    let reasoning = call["arguments"].as_str().and_then(|a| serde_json::from_str::<Value>(a).ok()).and_then(|a| a["reasoning"].as_str().map(String::from)).unwrap_or_default();
    match call["name"].as_str() {
        Some("approve") => return Ok(Verdict::Approved(reasoning)),
        Some("reject") => return Ok(Verdict::Rejected(reasoning)),
        _ => {}
    }
    // Thinking-mode models may answer in prose instead of calling a tool: a
    // reply that opens with the verdict counts (markdown and case aside).
    let text = msg["content"].as_str().unwrap_or_default().trim();
    let opening = text.trim_start_matches(|c: char| !c.is_alphanumeric()).to_ascii_lowercase();
    let rest = || text.splitn(2, |c: char| c == ':' || c == '.' || c == '\n').nth(1).unwrap_or("").trim().trim_start_matches('*').trim().to_string();
    if opening.starts_with("approve") {
        return Ok(Verdict::Approved(rest()));
    }
    if opening.starts_with("reject") {
        return Ok(Verdict::Rejected(rest()));
    }
    anyhow::bail!("validator gave no verdict: {res}")
}

fn truncate(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// What the approval layers say about a call the user makes themselves (an
/// MCP client, a page in the chat): there's no agent transcript, only that
/// caller's own recent calls.
pub enum Judgement {
    Allow(String),
    Deny(String),
    /// Only the user can allow it; the text says why it needs them.
    Ask(String),
}

/// Layers 1 and 2 for a present user's call (`reason`: who calls, for the
/// validator).
pub async fn judge_present(app: &crate::state::App, call: &Call, risk: Risk, history: &[Call], reason: &str) -> Judgement {
    if app.cfg.approval.allow.iter().any(|p| glob(p, &call.name)) {
        return Judgement::Allow("allow-listed".into());
    }
    if let Some(why) = static_check(call, risk, history) {
        return Judgement::Deny(why);
    }
    if risk == Risk::ReadOnly {
        return Judgement::Allow("read-only".into());
    }
    match validate(app, call, risk, reason, history).await {
        Ok(Some(Verdict::Rejected(why))) => Judgement::Deny(format!("Rejected by the safety check: {why}")),
        Ok(Some(Verdict::Approved(why))) if risk == Risk::Mutating => Judgement::Allow(why),
        Ok(Some(Verdict::Approved(why))) => Judgement::Ask(format!("The safety check had no objection ({why}), but this is a destructive call.")),
        Ok(None) => Judgement::Ask("No safety check is configured for this call.".into()),
        Err(e) => {
            tracing::warn!("validator failed for {}: {e:#}", call.name);
            Judgement::Ask("The safety check couldn't run; please review this call.".into())
        }
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

/// What the hook answered about a call, recorded for the chat's display.
struct Record<'a> {
    agent: &'a str,
    call_id: &'a str,
    tool: &'a str,
    agent_reason: Option<&'a str>,
}

impl Record<'_> {
    /// Stores the decision (and the safety check's) and answers subnet.
    async fn answer(&self, app: &AppState, decision: &str, check: Option<(&str, &str)>, reason: String) -> Json<Value> {
        self.answer_with(app, decision, check, None, reason).await
    }

    async fn answer_with(&self, app: &AppState, decision: &str, check: Option<(&str, &str)>, purchase: Option<&Value>, reason: String) -> Json<Value> {
        let recorded = match decision {
            "allow" => "allowed",
            "deny" => "denied",
            _ => "asked",
        };
        let res = sqlx::query(
            "INSERT INTO approval_checks (agent_id, call_id, tool, agent_reason, decision, check_verdict, check_reasoning, purchase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (agent_id, call_id) DO UPDATE SET decision = EXCLUDED.decision, check_verdict = EXCLUDED.check_verdict, check_reasoning = EXCLUDED.check_reasoning, purchase = EXCLUDED.purchase",
        )
        .bind(self.agent)
        .bind(self.call_id)
        .bind(self.tool)
        .bind(self.agent_reason)
        .bind(recorded)
        .bind(check.map(|c| c.0))
        .bind(check.map(|c| c.1))
        .bind(purchase)
        .execute(&app.pool)
        .await;
        if let Err(e) = res {
            if purchase.is_some() && decision == "ask" {
                // `chat::approve` reads the purchase from this row to demand
                // an explicit confirmation; without it, don't ask at all.
                tracing::error!(agent = self.agent, call = self.call_id, "recording a purchase: {e}");
                return decide("deny", "This purchase couldn't be recorded for your confirmation, so it wasn't made. Try again.");
            }
            // The decision still stands; only its display is missing.
            tracing::error!(agent = self.agent, call = self.call_id, "recording an approval check: {e}");
        }
        decide(decision, reason)
    }
}

/// What the hook answers about a purchase: the user confirms it with the
/// quote in front of them, or — without a quote — it isn't made. Nothing
/// else (allow-list, validator, "approve all") enters into it.
pub fn purchase_outcome(quote: &Result<Value, String>) -> (&'static str, String) {
    match quote {
        Ok(q) => ("ask", format!("This is a purchase: {}. Confirm it to buy.", q["summary"].as_str().unwrap_or("it costs money"))),
        Err(e) => ("deny", format!("This would buy something, and its price couldn't be determined ({e}), so it wasn't made. Don't retry it blindly; tell the user.")),
    }
}

pub async fn pre_tool(State(app): State<AppState>, headers: HeaderMap, Json(h): Json<HookCall>) -> Result<Json<Value>, StatusCode> {
    if !secret_ok(&headers, &app.cfg.subnet.callback_secret) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let tool = &h.input.tool;
    let call = effective(tool, &h.input.args);
    let rec = Record { agent: &h.agent.id, call_id: &h.input.call_id, tool: &call.name, agent_reason: h.input.reason.as_deref() };
    // Only our conversations: an unknown agent has no user to answer for it.
    let conversation: Option<(uuid::Uuid, bool)> = sqlx::query_as("SELECT user_id, auto_approve FROM conversations WHERE agent_id = $1")
        .bind(&h.agent.id)
        .fetch_optional(&app.pool)
        .await
        .map_err(|e| {
            tracing::error!("approval hook: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // Purchases first: before the allow-list, the validator and "approve all".
    if let (Some(purchases), Some((user, _))) = (&app.purchases, conversation)
        && let Some(quote) = purchases.check(&user.to_string(), tool, &h.input.args).await
    {
        let (decision, why) = purchase_outcome(&quote);
        return Ok(rec.answer_with(&app, decision, None, quote.as_ref().ok(), why).await);
    }
    // A connector call with no user behind it can't be priced or confirmed.
    if conversation.is_none() && tool == "connector.call_tool" {
        return Ok(decide("deny", "not a chat conversation"));
    }
    if app.cfg.approval.allow.iter().any(|p| glob(p, tool)) {
        return Ok(rec.answer(&app, "allow", None, "allow-listed".into()).await);
    }
    let Some((_, auto_approve)) = conversation else { return Ok(decide("deny", "not a chat conversation")) };

    let transcript = app.hub.transcript(&h.agent.id).await.map_err(|e| {
        tracing::error!("approval hook: transcript of {}: {e:#}", h.agent.id);
        StatusCode::BAD_GATEWAY
    })?;
    // The service's own annotations when the agent listed its tools (as it's
    // told to before calling one); the name's verb only otherwise.
    let risk = if tool == "connector.call_tool" { advertised_risk(&transcript, &call.name) } else { None }.unwrap_or_else(|| risk_of(&call.name));
    let history = past_calls(&transcript, &h.input.call_id);
    if let Some(why) = static_check(&call, risk, &history) {
        return Ok(rec.answer(&app, "deny", None, why).await);
    }
    if risk == Risk::ReadOnly {
        return Ok(rec.answer(&app, "allow", None, "read-only".into()).await);
    }

    let reason = h.input.reason.as_deref().unwrap_or("(none given)");
    let verdict = match validate(&app, &call, risk, reason, &history).await {
        Ok(v) => v,
        Err(e) => {
            // The user still decides; they're told the check didn't run.
            tracing::warn!("validator failed for {}: {e:#}", call.name);
            // Short for the user; the details go with the check.
            let why = "The safety check couldn't run; please review this call.".to_string();
            return Ok(rec.answer(&app, "ask", Some(("failed", &e.to_string())), why).await);
        }
    };
    Ok(match verdict {
        Some(Verdict::Rejected(why)) => rec.answer(&app, "deny", Some(("rejected", &why)), format!("Rejected by the safety check: {why}")).await,
        Some(Verdict::Approved(why)) if risk == Risk::Mutating || auto_approve => rec.answer(&app, "allow", Some(("approved", &why)), why.clone()).await,
        None if auto_approve => rec.answer(&app, "allow", None, "the user approved all calls in this conversation".into()).await,
        Some(Verdict::Approved(why)) => rec.answer(&app, "ask", Some(("approved", &why)), why.clone()).await,
        None => rec.answer(&app, "ask", None, String::new()).await,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_listed_tool_is_judged_by_its_annotations() {
        use super::{Risk, advertised_risk};
        let listed = |ro: bool, de: bool| {
            serde_json::json!({ "service": "plan-ai-cloud", "tools": [
                { "name": "repo_deploy", "annotations": { "readOnlyHint": ro, "destructiveHint": de } },
            ] })
            .to_string()
        };
        let t = serde_json::json!({ "messages": [
            { "role": "tool", "content": listed(false, false), "tool_call_id": "a" },
            { "role": "tool", "content": "not json", "tool_call_id": "b" },
            { "role": "tool", "content": listed(true, false), "tool_call_id": "c" },
        ] });
        // The latest listing counts.
        assert_eq!(advertised_risk(&t, "plan-ai-cloud.repo_deploy"), Some(Risk::ReadOnly));
        let t2 = serde_json::json!({ "messages": [{ "role": "tool", "content": listed(false, true) }] });
        assert_eq!(advertised_risk(&t2, "plan-ai-cloud.repo_deploy"), Some(Risk::Destructive));
        // Not listed, or another service: the name decides.
        assert_eq!(advertised_risk(&t, "plan-ai-cloud.repo_set_deploy"), None);
        assert_eq!(advertised_risk(&t, "mac-mgmt.repo_deploy"), None);
    }

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
        let prose = |t: &str| json!({ "choices": [{ "message": { "content": t } }] });
        assert_eq!(parse_verdict(&prose("**Approve.** It matches the stated intent.")).unwrap(), Verdict::Approved("It matches the stated intent.".into()));
        assert_eq!(parse_verdict(&prose("REJECT: deletes the wrong item")).unwrap(), Verdict::Rejected("deletes the wrong item".into()));
        assert!(parse_verdict(&prose("Hmm, hard to say.")).is_err(), "no verdict word: the user decides");
    }

    #[test]
    fn a_purchase_is_asked_with_its_quote_and_never_bought_unpriced() {
        let quote = json!({ "billable": true, "summary": "cms agent 'Shop' in Clover Inc — 49.00 USD / month, 14-day trial" });
        // The outcome depends on the quote alone: auto_approve, the allow-list
        // and the validator aren't inputs, and pre_tool answers it before
        // consulting any of them.
        let (decision, why) = purchase_outcome(&Ok(quote));
        assert_eq!(decision, "ask");
        assert!(why.contains("49.00 USD / month"), "{why}");
        let (decision, why) = purchase_outcome(&Err("502 Bad Gateway: console down".into()));
        assert_eq!(decision, "deny");
        assert!(why.contains("console down") && why.contains("price couldn't be determined"), "{why}");
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
