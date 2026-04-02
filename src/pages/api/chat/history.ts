/**
 * GET /api/chat/history/
 *
 * Fetches the persisted conversation for the authenticated user.
 * Returns { messages: Array<{id, role, content}>, phase?, pendingQuestion? } or { messages: [] }.
 *
 * Supports ?mode= query param (defaults to machine_config).
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getChatModeConfig, type ChatModeId } from '@/lib/chat/modes';
import { env } from '@/lib/env';

// Ensure all modes are registered
import '@/lib/chat/modes/machine-config';
import '@/lib/chat/modes/sales';


const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Flatten a message row to a displayable { id, role, content: string } form.
 * Skips rows where content is empty and content_blocks has tool_result entries.
 */
const flattenMessage = (
  row: { id: string; role: string; content: string; content_blocks: unknown },
): { id: string; role: string; content: string } | null => {
  const { id, role, content, content_blocks } = row;

  if (role === 'cancel') {
    return { id, role, content: content ?? '' };
  }

  // Skip user messages with tool_result blocks (internal)
  if (role === 'user' && Array.isArray(content_blocks) &&
      content_blocks.length > 0 && (content_blocks[0] as any)?.type === 'tool_result') {
    return null;
  }

  // Skip assistant messages with no text content (tool_use only)
  if (role === 'assistant' && !content) {
    return null;
  }

  return { id, role, content };
};

export const GET: APIRoute = async ({ request }) => {
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

  // ─── Mode ─────────────────────────────────────────────────────────────────
  const url = new URL(request.url);
  const modeId = (url.searchParams.get('mode') ?? 'machine_config') as ChatModeId;
  const mode = getChatModeConfig(modeId);
  if (!mode) {
    return jsonResponse({ error: `Unknown chat mode: ${modeId}` }, 400);
  }

  // ─── Fetch state + messages in parallel ─────────────────────────────────
  const [stateResult, messagesResult] = await Promise.all([
    supabase
      .from(mode.stateTable)
      .select('phase, pending_question')
      .eq('user_id', user.id)
      .eq('mode', mode.modeColumn)
      .maybeSingle(),
    supabase
      .from(mode.messagesTable)
      .select('id, role, content, content_blocks')
      .eq('user_id', user.id)
      .eq('mode', mode.modeColumn)
      .order('ordinal', { ascending: true }),
  ]);

  if (messagesResult.error) {
    console.error('[chat/history] Fetch error:', messagesResult.error);
    return jsonResponse({ error: 'Failed to load chat history' }, 500);
  }

  const messages = (messagesResult.data ?? [])
    .map(flattenMessage)
    .filter(Boolean);

  // Include pending question and phase for session restoration
  const extra: Record<string, unknown> = {};
  const state = stateResult.data;
  if (state?.phase === 'waiting_for_answer' && state.pending_question) {
    extra.pendingQuestion = state.pending_question;
    extra.phase = state.phase;
  }

  return jsonResponse({ messages, ...extra });
};
