-- Admin policies for multi-mode chat tables + profiles update for token management.
-- Admins can read all chat messages/state (for impersonation portal)
-- and update customer_token on profiles (for token management portal).

set search_path = public;

-- ─── Admin read access to chat_messages ─────────────────────────────────────
create policy "Admins can read all chat messages"
  on public.chat_messages
  for select
  to authenticated
  using ((select private.is_admin()));

-- ─── Admin read access to chat_state ────────────────────────────────────────
create policy "Admins can read all chat state"
  on public.chat_state
  for select
  to authenticated
  using ((select private.is_admin()));

-- ─── Admin read access to chat_token_usage ──────────────────────────────────
create policy "Admins can read all token usage"
  on public.chat_token_usage
  for select
  to authenticated
  using ((select private.is_admin()));

-- ─── Admin update access to profiles (for customer_token management) ────────
create policy "Admins can update all profiles"
  on public.profiles
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ─── Enable realtime on chat_messages for admin impersonation ───────────────
alter publication supabase_realtime add table public.chat_messages;
