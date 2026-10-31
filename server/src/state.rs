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
pub async fn init(cfg: &'static Config) -> anyhow::Result<AppState> {
    let pool = PgPool::connect(&cfg.database.url).await?;
    let acc_cfg = plan_ai_accounts::Config { admin_emails: cfg.accounts.admin_emails.clone(), default_plan: "free".into() };
    let accounts = plan_ai_accounts::Accounts::connect(&cfg.database.url, acc_cfg, Arc::new(plan_ai_accounts::NoHooks)).await?;
    // ponytail: one free plan; chat limits are the hourly token budget, not plan quotas.
    let free = plan_ai_accounts::Plan {
        id: "free".into(),
        name: "Free".into(),
        price_cents: 0,
        currency: "EUR".into(),
        window_days: 30,
        limits: Default::default(),
    };
    accounts.ensure_plans(&[free]).await.map_err(|e| anyhow::anyhow!("seeding plans: {e}"))?;
    sqlx::migrate!().run(&pool).await?;
    plan_ai_auth::set_user_resolver(Arc::new(plan_ai_accounts::Resolver(accounts.clone())));

    let hub = Hub::new(&cfg.subnet.url, &cfg.subnet.token);
    let owners = Owners::load(&pool).await?;
    let (events, _) = broadcast::channel(1024);
    tokio::spawn(Pump { hub: hub.clone(), pool: pool.clone(), owners: owners.clone(), tx: events.clone() }.run());
    Ok(Arc::new(App { cfg, pool, accounts, hub, owners, events, http: reqwest::Client::new() }))
}

