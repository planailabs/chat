-- Plan.ai core data model (profiles, messages, newsletter_events, data_export_events)
-- Follows declarative schema workflow; tables are created in lexicographic order.

set search_path = public;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

comment on function public.touch_updated_at is
'Keeps updated_at in sync with the current UTC timestamp before update operations.';

create table public.profiles (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  language text not null default 'en'
    constraint profiles_language_valid check (language in ('en', 'de')),
  newsletter_opt_in boolean not null default false,
  theme_preference text not null default 'system'
    constraint profiles_theme_valid check (theme_preference in ('system', 'light', 'dark')),
  provider_identity jsonb not null default '{}'::jsonb,
  pending_deletion boolean not null default false,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_pkey primary key (user_id)
);

comment on table public.profiles is
'Current profile, localization, and notification preferences for each authenticated user.';

create index profiles_language_idx on public.profiles using btree (language);
create index profiles_pending_deletion_idx
  on public.profiles using btree (pending_deletion, deletion_requested_at desc);

create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null
    references auth.users (id) on delete cascade,
  role text not null
    constraint messages_role_valid check (role in ('user', 'assistant', 'system')),
  content text not null,
  language text not null
    constraint messages_language_valid check (language in ('en', 'de')),
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.messages is
'Chat transcript entries (user, assistant, and system) associated with an authenticated user.';

create index messages_user_id_created_at_idx
  on public.messages using btree (user_id, created_at desc);

create table public.newsletter_events (
  id bigint generated always as identity primary key,
  user_id uuid not null
    references auth.users (id) on delete cascade,
  status text not null
    constraint newsletter_events_status_valid check (status in ('requested', 'subscribed', 'unsubscribed')),
  source text not null default 'chat_flow'
    constraint newsletter_events_source_valid check (source in ('chat_flow', 'settings_overlay', 'edge_function')),
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.newsletter_events is
'Append-only log of newsletter opt-in/out transitions with their originating surface.';

create index newsletter_events_user_id_idx
  on public.newsletter_events using btree (user_id, created_at desc);

create table public.data_export_events (
  id bigint generated always as identity primary key,
  user_id uuid not null
    references auth.users (id) on delete cascade,
  format text not null default 'json',
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.data_export_events is
'Audit log for user-requested data exports (format + timestamp).';

create index data_export_events_user_id_idx
  on public.data_export_events using btree (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.newsletter_events enable row level security;
alter table public.data_export_events enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

create policy "Profiles are viewable by owner"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Profiles are insertable by owner"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Profiles are deletable by owner"
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Messages are readable by owner"
  on public.messages
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Messages are insertable by owner"
  on public.messages
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Messages are updatable by owner"
  on public.messages
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Messages are deletable by owner"
  on public.messages
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Newsletter events are readable by owner"
  on public.newsletter_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Newsletter events are append-only per owner"
  on public.newsletter_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Data export events are readable by owner"
  on public.data_export_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Data export events are append-only per owner"
  on public.data_export_events
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
