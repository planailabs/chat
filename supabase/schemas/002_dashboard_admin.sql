-- Dashboard Admin Schema
-- Provides admin access control for the /dashboard route.
-- Admins can view all messages and profiles; regular users can only see their own.
--
-- SECURITY NOTES:
-- - The `admins` table has RLS enabled with SELECT-only access (users can check if they're admin)
-- - No INSERT/UPDATE/DELETE policies exist, so modifications must be done via Supabase Dashboard
-- - The `private.is_admin()` function uses SECURITY DEFINER to bypass RLS for the check
-- - This function is in a private schema, not exposed via the public API

set search_path = public;

--------------------------------------------------------------------------------
-- Private schema for security-definer helper functions
-- Functions here are NOT exposed via the Supabase API (only public schema is)
--------------------------------------------------------------------------------
create schema if not exists private;

comment on schema private is
'Internal helper functions that bypass RLS via security definer. Never expose via API.';

--------------------------------------------------------------------------------
-- Admins table
-- Stores which users have admin privileges for the dashboard
--------------------------------------------------------------------------------
create table public.admins (
  user_id uuid not null
    references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint admins_pkey primary key (user_id)
);

comment on table public.admins is
'Admin users who can access /dashboard and view all messages/profiles. Managed via Supabase Dashboard only.';

-- Enable RLS - this is critical for security
alter table public.admins enable row level security;

-- SELECT-only policy: users can check if they are an admin
-- No INSERT/UPDATE/DELETE policies = only modifiable via Dashboard or service role
create policy "Users can check their own admin status"
  on public.admins
  for select
  to authenticated
  using (user_id = (select auth.uid()));

--------------------------------------------------------------------------------
-- is_admin() helper function (security definer)
-- Checks if the current authenticated user is in the admins table.
-- Uses SECURITY DEFINER to bypass RLS on the admins table itself.
-- Placed in private schema so it's not exposed via the API.
--------------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
  );
$$;

comment on function private.is_admin is
'Returns true if the current user is an admin. Uses security definer to bypass admins table RLS.';

-- Grant execute only to authenticated role (no anon access)
revoke all on function private.is_admin from public, anon;
grant execute on function private.is_admin to authenticated;

--------------------------------------------------------------------------------
-- Admin SELECT policies for messages table
-- Admins can read ALL messages (in addition to owner-based access)
--------------------------------------------------------------------------------
create policy "Admins can read all messages"
  on public.messages
  for select
  to authenticated
  using ((select private.is_admin()));

--------------------------------------------------------------------------------
-- Admin SELECT policies for profiles table  
-- Admins can read ALL profiles (in addition to owner-based access)
--------------------------------------------------------------------------------
create policy "Admins can read all profiles"
  on public.profiles
  for select
  to authenticated
  using ((select private.is_admin()));

--------------------------------------------------------------------------------
-- Admin SELECT policies for newsletter_events table
-- Admins can read ALL newsletter events (for dashboard analytics)
--------------------------------------------------------------------------------
create policy "Admins can read all newsletter events"
  on public.newsletter_events
  for select
  to authenticated
  using ((select private.is_admin()));

--------------------------------------------------------------------------------
-- Admin SELECT policies for data_export_events table
-- Admins can read ALL export events (for dashboard analytics)
--------------------------------------------------------------------------------
create policy "Admins can read all data export events"
  on public.data_export_events
  for select
  to authenticated
  using ((select private.is_admin()));

--------------------------------------------------------------------------------
-- Index for admin lookups (user_id is already PK so implicitly indexed)
-- No additional indexes needed
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- Enable Realtime on messages table for Admin Dashboard
-- Admins will receive updates for ALL messages via the RLS policy above.
-- Regular users will only receive updates for their own messages.
--------------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;

comment on publication supabase_realtime is
'Supabase Realtime publication. Tables added here will broadcast changes to subscribed clients.';
