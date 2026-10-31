//! The connector (plan-ai-connector), mounted at `/connector/mcp`: subnet's
//! `connector` MCP server. Agents run with our user id as tenant; Zitadel
//! knows the user by the subject recorded at sign-in (`profiles.subject`).
//! A user's services: the configured ones plus their plan-ai-cloud
//! deployments, which the console lists for them.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use plan_ai_connector::{Connector, SourceError, SubjectResolver, Target, TargetSource, TokenExchanger};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::{Config, Console};

#[derive(Clone)]
struct ProfileSubjects(PgPool);

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
    fixed: Vec<Target>,
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
        let mut out = self.fixed.clone();
        for t in self.deployments(tenant).await? {
            if !out.iter().any(|f| f.name == t.name) {
                out.push(t);
            }
        }
        Ok(out)
    }
}

pub fn build(cfg: &'static Config, pool: PgPool) -> anyhow::Result<Option<(Connector, Arc<dyn TargetSource>)>> {
    let Some(c) = &cfg.connector else { return Ok(None) };
    let http = reqwest::Client::new();
    let exchanger = Arc::new(TokenExchanger::new(http.clone(), c.exchange.clone()));
    let subjects = ProfileSubjects(pool);
    let targets: Arc<dyn TargetSource> = Arc::new(Targets {
        fixed: c.targets.clone(),
        console: c.console.as_ref().map(|console| (console, exchanger.clone(), subjects.clone(), http)),
        cache: Mutex::new(HashMap::new()),
    });
    let connector = Connector::builder()
        .secret(&cfg.subnet.callback_secret)
        .exchanger(exchanger)
        .targets(targets.clone())
        .subjects(Arc::new(subjects))
        .build()
        .map_err(|e| anyhow::anyhow!("connector: {e}"))?;
    Ok(Some((connector, targets)))
}
