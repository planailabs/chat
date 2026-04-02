/**
 * Admin Impersonation Helper
 *
 * Resolves the effective user ID for API requests. If the caller is an admin
 * and passes ?impersonate=<userId>, returns the impersonated user's ID.
 * Otherwise returns the caller's own user ID.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedUser {
  /** The effective user ID (impersonated or own) */
  userId: string;
  /** Whether this request is impersonating another user */
  isImpersonating: boolean;
}

/**
 * Resolve the effective user ID. If ?impersonate= is present and caller is admin,
 * returns the impersonated user ID. Otherwise returns the authenticated user's ID.
 */
export async function resolveEffectiveUser(
  supabase: SupabaseClient,
  authenticatedUserId: string,
  request: Request,
): Promise<ResolvedUser> {
  const url = new URL(request.url);
  const impersonateId = url.searchParams.get('impersonate');

  if (!impersonateId) {
    return { userId: authenticatedUserId, isImpersonating: false };
  }

  // Verify the caller is an admin
  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', authenticatedUserId)
    .maybeSingle();

  if (!adminRow) {
    // Not an admin — ignore impersonate param, use own ID
    return { userId: authenticatedUserId, isImpersonating: false };
  }

  return { userId: impersonateId, isImpersonating: true };
}
