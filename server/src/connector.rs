//! The connector (plan-ai-connector), mounted at `/connector/mcp`: subnet's
//! `connector` MCP server. Agents run with our user id as tenant; Zitadel
//! knows the user by the subject recorded at sign-in (`profiles.subject`).
//! A user's services: the configured ones, their plan-ai-cloud deployments
//! (which the console lists for them), and the connectors of their teams
//! (`connectors`; their names never shadow the first two).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use plan_ai_connector::{Connector, SourceError, SubjectResolver, Target, TargetSource, TokenExchanger};
use crate::connectors::Connectors;
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::{Config, Console};

#[derive(Clone)]
pub struct ProfileSubjects(pub PgPool);

#[async_trait::async_trait]
impl SubjectResolver for ProfileSubjects {
    async fn subject(&self, tenant: &str) -> Result<String, SourceError> {
        let user: Uuid = tenant.parse()?;
        let sub: Option<Option<String>> = sqlx::query_scalar("SELECT subject FROM profiles WHERE user_id = $1").bind(user).fetch_optional(&self.0).await?;
        sub.flatten().ok_or_else(|| format!("user {tenant} hasn't signed in through Zitadel yet").into())
    }
}

/// The connector calls `targets` on every tool call; deployments change rarely.
const CACHE_FOR: Duration = Duration::from_secs(60);

struct Targets {
    fixed: &'static [crate::config::App],
    secrets: &'static crate::config::Secrets,
    connectors: Option<Arc<Connectors>>,
    pool: PgPool,
    console: Option<(&'static Console, Arc<TokenExchanger>, ProfileSubjects, reqwest::Client)>,
    cache: Mutex<HashMap<String, (Instant, Vec<Target>)>>,
}

impl Targets {
    async fn deployments(&self, tenant: &str) -> Result<Vec<Target>, SourceError> {
        let Some((console, exchanger, subjects, http)) = &self.console else { return Ok(vec![]) };
        if let Some((at, list)) = self.cache.lock().expect("cache lock").get(tenant)
            && at.elapsed() < CACHE_FOR
        {
            return Ok(list.clone());
        }
        let subject = subjects.subject(tenant).await?;
        let token = exchanger.token_for(&subject, &console.audience_project_id).await?;
        let url = format!("{}/api/v1/connector_targets", console.url.trim_end_matches('/'));
        let res = http.get(&url).bearer_auth(token).send().await?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("{url}: {status}: {}", res.text().await.unwrap_or_default()).into());
        }
        let list: Vec<Target> = res.json().await?;
        self.cache.lock().expect("cache lock").insert(tenant.to_string(), (Instant::now(), list.clone()));
        Ok(list)
    }
}

#[async_trait::async_trait]
impl TargetSource for Targets {
    async fn targets(&self, tenant: &str) -> Result<Vec<Target>, SourceError> {
        // Services limited to some emails are invisible (and uncallable) to the rest.
        let email = if self.fixed.iter().any(|a| a.mcp.is_some() && !a.emails.is_open()) || self.connectors.is_some() {
            let user: Uuid = tenant.parse()?;
            sqlx::query_scalar::<_, String>("SELECT email FROM accounts.users WHERE id = $1").bind(user).fetch_one(&self.pool).await?
        } else {
            String::new()
        };
        let mut out: Vec<Target> = self.fixed.iter().filter(|a| a.emails.admit(&email)).filter_map(|a| a.target(self.secrets)).collect();
        for t in self.deployments(tenant).await? {
            if !out.iter().any(|f| f.name == t.name) && !self.fixed.iter().any(|f| f.name == t.name) {
                out.push(t);
            }
        }
        if let Some(c) = &self.connectors {
            let taken: std::collections::HashSet<String> = out.iter().map(|t| t.name.clone()).chain(self.fixed.iter().map(|a| a.name.clone())).collect();
            let user: Uuid = tenant.parse()?;
            out.extend(c.targets(user, &taken).await.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}

/// The connector, and the purchase checks that call the console as the user
/// with the same token exchanger. Without `[connector]` there is no token
/// exchange: Zitadel apps can't be reached, the others (bearer, OAuth, none,
/// user connectors) still can.
pub fn build(cfg: &'static Config, pool: PgPool, connectors: Option<Arc<Connectors>>) -> anyhow::Result<(Option<Connector>, Option<crate::purchase::Purchases>)> {
    let http = reqwest::Client::new();
    let subjects = ProfileSubjects(pool.clone());
    let exchanger = cfg.connector.as_ref().map(|c| Arc::new(TokenExchanger::new(http.clone(), c.exchange.clone())));
    let purchases = exchanger.as_ref().and_then(|x| crate::purchase::Purchases::build(cfg, x.clone(), subjects.clone(), http.clone()));
    if exchanger.is_none() && connectors.is_none() && !cfg.apps.iter().any(|a| a.mcp.is_some()) {
        return Ok((None, None));
    }
    let console = match (&cfg.connector, &exchanger) {
        (Some(c), Some(x)) => c.console.as_ref().map(|console| (console, x.clone(), subjects.clone(), http)),
        _ => None,
    };
    let targets: Arc<dyn TargetSource> = Arc::new(Targets {
        fixed: &cfg.apps,
        secrets: &cfg.secrets,
        connectors: connectors.clone(),
        pool,
        console,
        cache: Mutex::new(HashMap::new()),
    });
    let mut builder = Connector::builder().secret(&cfg.subnet.callback_secret).targets(targets);
    if let Some(x) = exchanger {
        builder = builder.exchanger(x).subjects(Arc::new(subjects));
    }
    if let Some(c) = connectors {
        builder = builder.tokens(Arc::new(crate::connectors::oauth::Tokens(c.clone()))).public_guard(c.guard);
    }
    let connector = builder.build().map_err(|e| anyhow::anyhow!("connector: {e}"))?;
    Ok((Some(connector), purchases))
}
