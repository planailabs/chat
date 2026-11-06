//! `/public/mcp`: the chat's own API and the user's services (mgmt.plan.ai,
//! their cloud deployments) for an outside MCP client — Claude, ChatGPT,
//! Cursor — signed in through OAuth (plan-ai-oauth, mounted in main). The
//! services come as the connector's three tools (`list_services`,
//! `list_tools`, `call_tool`), the way the chat's agents see them.
//!
//! Every call is judged like a chat agent's (see `hook`): the allow-list and
//! static check, then the validator model. What the chat would put to the
//! user as approve/deny, this asks in the MCP client (elicitation); a client
//! that can't ask gets a refusal saying so. Purchases are off unless the
//! user turned on `mcp_purchases`, and then each is confirmed with its price.

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

use crate::hook::{self, Call, Judgement, Risk};
use crate::state::AppState;

type McpError = ErrorData;

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
    /// Service tools' risk by their annotations, as listed in this session:
    /// (service, tool) → risk.
    risks: Mutex<HashMap<(String, String), Risk>>,
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

fn json_result(v: Value) -> CallToolResult {
    CallToolResult {
        content: vec![Content::text(serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string()))],
        structured_content: Some(v),
        is_error: Some(false),
        meta: None,
    }
}

fn refused(why: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![Content::text(why.into())])
}

impl PublicMcp {
    /// Layers 1 and 2 of `hook`, for a call from an MCP client: there is no
    /// agent reason and no transcript, only this session's calls.
    async fn judge(&self, call: &Call, risk: Risk) -> Judgement {
        let history = self.session.history.lock().await.clone();
        hook::judge_present(&self.app, call, risk, &history, "(called from an MCP client; no reason given)").await
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
            Judgement::Rejected(why) => Err(format!("Rejected by the safety check: {why}")),
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

    /// One service's tools as the user, remembering each one's risk for
    /// the approval of later calls.
    async fn service_tools(&self, connector: &Connector, who: &Who, service: &str) -> Result<Vec<Tool>, String> {
        let tools = connector.service_tools(&who.user.to_string(), service).await?;
        let mut risks = self.session.risks.lock().await;
        for t in &tools {
            let risk = risk_of_annotations(t.annotations.as_ref(), &format!("{service}.{}", t.name));
            risks.insert((service.to_string(), t.name.to_string()), risk);
        }
        Ok(tools)
    }

    /// A service tool's risk: from its annotations (listed now if the client
    /// hasn't), else from its name's verb.
    async fn service_risk(&self, connector: &Connector, who: &Who, service: &str, tool: &str) -> Risk {
        let key = (service.to_string(), tool.to_string());
        if let Some(r) = self.session.risks.lock().await.get(&key) {
            return *r;
        }
        let _ = self.service_tools(connector, who, service).await;
        self.session.risks.lock().await.get(&key).copied().unwrap_or_else(|| hook::risk_of(&format!("{service}.{tool}")))
    }
}

impl ServerHandler for PublicMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "plan.ai as the signed-in user: the chat's own API (conversations, profile) and the user's plan.ai \
                 services: list_services, then list_tools {service} (check each tool's annotations), then call_tool \
                 {service, tool, arguments}. Each call is checked like the plan.ai chat's agents' calls; risky ones \
                 ask the user to confirm."
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
        let mut tools: Vec<Tool> = self.registry.endpoints().iter().filter(|e| e.visible_to(&who.principal)).map(|e| e.mcp_tool()).collect();
        if self.connector.is_some() {
            tools.extend(plan_ai_connector::connector_tools());
        }
        Ok(ListToolsResult { tools, next_cursor: None, meta: None })
    }

    async fn call_tool(&self, request: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResult, McpError> {
        let who = self.who().await?;
        let name = request.name.to_string();
        let args = request.arguments.clone().map(Value::Object).unwrap_or_else(|| json!({}));

        // The chat's own API.
        if let Some(ep) = self.registry.endpoints().iter().find(|e| e.tool_name() == name && e.visible_to(&who.principal)).cloned() {
            let call = Call { name: format!("chat.{name}"), args: args.clone() };
            if let Some(refusal) = self.gate(&who, &call, api_risk(ep.risk()), &context).await {
                return Ok(refusal);
            }
            let out = self.registry.call_by_name(self.app.clone(), who.principal.clone(), &name, args).await;
            return ep.mcp_result(out);
        }

        // The user's services, through the connector's three tools.
        let Some(connector) = &self.connector else {
            return Err(McpError::invalid_params(format!("unknown tool: {name}"), None));
        };
        let field = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_owned);
        match name.as_str() {
            // Reading which services and tools there are needs no approval.
            "list_services" => {
                return Ok(match connector.service_entries(&who.user.to_string()).await {
                    Ok(services) => json_result(json!({ "services": services })),
                    Err(e) => refused(format!("listing your services failed: {e}")),
                });
            }
            "list_tools" => {
                let Some(service) = field("service") else { return Err(McpError::invalid_params("list_tools needs {service}", None)) };
                return Ok(match self.service_tools(connector, &who, &service).await {
                    Ok(tools) => json_result(json!({ "service": service, "tools": tools })),
                    Err(e) => refused(e),
                });
            }
            "call_tool" => {}
            _ => return Err(McpError::invalid_params(format!("unknown tool: {name}"), None)),
        }
        let (Some(service), Some(tool)) = (field("service"), field("tool")) else {
            return Err(McpError::invalid_params("call_tool needs {service, tool, arguments}", None));
        };
        let inner_args = args.get("arguments").and_then(Value::as_object).cloned();
        let args = inner_args.clone().map(Value::Object).unwrap_or_else(|| json!({}));
        let call = Call { name: format!("{service}.{tool}"), args: args.clone() };
        let risk = self.service_risk(connector, &who, &service, &tool).await;

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
                    Ok(connector.call(&who.user.to_string(), &service, &tool, inner_args).await)
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
        Ok(connector.call(&who.user.to_string(), &service, &tool, inner_args).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
