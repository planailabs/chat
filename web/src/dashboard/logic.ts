import { getSupabaseClientOrThrow } from '../chat/supabase/client';

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function getJwt(): Promise<string> {
  const supabase = getSupabaseClientOrThrow();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}

export type DashboardState = {
  isAdmin: boolean;
  checking: boolean;
  error: string | null;
};

/**
 * Checks if the current user is an admin.
 * Redirects to / if not authenticated or not admin.
 * @returns true if admin, false (and redirects) otherwise.
 */
export async function enforceAdminAccess(): Promise<boolean> {
  const supabase = getSupabaseClientOrThrow();

  // 1. Check session
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session) {
    console.warn('Dashboard: No session, redirecting');
    window.location.href = '/';
    return false;
  }

  // 2. Check admin status via RPC or direct table query
  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin');

  // Also try direct table query as fallback if RPC is restricted or to double check
  // But RPC `is_admin` (in private schema) is the best way defined in SQL (wait, SQL said it's private schema,
  // but we made a wrapper or we need to access public.admins?)
  // The SQL 002_dashboard_admin.sql defined:
  // create policy "Users can check their own admin status" on public.admins ...
  // So we can query public.admins directly.

  if (adminError) {
    // Fallback to table query
    const { data: adminRow, error: tableError } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .single();

    if (tableError || !adminRow) {
      console.warn(
        'Dashboard: Not an admin (table check), redirecting',
        tableError,
      );
      window.location.href = '/';
      return false;
    }
    return true;
  }

  // If RPC worked
  if (!isAdmin) {
    console.warn('Dashboard: Not an admin (RPC check), redirecting');
    window.location.href = '/';
    return false;
  }

  return true;
}

export async function signOutAdmin() {
  const supabase = getSupabaseClientOrThrow();
  await supabase.auth.signOut();
  window.location.href = '/';
}
