-- Machine config chat: stores the full conversation per user as JSONB.
-- One row per user; upserted on each exchange.

set search_path = public;

create table public.machine_config_chat (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint machine_config_chat_pkey primary key (user_id)
);

comment on table public.machine_config_chat is
'Persists the Claude-powered machine configuration conversation per user.';

alter table public.machine_config_chat enable row level security;

create trigger machine_config_chat_set_updated_at
  before update on public.machine_config_chat
  for each row
  execute function public.touch_updated_at();

create policy "Machine config chat readable by owner"
  on public.machine_config_chat
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Machine config chat insertable by owner"
  on public.machine_config_chat
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Machine config chat updatable by owner"
  on public.machine_config_chat
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Machine config chat deletable by owner"
  on public.machine_config_chat
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
