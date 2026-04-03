/**
 * POST /api/chat/nuke/
 *
 * Dev-only endpoint that deletes all chat messages and state for the
 * authenticated user in the selected mode.
 *
 * Supports ?mode= query param (defaults to machine_config).
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getChatModeConfig, type ChatModeId } from '@/lib/chat/modes';
import { resolveEffectiveUser } from '@/lib/admin';
import { env } from '@/lib/env';

// Ensure all modes are registered
import '@/lib/chat/modes/machine-config';
import '@/lib/chat/modes/sales';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) {
    return jsonResponse({ error: 'Not available in production' }, 403);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  // ─── Verify JWT ───────────────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }
  const jwt = authHeader.slice(7);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // ─── Impersonation ────────────────────────────────────────────────────────
  const { userId: effectiveUserId } = await resolveEffectiveUser(supabase, user.id, request);

  // ─── Mode ─────────────────────────────────────────────────────────────────
  const url = new URL(request.url);
  const modeId = (url.searchParams.get('mode') ?? 'machine_config') as ChatModeId;
  const mode = getChatModeConfig(modeId);
  if (!mode) {
    return jsonResponse({ error: `Unknown chat mode: ${modeId}` }, 400);
  }

  // ─── Delete messages and state ────────────────────────────────────────────
  const [messagesResult, stateResult] = await Promise.all([
    supabase
      .from(mode.messagesTable)
      .delete()
      .eq('user_id', effectiveUserId)
      .eq('mode', mode.modeColumn),
    supabase
      .from(mode.stateTable)
      .delete()
      .eq('user_id', effectiveUserId)
      .eq('mode', mode.modeColumn),
  ]);

  if (messagesResult.error || stateResult.error) {
    console.error('[chat/nuke] Delete error:', messagesResult.error ?? stateResult.error);
    return jsonResponse({ error: 'Failed to delete chat data' }, 500);
  }

  return jsonResponse({ ok: true });
};
