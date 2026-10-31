//! `config.toml` (path in `CONFIG_PATH`, default `config.toml`).

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
    /// Agent type per chat mode, as declared in the cluster file.
    #[serde(default = "default_types")]
    pub types: std::collections::BTreeMap<String, String>,
}

fn default_types() -> std::collections::BTreeMap<String, String> {
    [("sales", "chat-sales"), ("machine_config", "chat-machine-config")].map(|(k, v)| (k.to_string(), v.to_string())).into()
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

pub fn load() -> &'static Config {
    CONFIG.get_or_init(|| {
        let path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.toml".into());
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading config {path}: {e}"));
        toml::from_str(&text).unwrap_or_else(|e| panic!("parsing config {path}: {e}"))
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn example_config_parses() {
        let cfg: super::Config = toml::from_str(include_str!("../../config.example.toml")).unwrap();
        assert_eq!(cfg.subnet.types["sales"], "chat-sales");
    }
}
