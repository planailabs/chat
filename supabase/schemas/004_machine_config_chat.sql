-- Machine config chat: two normalized tables replacing the single JSONB blob.
-- machine_config_state: one row per user (phase + pending question)
-- machine_config_messages: one row per message with ordinals

set search_path = public;

-- ─── State table (1 row per user) ────────────────────────────────────────────

create table public.machine_config_state (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  phase text not null default 'idle'
    check (phase in ('idle', 'waiting_for_answer', 'tool_pending')),
  pending_question jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint machine_config_state_pkey primary key (user_id)
);

comment on table public.machine_config_state is
'Tracks the chat state machine phase per user (idle, waiting_for_answer, tool_pending).';

alter table public.machine_config_state enable row level security;

create trigger machine_config_state_set_updated_at
  before update on public.machine_config_state
  for each row
  execute function public.touch_updated_at();

create policy "Machine config state readable by owner"
  on public.machine_config_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Machine config state insertable by owner"
  on public.machine_config_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Machine config state updatable by owner"
  on public.machine_config_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Machine config state deletable by owner"
  on public.machine_config_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Messages table (1 row per message) ─────────────────────────────────────

create table public.machine_config_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null
    references auth.users (id) on delete cascade,
  role text not null
    check (role in ('user', 'assistant', 'cancel')),
  content text not null,
  content_blocks jsonb,
  ordinal integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint machine_config_messages_pkey primary key (id),
  constraint machine_config_messages_user_ordinal unique (user_id, ordinal)
);

comment on table public.machine_config_messages is
'Individual chat messages for machine configuration conversations.';

create index machine_config_messages_user_ordinal_idx
  on public.machine_config_messages (user_id, ordinal);

alter table public.machine_config_messages enable row level security;

create policy "Machine config messages readable by owner"
  on public.machine_config_messages
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Machine config messages insertable by owner"
  on public.machine_config_messages
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Machine config messages updatable by owner"
  on public.machine_config_messages
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Machine config messages deletable by owner"
  on public.machine_config_messages
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
