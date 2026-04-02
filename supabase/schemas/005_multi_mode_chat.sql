-- Multi-mode chat: generic tables for sales + newsletter modes, plus token tracking.
-- Machine config tables (machine_config_state, machine_config_messages) remain untouched.

set search_path = public;

-- ─── Generic chat state (1 row per user per mode) ──────────────────────────

create table public.chat_state (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  mode text not null,
  phase text not null default 'idle'
    check (phase in ('idle', 'waiting_for_answer', 'tool_pending')),
  pending_question jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint chat_state_pkey primary key (user_id, mode)
);

comment on table public.chat_state is
'Tracks the chat state machine phase per user per mode (idle, waiting_for_answer, tool_pending).';

alter table public.chat_state enable row level security;

create trigger chat_state_set_updated_at
  before update on public.chat_state
  for each row
  execute function public.touch_updated_at();

create policy "Chat state readable by owner"
  on public.chat_state for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Chat state insertable by owner"
  on public.chat_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Chat state updatable by owner"
  on public.chat_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Chat state deletable by owner"
  on public.chat_state for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Generic chat messages (1 row per message per mode) ────────────────────

create table public.chat_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null
    references auth.users (id) on delete cascade,
  mode text not null,
  role text not null
    check (role in ('user', 'assistant', 'cancel')),
  content text not null,
  content_blocks jsonb,
  ordinal integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_messages_pkey primary key (id),
  constraint chat_messages_user_mode_ordinal unique (user_id, mode, ordinal)
);

comment on table public.chat_messages is
'Individual chat messages for multi-mode conversations (sales, newsletter, etc.).';

create index chat_messages_user_mode_ordinal_idx
  on public.chat_messages (user_id, mode, ordinal);

alter table public.chat_messages enable row level security;

create policy "Chat messages readable by owner"
  on public.chat_messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Chat messages insertable by owner"
  on public.chat_messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Chat messages updatable by owner"
  on public.chat_messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Chat messages deletable by owner"
  on public.chat_messages for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Token usage tracking (all modes) ──────────────────────────────────────

create table public.chat_token_usage (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null
    references auth.users (id) on delete cascade,
  mode text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chat_token_usage_pkey primary key (id)
);

comment on table public.chat_token_usage is
'Per-turn token usage for rate limiting across all chat modes.';

create index chat_token_usage_user_time_idx
  on public.chat_token_usage (user_id, created_at);

alter table public.chat_token_usage enable row level security;

-- Token usage is written by service role only (from the handler).
-- Users can read their own usage for transparency.
create policy "Token usage readable by owner"
  on public.chat_token_usage for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Data migration: copy existing machine_config data into generic tables ──
-- This allows the system to eventually unify on the generic tables.
-- The old machine_config_state / machine_config_messages tables remain active
-- for backwards compatibility; this copies data so the new generic queries
-- can find it too. Run only once.

-- ─── Data migration: move existing machine_config data into generic tables ───
-- Copies data then drops old tables to prevent desync.

insert into public.chat_state (user_id, mode, phase, pending_question, created_at, updated_at)
select user_id, 'machine_config', phase, pending_question, created_at, updated_at
from public.machine_config_state
on conflict (user_id, mode) do nothing;

insert into public.chat_messages (id, user_id, mode, role, content, content_blocks, ordinal, created_at)
select id, user_id, 'machine_config', role, content, content_blocks, ordinal, created_at
from public.machine_config_messages
on conflict (id) do nothing;

-- Drop old dedicated tables (all data now lives in generic tables)
drop table if exists public.machine_config_messages;
drop table if exists public.machine_config_state;
