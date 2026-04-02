-- Split machine_config_chat (single JSONB blob) into two normalized tables:
--   machine_config_state   — phase + pending question (1 row per user)
--   machine_config_messages — individual messages with ordinals

-- ─── 1. Create new tables ────────────────────────────────────────────────────

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

alter table public.machine_config_state enable row level security;

create trigger machine_config_state_set_updated_at
  before update on public.machine_config_state
  for each row
  execute function public.touch_updated_at();

create policy "Machine config state readable by owner"
  on public.machine_config_state for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Machine config state insertable by owner"
  on public.machine_config_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Machine config state updatable by owner"
  on public.machine_config_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Machine config state deletable by owner"
  on public.machine_config_state for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Grant permissions
grant select, insert, update, delete on table public.machine_config_state to authenticated;
grant select, insert, update, delete on table public.machine_config_state to service_role;

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

create index machine_config_messages_user_ordinal_idx
  on public.machine_config_messages (user_id, ordinal);

alter table public.machine_config_messages enable row level security;

create policy "Machine config messages readable by owner"
  on public.machine_config_messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Machine config messages insertable by owner"
  on public.machine_config_messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Machine config messages updatable by owner"
  on public.machine_config_messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Machine config messages deletable by owner"
  on public.machine_config_messages for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Grant permissions
grant select, insert, update, delete on table public.machine_config_messages to authenticated;
grant select, insert, update, delete on table public.machine_config_messages to service_role;

-- ─── 2. Migrate data from old table ─────────────────────────────────────────

-- 2a. State rows
INSERT INTO machine_config_state (user_id, phase, pending_question, created_at, updated_at)
SELECT
  c.user_id,
  COALESCE(c.messages->>'phase', 'idle'),
  c.messages->'pendingQuestion',
  c.created_at,
  c.updated_at
FROM machine_config_chat c
WHERE c.messages IS NOT NULL AND c.messages->>'v' = '1';

-- 2b. Message rows (unnest JSONB array with ordinality)
INSERT INTO machine_config_messages (user_id, role, content, content_blocks, ordinal)
SELECT
  c.user_id,
  (msg->>'role')::text,
  CASE
    WHEN msg->>'role' = 'assistant' THEN COALESCE((
      SELECT string_agg(block->>'text', E'\n\n')
      FROM jsonb_array_elements(msg->'content') AS block
      WHERE block->>'type' = 'text'
    ), '')
    WHEN jsonb_typeof(msg->'content') = 'string' THEN msg->>'content'
    ELSE ''
  END,
  CASE
    WHEN jsonb_typeof(msg->'content') = 'array' THEN msg->'content'
    ELSE NULL
  END,
  (idx - 1)::integer
FROM machine_config_chat c,
LATERAL jsonb_array_elements(c.messages->'messages') WITH ORDINALITY AS arr(msg, idx)
WHERE c.messages IS NOT NULL AND c.messages->>'v' = '1';

-- ─── 3. Drop old table ──────────────────────────────────────────────────────

DROP TABLE public.machine_config_chat;
