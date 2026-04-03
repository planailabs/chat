-- Staff Pings: internal AI-to-staff notifications
-- AI chat modes insert rows (via service role); admins view + resolve.

create table public.staff_pings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz
);

create index staff_pings_created_at_idx on public.staff_pings (created_at desc);

alter table public.staff_pings enable row level security;

-- Admins can read + update (resolve). No INSERT policy — service role only.
create policy "Admins can read all staff pings"
  on public.staff_pings for select to authenticated
  using ((select private.is_admin()));

create policy "Admins can update staff pings"
  on public.staff_pings for update to authenticated
  using ((select private.is_admin()));
