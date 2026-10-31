//! Tools the chat agents call on this server (subnet MCP server `chat`,
//! mounted at `/agent/mcp`). Subnet authenticates with the callback secret;
//! the user is the call's tenant (`_meta["subnet/tenant"]`, our user id).

use std::sync::Arc;

use plan_ai_api_mcp::{ApiError, Authenticator, OnItem, Principal, Registry, Risk};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::state::AppState;

pub struct SubnetAuth(pub String);

#[async_trait::async_trait]
impl Authenticator for SubnetAuth {
    async fn authenticate(&self, bearer: &str) -> Result<Principal, ApiError> {
        let ok = bearer.len() == self.0.len() && bearer.bytes().zip(self.0.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0;
        if ok { Ok(Principal::scoped("subnet", Default::default(), Default::default())) } else { Err(ApiError::unauthorized("bad callback secret")) }
    }
}

fn tenant(p: &Principal) -> Result<Uuid, ApiError> {
    p.scopes["mcp_meta"]["subnet/tenant"].as_str().and_then(|t| t.parse().ok()).ok_or_else(|| ApiError::bad_request("no tenant: this tool only runs inside a chat conversation"))
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Topic {
    Overview,
    Departments,
    Architecture,
    UseCases,
    GettingStarted,
    Faq,
}

#[derive(Deserialize, JsonSchema)]
pub struct ProductInput {
    topic: Topic,
}

#[derive(Serialize, JsonSchema)]
pub struct Text {
    text: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PingReason {
    DemoRequest,
    CallbackRequest,
    SupportEscalation,
    Other,
}

#[derive(Deserialize, JsonSchema)]
pub struct PingInput {
    reason: PingReason,
    /// What the user wants, in a sentence or two, for the staff member.
    message: String,
}

#[derive(Serialize, JsonSchema)]
pub struct Sent {
    sent: bool,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CatalogPart {
    Catalog,
    AvailableSkills,
    AvailableBundles,
    AvailableMcpServers,
    AvailableMcpBundles,
}

#[derive(Deserialize, JsonSchema)]
pub struct CatalogInput {
    part: CatalogPart,
}

/// Drop `installed*` keys: they describe the service account's machine, not
/// the user's.
fn strip_installed(v: &mut Value) {
    match v {
        Value::Object(m) => {
            m.retain(|k, _| !k.starts_with("installed"));
            m.values_mut().for_each(strip_installed);
        }
        Value::Array(a) => a.iter_mut().for_each(strip_installed),
        _ => {}
    }
}

pub fn registry(secret: &str) -> Registry<AppState> {
    let mut reg = Registry::new(Arc::new(SubnetAuth(secret.to_string())))
        .info("plan.ai chat agent tools", env!("CARGO_PKG_VERSION"))
        .instructions("Tools of the plan.ai chat assistants: product documentation, the public catalog, and asking a human to follow up.");

    reg.resource("product", "product", "plan.ai product documentation").get(
        "plan.ai product documentation on one topic, as markdown. Read it before answering product questions.",
        |_: AppState, _: Arc<Principal>, i: ProductInput| async move {
            let text = match i.topic {
                Topic::Overview => include_str!("../content/overview.md"),
                Topic::Departments => include_str!("../content/departments.md"),
                Topic::Architecture => include_str!("../content/architecture.md"),
                Topic::UseCases => include_str!("../content/use-cases.md"),
                Topic::GettingStarted => include_str!("../content/getting-started.md"),
                Topic::Faq => include_str!("../content/faq.md"),
            };
            Ok(Text { text: text.to_string() })
        },
    );

    reg.resource("catalog", "catalog", "The public plan.ai catalog").get(
        "What can be installed on a plan.ai machine: skills, bundles, MCP servers, MCP bundles.",
        |app: AppState, _: Arc<Principal>, i: CatalogInput| async move {
            let c = app.cfg.catalog.as_ref().ok_or_else(|| ApiError::internal("the catalog isn't configured"))?;
            let path = match i.part {
                CatalogPart::Catalog => "api/setting/catalog",
                CatalogPart::AvailableSkills => "api/setting/available/skill-channels",
                CatalogPart::AvailableBundles => "api/setting/available/bundles",
                CatalogPart::AvailableMcpServers => "api/setting/available/mcp-servers",
                CatalogPart::AvailableMcpBundles => "api/setting/available/mcp-bundles",
            };
            let url = format!("{}/{path}", c.url.trim_end_matches('/'));
            let res = app.http.get(&url).bearer_auth(&c.token).send().await.map_err(|e| ApiError::internal(format!("catalog: {e}")))?;
            let status = res.status();
            if !status.is_success() {
                return Err(ApiError::internal(format!("catalog: {status}: {}", res.text().await.unwrap_or_default())));
            }
            let mut v: Value = res.json().await.map_err(|e| ApiError::internal(format!("catalog: {e}")))?;
            strip_installed(&mut v);
            Ok(v)
        },
    );

    reg.resource("staff_ping", "staff_ping", "Ask a human at plan.ai to follow up").custom(
        "send",
        Risk::Mutating,
        OnItem::No,
        "Notify plan.ai staff (the user doesn't see it): for demo or callback requests, or when you can't help further.",
        |app: AppState, p: Arc<Principal>, i: PingInput| async move {
            let user = tenant(&p)?;
            let reason = match i.reason {
                PingReason::DemoRequest => "demo_request",
                PingReason::CallbackRequest => "callback_request",
                PingReason::SupportEscalation => "support_escalation",
                PingReason::Other => "other",
            };
            sqlx::query("INSERT INTO staff_pings (user_id, reason, message) VALUES ($1, $2, $3)")
                .bind(user)
                .bind(reason)
                .bind(&i.message)
                .execute(&app.pool)
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            Ok(Sent { sent: true })
        },
    );

    reg
}

#[cfg(test)]
mod tests {
    #[test]
    fn strips_installed_everywhere() {
        let mut v = serde_json::json!({ "installed": 1, "skills": [{ "id": "a", "installed_at": "x" }] });
        super::strip_installed(&mut v);
        assert_eq!(v, serde_json::json!({ "skills": [{ "id": "a" }] }));
    }
}
