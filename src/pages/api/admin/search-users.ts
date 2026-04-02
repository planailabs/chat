/**
 * GET /api/admin/search-users?q=email@example.com
 *
 * Admin-only endpoint. Searches users by email.
 * Returns generic user data — each admin portal uses what it needs.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ request }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const jwt = authHeader.slice(7);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify JWT and admin status
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!adminRow) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  // Search query
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim();
  if (!query || query.length < 2) {
    return jsonResponse({ error: 'Query too short (min 2 chars)' }, 400);
  }

  // Paginate through auth.users, filter by email client-side
  const lowerQuery = query.toLowerCase();
  const matchingUsers: Array<{ id: string; email?: string; created_at: string }> = [];
  let page = 1;
  const perPage = 100;

  while (matchingUsers.length < 20) {
    const { data: { users: batch }, error: listError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (listError) {
      return jsonResponse({ error: 'Failed to search users' }, 500);
    }

    if (!batch || batch.length === 0) break;

    for (const u of batch) {
      if (u.email?.toLowerCase().includes(lowerQuery)) {
        matchingUsers.push(u);
        if (matchingUsers.length >= 20) break;
      }
    }

    if (batch.length < perPage) break;
    page++;
  }

  // Fetch profiles for matching users
  const userIds = matchingUsers.map((u) => u.id);
  const { data: profiles } = userIds.length > 0
    ? await supabase
        .from('profiles')
        .select('user_id, customer_token, provider_identity, language, newsletter_opt_in, pending_deletion')
        .in('user_id', userIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

  const results = matchingUsers.map((u) => {
    const profile = profileMap.get(u.id) as any;
    const pi = profile?.provider_identity ?? {};
    return {
      userId: u.id,
      email: u.email,
      createdAt: u.created_at,
      displayName: pi.name ?? null,
      avatarUrl: pi.avatar_url ?? null,
      language: profile?.language ?? null,
      newsletterOptIn: profile?.newsletter_opt_in ?? null,
      customerToken: profile?.customer_token ?? null,
      pendingDeletion: profile?.pending_deletion ?? false,
    };
  });

  return jsonResponse({ users: results });
};
