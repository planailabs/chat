//! Purchases: connector calls that spend the user's money on the console.
//!
//! The console says which of its tools are billable (`purchase_billable`) and
//! prices one call of them (`purchase_quote`), both asked as the user. The
//! approval hook turns such a call into a confirmation with the quote in it —
//! never allowed by the validator, the allow-list or "approve all" — and
//! denies it when it can't be priced.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use plan_ai_connector::{SubjectResolver, TokenExchanger};
use serde_json::{Value, json};

use crate::config::{Config, Console};
use crate::connector::ProfileSubjects;

/// The console's own connector service (its `connector_targets` entry).
pub const CONSOLE_KIND: &str = "plan-ai-cloud";

/// The billable list changes with console releases, not per call.
const BILLABLE_FOR: Duration = Duration::from_secs(600);

pub struct Purchases {
    cfg: &'static Config,
    console: &'static Console,
    exchanger: Arc<TokenExchanger>,
    subjects: ProfileSubjects,
    http: reqwest::Client,
    billable: Mutex<Option<(Instant, Vec<String>)>>,
}

impl Purchases {
    pub fn build(cfg: &'static Config, exchanger: Arc<TokenExchanger>, subjects: ProfileSubjects, http: reqwest::Client) -> Option<Self> {
        let console = cfg.connector.as_ref()?.console.as_ref()?;
        Some(Self { cfg, console, exchanger, subjects, http, billable: Mutex::new(None) })
    }

    /// Whether `service` is the console: its own entry, or a configured
    /// target of the console's kind.
    pub fn is_console(&self, service: &str) -> bool {
        service == CONSOLE_KIND || self.cfg.apps.iter().any(|a| a.name == service && a.kind == CONSOLE_KIND && a.mcp.is_some())
    }

    async fn post(&self, tenant: &str, path: &str, body: Value) -> anyhow::Result<Value> {
        let subject = self.subjects.subject(tenant).await.map_err(|e| anyhow::anyhow!("{e}"))?;
        let token = self.exchanger.token_for(&subject, &self.console.audience_project_id).await?;
        let url = format!("{}/api/v1/{path}", self.console.url.trim_end_matches('/'));
        let res = self.http.post(&url).bearer_auth(token).json(&body).timeout(Duration::from_secs(20)).send().await?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["message"].as_str().map(String::from)).unwrap_or(text);
            anyhow::bail!("{status}: {msg}");
        }
        Ok(res.json().await?)
    }

    /// The console's billable tools, cached for ten minutes (fetched as
    /// whichever user needs it first; the list is the same for everyone).
    pub async fn billable(&self, tenant: &str) -> anyhow::Result<Vec<String>> {
        if let Some((at, list)) = &*self.billable.lock().expect("billable lock")
            && at.elapsed() < BILLABLE_FOR
        {
            return Ok(list.clone());
        }
        let v = self.post(tenant, "purchase/billable", json!({})).await?;
        let list: Vec<String> = serde_json::from_value(v["billable_tools"].clone())?;
        *self.billable.lock().expect("billable lock") = Some((Instant::now(), list.clone()));
        Ok(list)
    }

    /// What this call would cost, as the console prices it for the user.
    pub async fn quote(&self, tenant: &str, tool: &str, arguments: &Value) -> anyhow::Result<Value> {
        self.post(tenant, "purchase/quote", json!({ "tool": tool, "arguments": arguments })).await
    }

    /// For a connector call: `None` when it buys nothing; otherwise its quote,
    /// or why there is none. The billable list failing to load counts as a
    /// failed quote for any console call that might be one — unpriced is
    /// never treated as free.
    pub async fn check(&self, tenant: &str, tool: &str, args: &Value) -> Option<Result<Value, String>> {
        if tool != "connector.call_tool" || !self.is_console(args["service"].as_str().unwrap_or_default()) {
            return None;
        }
        let target = args["tool"].as_str().unwrap_or_default();
        let billable = match self.billable(tenant).await {
            Ok(list) => list,
            Err(e) if is_read_only(target) => {
                tracing::warn!("billable tools unavailable, letting read-only {target} through: {e:#}");
                return None;
            }
            Err(e) => return Some(Err(format!("couldn't learn which console tools cost money: {e:#}"))),
        };
        if !billable.iter().any(|b| b == target) {
            return None;
        }
        match self.quote(tenant, target, &args["arguments"]).await {
            // Only sometimes a purchase (a connection to something other than
            // plan.ai's gateway): the normal layers judge it.
            Ok(q) if q["billable"] == json!(false) => None,
            Ok(q) => Some(Ok(q)),
            Err(e) => Some(Err(format!("{e:#}"))),
        }
    }
}

fn is_read_only(tool: &str) -> bool {
    crate::hook::risk_of(tool) == crate::hook::Risk::ReadOnly
}
