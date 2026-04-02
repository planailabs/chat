/**
 * POST /api/chat/message
 *
 * Accepts { type: "message"|"answer", text } with Bearer auth.
 * Acquires a per-user lock, fires handleChatMessage asynchronously,
 * and returns 202 Accepted immediately. Events are delivered via SSE.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { handleChatMessage, acquireLock, releaseLock, broadcast, compositeKey, type ChatConfig } from '@/lib/chat/handler';
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  // ── Auth ────────────────────────────────────────���───────────────────────
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

  // ── Impersonation ─────────────────────────────────────────────────────
  const { userId: effectiveUserId } = await resolveEffectiveUser(supabase, user.id, request);

  // ── Parse body ───���──────────────────────────────────────────────────────
  let body: { type: string; text: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.type || typeof body.text !== 'string') {
    return jsonResponse({ error: 'Invalid body: need { type, text }' }, 400);
  }

  // ─��� Mode + Locale ─���────────────────────────────���──────────────────────
  const url = new URL(request.url);
  const locale = url.searchParams.get('lang') ?? 'en';
  const modeId = (url.searchParams.get('mode') ?? 'machine_config') as ChatModeId;

  const mode = getChatModeConfig(modeId);
  if (!mode) {
    return jsonResponse({ error: `Unknown chat mode: ${modeId}` }, 400);
  }

  // ── Lock ─────────────���──────────────────────────────────────────────────
  const connKey = compositeKey(effectiveUserId, modeId);
  const lockId = acquireLock(connKey);
  if (!lockId) {
    return jsonResponse({ error: 'A conversation turn is already in progress' }, 409);
  }

  // ── Config ──────��─────────────────────────────────��─────────────────────
  const config: ChatConfig = {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    macMgmtUrl: env.MAC_MGMT_URL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  // ── Fire and forget ─────────────────────────────────────────────────────
  void (async () => {
    try {
      await handleChatMessage(effectiveUserId, config, locale, body, mode);
    } catch (err) {
      console.error('[chat/message] Handler error:', err);
      broadcast(connKey, 'error', {
        type: 'error',
        message: err instanceof Error ? err.message : 'Internal error',
      });
    } finally {
      releaseLock(connKey, lockId);
    }
  })();

  return jsonResponse({ status: 'accepted' }, 202);
};
