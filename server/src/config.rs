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
    /// plan.ai applications: the sidebar's links and the assistant's services,
    /// each shown to the emails it names.
    #[serde(default)]
    pub apps: Vec<App>,
    /// Secrets, best kept in the secrets file (`CONFIG_SECRETS_PATH`).
    #[serde(default)]
    pub secrets: Secrets,
}

/// `[secrets]`: kept out of the config proper (it can end up in the Nix
/// store); put this section in the file `CONFIG_SECRETS_PATH` names.
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Secrets {
    /// 32 random bytes, base64 (`openssl rand -base64 32`): encrypts what
    /// connectors store (bearer tokens, OAuth tokens and client secrets).
    /// Without it users can't add connectors, and OAuth apps can't start.
    pub connector_encryption_key: Option<String>,
    /// The token of each `[[apps]]` entry with `mcp.auth = "bearer"`, by
    /// the app's name.
    #[serde(default)]
    pub app_tokens: std::collections::BTreeMap<String, String>,
}

impl std::fmt::Debug for Secrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Secrets")
            .field("connector_encryption_key", &self.connector_encryption_key.as_ref().map(|_| "<set>"))
            .field("app_tokens", &self.app_tokens.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Secrets {
    /// The connector encryption key, if set and valid.
    pub fn connector_key(&self) -> Result<Option<[u8; 32]>, String> {
        use base64::Engine;
        let Some(k) = &self.connector_encryption_key else { return Ok(None) };
        let bytes = base64::engine::general_purpose::STANDARD.decode(k.trim()).map_err(|e| format!("[secrets].connector_encryption_key is not base64: {e}"))?;
        <[u8; 32]>::try_from(bytes.as_slice())
            .map(Some)
            .map_err(|_| format!("[secrets].connector_encryption_key must be 32 bytes (base64 of `openssl rand -base64 32`), not {}", bytes.len()))
    }
}

impl Config {
    /// What serde can't check: every bearer app has its token, OAuth apps
    /// have the encryption key, app names are unique and fit the assistant.
    pub fn check(&self) -> Result<(), String> {
        let key = self.secrets.connector_key()?;
        let mut names = std::collections::HashSet::new();
        for a in &self.apps {
            if !names.insert(a.name.as_str()) {
                return Err(format!("[[apps]] {:?} is listed twice", a.name));
            }
            let Some(mcp) = &a.mcp else { continue };
            if a.name.contains(['.', '/']) {
                return Err(format!("[[apps]] {:?}: a name with an MCP endpoint can't contain '.' or '/'", a.name));
            }
            match mcp.auth {
                AppAuth::Bearer if !self.secrets.app_tokens.get(&a.name).is_some_and(|t| !t.trim().is_empty()) => {
                    return Err(format!("[[apps]] {:?} has mcp.auth = \"bearer\" but no token: set [secrets.app_tokens] {} = \"…\" in the secrets file", a.name, a.name));
                }
                AppAuth::Oauth if key.is_none() => {
                    return Err(format!("[[apps]] {:?} has mcp.auth = \"oauth\", which needs [secrets].connector_encryption_key", a.name));
                }
                _ => {}
            }
        }
        for name in self.secrets.app_tokens.keys() {
            if !self.apps.iter().any(|a| &a.name == name && a.mcp.as_ref().is_some_and(|m| m.auth == AppAuth::Bearer)) {
                return Err(format!("[secrets.app_tokens] {name:?}: no [[apps]] entry of that name with mcp.auth = \"bearer\""));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Connector {
    /// Zitadel token exchange: the exchange app and the impersonating service account.
    pub exchange: plan_ai_connector::ExchangeConfig,
    /// plan-ai-cloud's console: lists each user's deployments
    /// (`GET /api/v1/connector_targets`, called as the user).
    pub console: Option<Console>,
}

/// Who sees something: email patterns (`*@plan.ai`, `ops-*@example.com`,
/// case-insensitive). Empty: everyone.
#[derive(Debug, Default)]
pub struct EmailPatterns(Vec<glob::Pattern>);

impl EmailPatterns {
    pub fn admit(&self, email: &str) -> bool {
        let opts = glob::MatchOptions { case_sensitive: false, ..Default::default() };
        self.0.is_empty() || self.0.iter().any(|p| p.matches_with(email, opts))
    }

    pub fn is_open(&self) -> bool {
        self.0.is_empty()
    }
}

impl<'de> Deserialize<'de> for EmailPatterns {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Vec::<String>::deserialize(d)?
            .iter()
            .map(|p| glob::Pattern::new(p).map_err(|e| serde::de::Error::custom(format!("email pattern {p:?}: {e}"))))
            .collect::<Result<_, _>>()
            .map(EmailPatterns)
    }
}

/// A plan.ai application: linked from the sidebar (`url`) and/or reachable by
/// the assistant as the user (`mcp`, through the connector) — one entry, one
/// access rule. Nobody outside `emails` sees it in either place or can call it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct App {
    /// Unique; the service name the assistant passes.
    pub name: String,
    /// One line: what it is for (the assistant reads it; the sidebar's tooltip).
    pub description: String,
    /// Kind of service, e.g. `mac-mgmt`, `plan-ai-cloud`.
    pub kind: String,
    /// The web application, linked from the sidebar. None: not in the sidebar.
    pub url: Option<String>,
    /// The web's icon name (`cloud`, `agency`, `machine`, `vpn`, `server`, `chart`; else a globe).
    pub icon: Option<String>,
    /// Sidebar label per language (`en`, `de`); `en`, then `name` are the fallback.
    #[serde(default)]
    pub label: std::collections::BTreeMap<String, String>,
    /// Its MCP endpoint. None: the assistant can't act on it. Independent of
    /// `url`: an app can be a sidebar link, a service, or both.
    pub mcp: Option<AppMcp>,
    #[serde(default)]
    pub emails: EmailPatterns,
}

/// How the connector authenticates to an app's MCP endpoint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppAuth {
    /// Zitadel token exchange as the user (plan.ai's own services); needs
    /// `audience_project_id`.
    #[default]
    Zitadel,
    /// A static token: `[secrets.app_tokens] <name> = "…"`.
    Bearer,
    /// MCP OAuth (discovery, dynamic client registration); each user
    /// connects their own account in Settings → Connectors.
    Oauth,
    /// No auth (trusted internal servers).
    None,
}

/// `mcp = { url, audience_project_id }` (Zitadel), or `mcp = { url, auth =
/// "bearer" | "oauth" | "none" }`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, try_from = "AppMcpRaw")]
pub struct AppMcp {
    /// Streamable HTTP, e.g. `https://mgmt.plan.ai/mcp`.
    pub url: String,
    pub auth: AppAuth,
    /// The Zitadel project the service introspects tokens for (`zitadel` only).
    pub audience_project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppMcpRaw {
    url: String,
    #[serde(default)]
    auth: AppAuth,
    audience_project_id: Option<String>,
}

impl TryFrom<AppMcpRaw> for AppMcp {
    type Error = String;

    fn try_from(r: AppMcpRaw) -> Result<Self, String> {
        match (r.auth, &r.audience_project_id) {
            (AppAuth::Zitadel, None) => Err("mcp: auth = \"zitadel\" (the default) needs audience_project_id".into()),
            (AppAuth::Bearer | AppAuth::Oauth | AppAuth::None, Some(_)) => Err("mcp: audience_project_id is only for auth = \"zitadel\"".into()),
            _ => Ok(AppMcp { url: r.url, auth: r.auth, audience_project_id: r.audience_project_id }),
        }
    }
}

impl App {
    /// As the connector's service, if it has one. Bearer tokens come from
    /// `[secrets.app_tokens]`.
    pub fn target(&self, secrets: &Secrets) -> Option<plan_ai_connector::Target> {
        use plan_ai_connector::TargetAuth;
        let mcp = self.mcp.as_ref()?;
        let auth = match mcp.auth {
            AppAuth::Zitadel => TargetAuth::Zitadel { audience_project_id: mcp.audience_project_id.clone()? },
            AppAuth::Bearer => TargetAuth::Bearer { token: secrets.app_tokens.get(&self.name)?.trim().to_owned() },
            AppAuth::Oauth => TargetAuth::Oauth { connection: format!("app:{}", self.name) },
            AppAuth::None => TargetAuth::None,
        };
        Some(plan_ai_connector::Target {
            name: self.name.clone(),
            description: self.description.clone(),
            kind: self.kind.clone(),
            mcp_url: mcp.url.clone(),
            auth,
            // The operator's own: exempt from the public-address rule.
            public_only: false,
        })
    }
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Accounts {
    #[serde(default)]
    pub admin_emails: Vec<String>,
    /// The plan users start on (their personal team's).
    #[serde(default = "default_plan")]
    pub default_plan: String,
    /// Plans created at start unless they exist (later edits are admins',
    /// on the dashboard). No charges: price 0, assigned only by admins.
    /// Limits: `hourly_input_tokens`, `hourly_output_tokens` (0 = unlimited).
    #[serde(default = "default_plans")]
    pub plans: Vec<plan_ai_accounts::Plan>,
}

impl Default for Accounts {
    fn default() -> Self {
        Self { admin_emails: vec![], default_plan: default_plan(), plans: default_plans() }
    }
}

fn default_plan() -> String {
    "standard".into()
}

fn default_plans() -> Vec<plan_ai_accounts::Plan> {
    let plan = |id: &str, name: &str, input: u64, output: u64| plan_ai_accounts::Plan {
        id: id.into(),
        name: name.into(),
        price_cents: 0,
        currency: "EUR".into(),
        window_days: 30,
        limits: [(HOURLY_INPUT.to_string(), input), (HOURLY_OUTPUT.to_string(), output)].into(),
    };
    vec![plan("standard", "Standard", 1_000_000, 200_000), plan("pro", "Pro", 10_000_000, 2_000_000)]
}

/// Plan limit dimensions: tokens per user per rolling hour.
pub const HOURLY_INPUT: &str = "hourly_input_tokens";
pub const HOURLY_OUTPUT: &str = "hourly_output_tokens";

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
    /// Calls that always need the user (`service.tool` of a connector call,
    /// or a tool name; `*` suffix globs): e.g. starting another agent that has
    /// a shell. Neither the allow-list, the validator, "approve all" nor a
    /// page lets them through, and sub-agents may not make them at all.
    #[serde(default)]
    pub always_ask: Vec<String>,
}

fn default_allow() -> Vec<String> {
    ["chat.*", "connector.list_services", "connector.list_tools"].map(String::from).into()
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Chat {
    /// Longest user message, in characters. (Token budgets are per plan:
    /// `[accounts].plans`.)
    #[serde(default = "default_max_chars")]
    pub max_chars: usize,
}

impl Default for Chat {
    fn default() -> Self {
        Self { max_chars: default_max_chars() }
    }
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
        let cfg: Config = toml::Value::Table(table).try_into().unwrap_or_else(|e| panic!("config {path}: {e}"));
        cfg.check().unwrap_or_else(|e| panic!("config {path}: {e}"));
        cfg
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_app_is_visible_to_the_emails_it_names() {
        let app = |extra: &str| toml::from_str::<super::App>(&format!("name = \"redream\"\ndescription = \"d\"\nkind = \"redream\"\n{extra}"));
        let staff = app("emails = [\"*@plan.ai\", \"guest@example.com\"]").unwrap().emails;
        assert!(staff.admit("ada@plan.ai"));
        assert!(staff.admit("Ada@PLAN.ai"));
        assert!(staff.admit("guest@example.com"));
        assert!(!staff.admit("eve@elsewhere.com"));
        assert!(!staff.admit("eve@plan.ai.evil.com"));
        assert!(app("").unwrap().emails.admit("anyone@anywhere"));
        // A misspelt key must not silently open an app to everyone.
        assert!(app("email = [\"*@plan.ai\"]").is_err());
        assert!(app("emails = [\"[\"]").is_err());
        // The connector's service only where there is an MCP endpoint, given whole.
        let none = super::Secrets::default();
        assert!(app("url = \"https://redream.plan.ai\"").unwrap().target(&none).is_none());
        let t = app("mcp = { url = \"https://r/mcp\", audience_project_id = \"1\" }").unwrap().target(&none).unwrap();
        assert_eq!((t.name.as_str(), t.mcp_url.as_str(), t.audience_project_id()), ("redream", "https://r/mcp", Some("1")));
        assert!(app("mcp = { url = \"https://r/mcp\" }").is_err());
        assert!(app("mcp = { url = \"https://r/mcp\", auth = \"bearer\", audience_project_id = \"1\" }").is_err());
        assert!(app("mcp = { url = \"https://r/mcp\", auth = \"basic\" }").is_err());
        let t = app("mcp = { url = \"https://r/mcp\", auth = \"none\" }").unwrap().target(&none).unwrap();
        assert_eq!(t.auth, plan_ai_connector::TargetAuth::None);
        let t = app("mcp = { url = \"https://r/mcp\", auth = \"oauth\" }").unwrap().target(&none).unwrap();
        assert_eq!(t.auth, plan_ai_connector::TargetAuth::Oauth { connection: "app:redream".into() });
    }

    /// The owner's case: one entry that is a sidebar link and a bearer
    /// service, the token in the secrets file.
    #[test]
    fn a_bearer_app_is_a_sidebar_link_and_a_service() {
        let config = r#"
            [database]
            url = "postgres://x"
            [subnet]
            url = "http://hub"
            token = "t"
            callback_secret = "s"
            [approval]

            [[apps]]
            name = "prometheus"
            description = "Prometheus metrics of plan.ai's infrastructure"
            kind = "prometheus"
            url = "https://prometheus.plan.ai"
            icon = "chart"
            label = { en = "Metrics", de = "Metriken" }
            mcp = { url = "https://prometheus-mcp.plan.ai/mcp", auth = "bearer" }
            emails = ["*@plan.ai"]
        "#;
        let mut table: toml::Table = toml::from_str(config).unwrap();
        let without: super::Config = toml::Value::Table(table.clone()).try_into().unwrap();
        assert!(without.check().unwrap_err().contains("[secrets.app_tokens] prometheus"));
        super::merge(&mut table, toml::from_str("[secrets.app_tokens]\nprometheus = \"prom-token\"\n").unwrap());
        let cfg: super::Config = toml::Value::Table(table).try_into().unwrap();
        cfg.check().unwrap();
        let app = &cfg.apps[0];
        assert_eq!((app.url.as_deref(), app.icon.as_deref(), app.label["de"].as_str()), (Some("https://prometheus.plan.ai"), Some("chart"), "Metriken"));
        assert!(app.emails.admit("ops@plan.ai") && !app.emails.admit("eve@example.com"));
        let t = app.target(&cfg.secrets).unwrap();
        assert_eq!(t.mcp_url, "https://prometheus-mcp.plan.ai/mcp");
        assert_eq!(t.auth, plan_ai_connector::TargetAuth::Bearer { token: "prom-token".into() });
        assert!(!format!("{cfg:?}").contains("prom-token"), "secrets stay out of debug output");
    }

    #[test]
    fn the_encryption_key_is_32_bytes_of_base64() {
        let s = |k: &str| super::Secrets { connector_encryption_key: Some(k.into()), ..Default::default() };
        assert!(s("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=").connector_key().unwrap().is_some());
        assert!(s("c2hvcnQ=").connector_key().is_err());
        assert!(s("not base64!").connector_key().is_err());
        assert!(super::Secrets::default().connector_key().unwrap().is_none());
    }

    #[test]
    fn example_config_parses() {
        let mut table: toml::Table = toml::from_str(include_str!("../../config.example.toml")).unwrap();
        // The example's bearer app takes its token from the secrets file.
        super::merge(&mut table, toml::from_str("[secrets.app_tokens]\nprometheus = \"t\"\n").unwrap());
        let cfg: super::Config = toml::Value::Table(table).try_into().unwrap();
        assert_eq!(cfg.subnet.agent_type, "chat");
        cfg.check().unwrap();
    }

    #[test]
    fn secrets_merge_into_tables() {
        let mut base: toml::Table = toml::from_str("[a]\nx = 1\ny = 2\n[b]\nz = 3").unwrap();
        super::merge(&mut base, toml::from_str("[a]\ny = 9\n[c]\nw = 4").unwrap());
        assert_eq!(base.to_string(), toml::from_str::<toml::Table>("[a]\nx = 1\ny = 9\n[b]\nz = 3\n[c]\nw = 4").unwrap().to_string());
    }
}
