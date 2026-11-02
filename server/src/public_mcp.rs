//! `/public/mcp`: the chat's own API and the user's services (mgmt.plan.ai,
//! their cloud deployments) for an outside MCP client — Claude, ChatGPT,
//! Cursor — signed in through OAuth (plan-ai-oauth, mounted in main).
//!
//! Every call is judged like a chat agent's (see `hook`): the allow-list and
//! static check, then the validator model. What the chat would put to the
//! user as approve/deny, this asks in the MCP client (elicitation); a client
//! that can't ask gets a refusal saying so. Purchases are off unless the
//! user turned on `mcp_purchases`, and then each is confirmed with its price.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;

use plan_ai_api_mcp::{Principal, Registry};
use plan_ai_auth::UserResolver;
use plan_ai_connector::Connector;
use plan_ai_oauth::Grant;
use rmcp::model::*;
use rmcp::service::RequestContext;
use rmcp::{RoleServer, ServerHandler};
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::hook::{self, Call, Risk, Verdict};
use crate::state::AppState;

type McpError = ErrorData;

/// Separates a service from its tool in a listed name (`mac-mgmt__skill_list`).
const SEP: &str = "__";

/// One MCP session.
#[derive(Clone)]
pub struct PublicMcp {
    app: AppState,
    registry: Arc<Registry<AppState>>,
    connector: Option<Connector>,
    session: Arc<Session>,
}

#[derive(Default)]
struct Session {
    who: RwLock<Option<Who>>,
    /// Listed service tools: name → (service, tool, risk by its annotations).
    services: Mutex<HashMap<String, (String, String, Risk)>>,
    /// This session's allowed calls, for the static check and the validator.
    history: Mutex<Vec<Call>>,
}

#[derive(Clone)]
struct Who {
    user: Uuid,
    email: String,
    client: String,
    principal: Arc<Principal>,
}

impl PublicMcp {
    pub fn new(app: AppState, registry: Arc<Registry<AppState>>, connector: Option<Connector>) -> Self {
        Self { app, registry, connector, session: Arc::default() }
    }

    async fn who(&self) -> Result<Who, McpError> {
        self.session.who.read().await.clone().ok_or_else(|| McpError::invalid_request("not initialized", None))
    }
}

/// A service name as part of a tool name: MCP tool names are `[A-Za-z0-9_-]`.
fn tool_name(service: &str, tool: &str) -> String {
    let s: String = service.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    let name = format!("{s}{SEP}{tool}");
    name.chars().take(64).collect()
}

fn risk_of_annotations(a: Option<&ToolAnnotations>, name: &str) -> Risk {
    match a {
        Some(a) if a.read_only_hint == Some(true) => Risk::ReadOnly,
        Some(a) if a.destructive_hint == Some(true) => Risk::Destructive,
        Some(a) if a.destructive_hint == Some(false) => Risk::Mutating,
        _ => hook::risk_of(name),
    }
}

fn api_risk(r: plan_ai_api_mcp::Risk) -> Risk {
    match r {
        plan_ai_api_mcp::Risk::ReadOnly => Risk::ReadOnly,
        plan_ai_api_mcp::Risk::Mutating => Risk::Mutating,
        plan_ai_api_mcp::Risk::Destructive => Risk::Destructive,
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max).collect::<String>()) }
}

fn refused(why: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![Content::text(why.into())])
}

/// What the approval layers say about a call.
enum Judgement {
    Allow(String),
    Deny(String),
    /// Only the user can allow it; the text says why it needs them.
    Ask(String),
}

impl PublicMcp {
    /// Layers 1 and 2 of `hook`, for a call from an MCP client: there is no
    /// agent reason and no transcript, only this session's calls.
    async fn judge(&self, call: &Call, risk: Risk) -> Judgement {
        if self.app.cfg.approval.allow.iter().any(|p| hook::glob(p, &call.name)) {
            return Judgement::Allow("allow-listed".into());
        }
        let history = self.session.history.lock().await.clone();
        if let Some(why) = hook::static_check(call, risk, &history) {
            return Judgement::Deny(why);
        }
        if risk == Risk::ReadOnly {
            return Judgement::Allow("read-only".into());
        }
        match hook::validate(&self.app, call, risk, "(called from an MCP client; no reason given)", &history).await {
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

    /// Asks the user in their MCP client. `Ok(true)`: they confirmed.
    /// `Err`: the client can't ask, with the refusal to send instead.
    async fn confirm(&self, context: &RequestContext<RoleServer>, message: String) -> Result<bool, String> {
        let can_ask = context.peer.peer_info().is_some_and(|i| i.capabilities.elicitation.is_some());
        if !can_ask {
            return Err(format!("{message}\n\nThis needs your confirmation, and this MCP client can't ask for it. Do it in the plan.ai chat (agent.plan.ai) instead."));
        }
        let schema = ElicitationSchema::builder().required_bool("confirm").build().map_err(|e| e.to_string())?;
        let asked = context
            .peer
            .create_elicitation(CreateElicitationRequestParams::FormElicitationParams { meta: None, message, requested_schema: schema })
            .await;
        match asked {
            Ok(r) => Ok(r.action == ElicitationAction::Accept && r.content.as_ref().and_then(|c| c["confirm"].as_bool()) == Some(true)),
            Err(e) => Err(format!("Asking for your confirmation failed ({e}), so the call wasn't made.")),
        }
    }

    /// The approval layers for one call: `None` to go ahead (and it joins
    /// this session's history), or the refusal to answer with.
    async fn gate(&self, who: &Who, call: &Call, risk: Risk, context: &RequestContext<RoleServer>) -> Option<CallToolResult> {
        let verdict = match self.judge(call, risk).await {
            Judgement::Allow(why) => Ok(why),
            Judgement::Deny(why) => Err(why),
            Judgement::Ask(why) => {
                let message = format!("{} wants to run {} with {}.\n{why}\nAllow it?", who.client, call.name, truncate(&call.args.to_string(), 600));
                match self.confirm(context, message).await {
                    Ok(true) => Ok("confirmed by the user".into()),
                    Ok(false) => Err("You declined this call; it wasn't made.".into()),
                    Err(why) => Err(why),
                }
            }
        };
        match verdict {
            Ok(why) => {
                self.audit(who, &call.name, "allow", &why).await;
                self.session.history.lock().await.push(call.clone());
                None
            }
            Err(why) => {
                self.audit(who, &call.name, "deny", &why).await;
                Some(refused(why))
            }
        }
    }

    /// Logged, and kept for the user (settings, data export).
    async fn audit(&self, who: &Who, tool: &str, decision: &str, why: &str) {
        tracing::info!(target: "plan_ai_chat::public_mcp", user = %who.user, email = %who.email, client = %who.client, tool, decision, why, "public MCP call");
        let res = sqlx::query("INSERT INTO mcp_calls (user_id, client, tool, decision, reason) VALUES ($1, $2, $3, $4, $5)")
            .bind(who.user)
            .bind(&who.client)
            .bind(tool)
            .bind(decision)
            .bind(why)
            .execute(&self.app.pool)
            .await;
        if let Err(e) = res {
            tracing::error!(user = %who.user, tool, "recording an MCP call: {e}");
        }
    }

    async fn mcp_purchases(&self, user: Uuid) -> bool {
        sqlx::query_scalar::<_, bool>("SELECT mcp_purchases FROM profiles WHERE user_id = $1")
            .bind(user)
            .fetch_optional(&self.app.pool)
            .await
            .ok()
            .flatten()
            .unwrap_or(false)
    }

    async fn list_service_tools(&self, who: &Who) -> Vec<Tool> {
        let Some(connector) = &self.connector else { return vec![] };
        let tenant = who.user.to_string();
        let services = match connector.services(&tenant).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(user = %who.user, "public MCP: listing services: {e}");
                return vec![];
            }
        };
        let listed = futures::future::join_all(services.iter().map(|s| connector.service_tools(&tenant, &s.name))).await;
        let mut map = HashMap::new();
        let mut tools = Vec::new();
        for (service, result) in services.iter().zip(listed) {
            let list = match result {
                Ok(l) => l,
                Err(e) => {
                    tracing::warn!(user = %who.user, service = %service.name, "public MCP: listing tools: {e}");
                    continue;
                }
            };
            for mut t in list {
                let inner = t.name.to_string();
                let name = tool_name(&service.name, &inner);
                let risk = risk_of_annotations(t.annotations.as_ref(), &format!("{}.{inner}", service.name));
                map.insert(name.clone(), (service.name.clone(), inner, risk));
                t.description = Some(Cow::Owned(format!("[{}] {}", service.name, t.description.as_deref().unwrap_or(""))));
                t.name = Cow::Owned(name);
                tools.push(t);
            }
        }
        *self.session.services.lock().await = map;
        tools
    }
}

impl ServerHandler for PublicMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "plan.ai as the signed-in user: the chat's own API (conversations, profile) and the user's plan.ai \
                 services, named `<service>__<tool>`. Each call is checked like the plan.ai chat's agents' calls; risky \
                 ones ask the user to confirm."
                    .into(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation { name: "plan.ai agent".into(), version: env!("CARGO_PKG_VERSION").into(), ..Default::default() },
            ..Default::default()
        }
    }

    async fn initialize(&self, request: InitializeRequestParams, context: RequestContext<RoleServer>) -> Result<InitializeResult, McpError> {
        if context.peer.peer_info().is_none() {
            context.peer.set_peer_info(request);
        }
        let grant = context
            .extensions
            .get::<axum::http::request::Parts>()
            .and_then(|p| p.extensions.get::<Grant>())
            .cloned()
            .ok_or_else(|| McpError::invalid_request("not signed in (OAuth)", None))?;
        let web = plan_ai_accounts::Resolver(self.app.accounts.clone())
            .load_user_by_id(grant.user_id)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?
            .ok_or_else(|| McpError::invalid_request("this account no longer exists", None))?;
        let principal = self.app.accounts.principal(&web).await.map_err(|e| McpError::internal_error(e.to_string(), None))?;
        if principal.scopes["pending"] == json!(true) {
            return Err(McpError::invalid_request("your account is waiting for an admin to approve it", None));
        }
        let mut p = principal;
        p.scopes["mcp_client"] = json!(grant.client_name);
        *self.session.who.write().await = Some(Who { user: web.id, email: web.email.clone(), client: grant.client_name, principal: Arc::new(p) });
        Ok(self.get_info())
    }

    async fn list_tools(&self, _request: Option<PaginatedRequestParams>, _context: RequestContext<RoleServer>) -> Result<ListToolsResult, McpError> {
        let who = self.who().await?;
        let mut tools: Vec<Tool> = self.registry.endpoints().iter().map(|e| e.mcp_tool()).collect();
        tools.extend(self.list_service_tools(&who).await);
        Ok(ListToolsResult { tools, next_cursor: None, meta: None })
    }

    async fn call_tool(&self, request: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResult, McpError> {
        let who = self.who().await?;
        let name = request.name.to_string();
        let args = request.arguments.clone().map(Value::Object).unwrap_or_else(|| json!({}));

        // The chat's own API.
        if let Some(ep) = self.registry.endpoints().iter().find(|e| e.tool_name() == name).cloned() {
            let call = Call { name: format!("chat.{name}"), args: args.clone() };
            if let Some(refusal) = self.gate(&who, &call, api_risk(ep.risk()), &context).await {
                return Ok(refusal);
            }
            let out = self.registry.call_by_name(self.app.clone(), who.principal.clone(), &name, args).await;
            return ep.mcp_result(out);
        }

        // A service's tool.
        let mut entry = self.session.services.lock().await.get(&name).cloned();
        if entry.is_none() {
            self.list_service_tools(&who).await;
            entry = self.session.services.lock().await.get(&name).cloned();
        }
        let Some((service, tool, risk)) = entry else {
            return Err(McpError::invalid_params(format!("unknown tool: {name}"), None));
        };
        let Some(connector) = &self.connector else { return Ok(refused("no services are configured")) };
        let call = Call { name: format!("{service}.{tool}"), args: args.clone() };

        // Purchases: before everything else, as in the chat.
        let as_connector = json!({ "service": service, "tool": tool, "arguments": args });
        if let Some(purchases) = &self.app.purchases
            && let Some(quote) = purchases.check(&who.user.to_string(), "connector.call_tool", &as_connector).await
        {
            let quote = match quote {
                Ok(q) => q,
                Err(e) => {
                    self.audit(&who, &call.name, "deny", "purchase without a price").await;
                    return Ok(refused(format!("This would buy something, and its price couldn't be determined ({e}), so it wasn't made.")));
                }
            };
            if !self.mcp_purchases(who.user).await {
                self.audit(&who, &call.name, "deny", "purchases over MCP are off").await;
                return Ok(refused(
                    "This is a purchase, and purchases from MCP clients are off for your account. Turn on \"Purchases from MCP clients\" in the plan.ai chat's settings (agent.plan.ai), or buy it there.",
                ));
            }
            let summary = quote["summary"].as_str().unwrap_or("it costs money");
            return match self.confirm(&context, format!("{} wants to buy: {summary}. Confirm this purchase?", who.client)).await {
                Ok(true) => {
                    self.audit(&who, &call.name, "allow", "purchase confirmed").await;
                    Ok(connector.call(&who.user.to_string(), &service, &tool, request.arguments).await)
                }
                Ok(false) => {
                    self.audit(&who, &call.name, "deny", "purchase declined").await;
                    Ok(refused("You declined the purchase; nothing was bought."))
                }
                Err(why) => {
                    self.audit(&who, &call.name, "deny", "purchase: client can't ask").await;
                    Ok(refused(why))
                }
            };
        }

        if let Some(refusal) = self.gate(&who, &call, risk, &context).await {
            return Ok(refusal);
        }
        Ok(connector.call(&who.user.to_string(), &service, &tool, request.arguments).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_tools_get_mcp_safe_names() {
        assert_eq!(tool_name("mac-mgmt", "skill_list"), "mac-mgmt__skill_list");
        assert_eq!(tool_name("cms agent.acme", "page_update"), "cms_agent_acme__page_update");
        assert!(tool_name(&"x".repeat(80), "t").len() <= 64);
    }

    #[test]
    fn a_service_tool_is_judged_by_its_annotations_then_its_verb() {
        let ro = ToolAnnotations::new().read_only(true).destructive(false);
        let de = ToolAnnotations::new().read_only(false).destructive(true);
        let mu = ToolAnnotations::new().read_only(false).destructive(false);
        assert_eq!(risk_of_annotations(Some(&ro), "svc.page_delete"), Risk::ReadOnly);
        assert_eq!(risk_of_annotations(Some(&de), "svc.page_list"), Risk::Destructive);
        assert_eq!(risk_of_annotations(Some(&mu), "svc.page_delete"), Risk::Mutating);
        assert_eq!(risk_of_annotations(None, "svc.page_delete"), Risk::Destructive);
        assert_eq!(risk_of_annotations(None, "svc.page_list"), Risk::ReadOnly);
    }
}
