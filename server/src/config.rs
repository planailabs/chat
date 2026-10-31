//! `config.toml` (path in `CONFIG_PATH`, default `config.toml`), plus an
//! optional secrets file (`CONFIG_SECRETS_PATH`) merged over it.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;

pub use plan_ai_auth::AuthConfig;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub database: Database,
    #[serde(default)]
    pub web: Web,
    /// OIDC sign-in (Zitadel). Without it only a debug build with
    /// `DEV_ONLY_NO_AUTH=1` starts.
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub accounts: Accounts,
    pub subnet: Subnet,
    pub approval: Approval,
    #[serde(default)]
    pub chat: Chat,
    /// mac-mgmt's public catalog, read by the sales agent with a service token.
    pub catalog: Option<Catalog>,
    /// Acting as the user on plan.ai services (`/connector/mcp`). Without it,
    /// modes that need a service are unavailable.
    pub connector: Option<Connector>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connector {
    /// Zitadel token exchange: the exchange app and the impersonating service account.
    pub exchange: plan_ai_connector::ExchangeConfig,
    /// Services every user can reach (each authorizes the user itself).
    // ponytail: one list for everyone; per-user deployments come from a
    // plan-ai-cloud TargetSource once the console lists them.
    #[serde(default)]
    pub targets: Vec<plan_ai_connector::Target>,
    /// plan-ai-cloud's console: lists each user's deployments
    /// (`GET /api/v1/connector_targets`, called as the user).
    pub console: Option<Console>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Console {
    /// e.g. `https://cloud.plan.ai`
    pub url: String,
    /// The console API's Zitadel project (audience of the user's token).
    pub audience_project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Database {
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Web {
    #[serde(default = "default_listen")]
    pub listen: String,
    /// The built SPA (`web/dist`).
    #[serde(default = "default_static")]
    pub static_dir: PathBuf,
}

impl Default for Web {
    fn default() -> Self {
        Self { listen: default_listen(), static_dir: default_static() }
    }
}

fn default_listen() -> String {
    "127.0.0.1:8080".into()
}
fn default_static() -> PathBuf {
    PathBuf::from("web").join("dist")
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Accounts {
    #[serde(default)]
    pub admin_emails: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Subnet {
    /// The hub's base URL, e.g. `http://127.0.0.1:7070`.
    pub url: String,
    /// This server's principal token on the hub (role operator).
    pub token: String,
    /// Shared secret subnet presents when calling back (approval hook, agent
    /// tools, connector): `Authorization: Bearer <secret>`.
    pub callback_secret: String,
    /// The agent type (or mixture) every conversation runs, as declared in
    /// the cluster file (subnet/chat.hcl).
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
}

fn default_agent_type() -> String {
    "chat".into()
}

/// The layered approval of tool calls (static checks → validator model →
/// the user), run as subnet's `pre_tool` hook.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Approval {
    /// OpenAI-compatible endpoint for the validator model (LiteLLM).
    pub validator_url: Option<String>,
    pub validator_api_key: Option<String>,
    pub validator_model: Option<String>,
    /// Tools that never need approval (exact names, `*` suffix globs).
    #[serde(default = "default_allow")]
    pub allow: Vec<String>,
}

fn default_allow() -> Vec<String> {
    ["chat.*", "connector.list_services", "connector.list_tools"].map(String::from).into()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Chat {
    /// Rolling-hour token budget per user.
    #[serde(default = "default_input_budget")]
    pub hourly_input_tokens: i64,
    #[serde(default = "default_output_budget")]
    pub hourly_output_tokens: i64,
    /// Longest user message, in characters.
    #[serde(default = "default_max_chars")]
    pub max_chars: usize,
}

impl Default for Chat {
    fn default() -> Self {
        Self { hourly_input_tokens: default_input_budget(), hourly_output_tokens: default_output_budget(), max_chars: default_max_chars() }
    }
}

fn default_input_budget() -> i64 {
    100_000
}
fn default_output_budget() -> i64 {
    20_000
}
fn default_max_chars() -> usize {
    2048
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    /// mac-mgmt API base, e.g. `https://mgmt.plan.ai/daemon/`.
    pub url: String,
    pub token: String,
}

static CONFIG: OnceLock<Config> = OnceLock::new();

fn read(path: &str) -> toml::Table {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("reading config {path}: {e}"));
    toml::from_str(&text).unwrap_or_else(|e| panic!("parsing config {path}: {e}"))
}

/// `over` merged into `base`: tables merge key by key, anything else replaces.
fn merge(base: &mut toml::Table, over: toml::Table) {
    for (k, v) in over {
        match (base.get_mut(&k), v) {
            (Some(toml::Value::Table(b)), toml::Value::Table(o)) => merge(b, o),
            (_, v) => {
                base.insert(k, v);
            }
        }
    }
}

/// `CONFIG_PATH` (default `config.toml`), with `CONFIG_SECRETS_PATH` merged
/// over it: secrets stay out of the (world-readable) config, e.g. the Nix store.
pub fn load() -> &'static Config {
    CONFIG.get_or_init(|| {
        let path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.toml".into());
        let mut table = read(&path);
        if let Ok(secrets) = std::env::var("CONFIG_SECRETS_PATH") {
            merge(&mut table, read(&secrets));
        }
        toml::Value::Table(table).try_into().unwrap_or_else(|e| panic!("config {path}: {e}"))
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn example_config_parses() {
        let cfg: super::Config = toml::from_str(include_str!("../../config.example.toml")).unwrap();
        assert_eq!(cfg.subnet.agent_type, "chat");
    }

    #[test]
    fn secrets_merge_into_tables() {
        let mut base: toml::Table = toml::from_str("[a]\nx = 1\ny = 2\n[b]\nz = 3").unwrap();
        super::merge(&mut base, toml::from_str("[a]\ny = 9\n[c]\nw = 4").unwrap());
        assert_eq!(base.to_string(), toml::from_str::<toml::Table>("[a]\nx = 1\ny = 9\n[b]\nz = 3\n[c]\nw = 4").unwrap().to_string());
    }
}
