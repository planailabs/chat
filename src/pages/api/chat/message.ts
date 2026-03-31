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
import { handleChatMessage, acquireLock, releaseLock, broadcast, type ChatConfig } from '@/lib/chat/handler';

const SUPABASE_URL = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAC_MGMT_URL = process.env.MAC_MGMT_URL;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }
  const jwt = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: { type: string; text: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.type || typeof body.text !== 'string') {
    return jsonResponse({ error: 'Invalid body: need { type, text }' }, 400);
  }

  // ── Locale ──────────────────────────────────────────────────────────────
  const url = new URL(request.url);
  const locale = url.searchParams.get('lang') ?? 'en';

  // ── Lock ────────────────────────────────────────────────────────────────
  const lockId = acquireLock(user.id);
  if (!lockId) {
    return jsonResponse({ error: 'A conversation turn is already in progress' }, 409);
  }

  // ── Config ──────────────────────────────────────────────────────────────
  const config: ChatConfig = {
    anthropicApiKey: ANTHROPIC_API_KEY,
    macMgmtUrl: MAC_MGMT_URL ?? '',
    supabaseUrl: SUPABASE_URL,
    supabaseServiceKey: SUPABASE_SERVICE_KEY,
  };

  // ── Fire and forget ─────────────────────────────────────────────────────
  void (async () => {
    try {
      await handleChatMessage(user.id, config, locale, body);
    } catch (err) {
      console.error('[chat/message] Handler error:', err);
      broadcast(user.id, 'error', {
        type: 'error',
        message: err instanceof Error ? err.message : 'Internal error',
      });
    } finally {
      releaseLock(user.id, lockId);
    }
  })();

  return jsonResponse({ status: 'accepted' }, 202);
};
