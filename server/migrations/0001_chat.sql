-- The chat app's own tables. Users live in plan-ai-accounts (`accounts.users`);
-- conversations live in subagent-net, mirrored here for history, export and
-- the admin dashboard.

create table profiles (
    user_id uuid primary key references accounts.users (id) on delete cascade,
    -- Zitadel subject (`sub`): whom the connector acts for. Agents run with
    -- the user id as their tenant; the connector maps it to this.
    subject text unique,
    language text not null default 'en' check (language in ('en', 'de')),
    theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
    newsletter_opt_in boolean not null default false,
    deletion_requested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table newsletter_events (
    id bigserial primary key,
    user_id uuid not null references accounts.users (id) on delete cascade,
    status text not null check (status in ('subscribed', 'unsubscribed')),
    source text not null check (source in ('chat_flow', 'settings')),
    created_at timestamptz not null default now()
);

create table data_export_events (
    id bigserial primary key,
    user_id uuid not null references accounts.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

-- One subagent-net agent per user and mode: the conversation.
create table chat_agents (
    user_id uuid not null references accounts.users (id) on delete cascade,
    mode text not null,
    agent_id text not null unique,
    -- "Approve all for this conversation": the approval hook skips the human layer.
    auto_approve boolean not null default false,
    created_at timestamptz not null default now(),
    primary key (user_id, mode)
);

-- Mirror of the agent's event log, keyed by (agent, seq) so replays and
-- several server instances insert each event once.
create table chat_messages (
    id bigserial primary key,
    agent_id text not null,
    seq bigint not null,
    user_id uuid not null references accounts.users (id) on delete cascade,
    mode text not null,
    role text not null check (role in ('user', 'assistant', 'question', 'answer', 'tool', 'approval')),
    content text not null,
    data jsonb,
    created_at timestamptz not null default now(),
    unique (agent_id, seq)
);
create index chat_messages_user on chat_messages (user_id, mode, id);
create index chat_messages_created on chat_messages (created_at);

create table chat_token_usage (
    agent_id text not null,
    seq bigint not null,
    user_id uuid not null references accounts.users (id) on delete cascade,
    mode text not null,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    cached_tokens bigint not null default 0,
    created_at timestamptz not null default now(),
    primary key (agent_id, seq)
);
create index chat_token_usage_user on chat_token_usage (user_id, created_at);

create table staff_pings (
    id bigserial primary key,
    user_id uuid not null references accounts.users (id) on delete cascade,
    reason text not null check (reason in ('demo_request', 'callback_request', 'support_escalation', 'other')),
    message text not null,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
);

create table system_prompt_extensions (
    user_id uuid not null references accounts.users (id) on delete cascade,
    mode text not null,
    content text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, mode)
);
