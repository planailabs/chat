use std::sync::Arc;

use sqlx::PgPool;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::subnet::{BrowserEvent, Hub, Owners, Pump};

pub struct App {
    pub cfg: &'static Config,
    pub pool: PgPool,
    pub accounts: Arc<plan_ai_accounts::Accounts>,
    pub hub: Hub,
    pub owners: Owners,
    pub events: broadcast::Sender<BrowserEvent>,
    pub http: reqwest::Client,
}

pub type AppState = Arc<App>;

/// Connects and migrates (accounts first: our tables reference its users),
/// then starts following the hub.
pub async fn init(cfg: &'static Config) -> anyhow::Result<(AppState, Option<plan_ai_connector::Connector>)> {
    let pool = PgPool::connect(&cfg.database.url).await?;
    let acc_cfg = plan_ai_accounts::Config { admin_emails: cfg.accounts.admin_emails.clone(), default_plan: cfg.accounts.default_plan.clone() };
    let accounts = plan_ai_accounts::Accounts::connect(&cfg.database.url, acc_cfg, Arc::new(plan_ai_accounts::NoHooks)).await?;
    accounts.ensure_plans(&cfg.accounts.plans).await.map_err(|e| anyhow::anyhow!("seeding plans: {e}"))?;
    move_off_unlimited_free(&accounts, &cfg.accounts.default_plan).await?;
    sqlx::migrate!().run(&pool).await?;
    plan_ai_auth::set_user_resolver(Arc::new(plan_ai_accounts::Resolver(accounts.clone())));

    let hub = Hub::new(&cfg.subnet.url, &cfg.subnet.token);
    let owners = Owners::load(&pool).await?;
    let (events, _) = broadcast::channel(1024);
    tokio::spawn(Pump { hub: hub.clone(), pool: pool.clone(), owners: owners.clone(), tx: events.clone() }.run());
    let connector = crate::connector::build(cfg, pool.clone())?;
    Ok((Arc::new(App { cfg, pool, accounts, hub, owners, events, http: reqwest::Client::new() }), connector))
}

/// The first versions put every user on a limitless "free" plan; budgets come
/// from plans now. Teams still on it move to the default plan, through
/// accounts (so their subscription history stays right; no charges at price 0).
async fn move_off_unlimited_free(accounts: &plan_ai_accounts::Accounts, default_plan: &str) -> anyhow::Result<()> {
    if default_plan == "free" {
        return Ok(());
    }
    for team in accounts.all_teams().await.map_err(|e| anyhow::anyhow!("listing teams: {e}"))? {
        if team.plan_id == "free" {
            accounts.assign_plan(team.id, default_plan, team.owner_id).await.map_err(|e| anyhow::anyhow!("moving team {} to {default_plan}: {e}", team.id))?;
            tracing::info!(team = %team.id, plan = default_plan, "moved off the limitless free plan");
        }
    }
    Ok(())
}
