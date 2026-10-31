//! The connector (plan-ai-connector), mounted at `/connector/mcp`: subnet's
//! `connector` MCP server. Agents run with our user id as tenant; Zitadel
//! knows the user by the subject recorded at sign-in (`profiles.subject`).

use std::sync::Arc;

use plan_ai_connector::{Connector, SourceError, StaticTargets, SubjectResolver, TargetSource};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;

struct ProfileSubjects(PgPool);

#[async_trait::async_trait]
impl SubjectResolver for ProfileSubjects {
    async fn subject(&self, tenant: &str) -> Result<String, SourceError> {
        let user: Uuid = tenant.parse()?;
        let sub: Option<Option<String>> = sqlx::query_scalar("SELECT subject FROM profiles WHERE user_id = $1").bind(user).fetch_optional(&self.0).await?;
        sub.flatten().ok_or_else(|| format!("user {tenant} hasn't signed in through Zitadel yet").into())
    }
}

pub fn build(cfg: &'static Config, pool: PgPool) -> anyhow::Result<Option<(Connector, Arc<dyn TargetSource>)>> {
    let Some(c) = &cfg.connector else { return Ok(None) };
    let targets: Arc<dyn TargetSource> = Arc::new(StaticTargets::new(c.targets.clone()));
    let connector = Connector::builder()
        .secret(&cfg.subnet.callback_secret)
        .exchange(c.exchange.clone())
        .targets(targets.clone())
        .subjects(Arc::new(ProfileSubjects(pool)))
        .build()
        .map_err(|e| anyhow::anyhow!("connector: {e}"))?;
    Ok(Some((connector, targets)))
}
