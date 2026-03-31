/**
 * GET /api/chat/history/
 *
 * Fetches the persisted machine-config conversation for the authenticated user.
 * Returns { messages: Array<{role, content}> } or { messages: [] } if none.
 *
 * Storage format is a v1 ConversationRecord:
 *   { v: 1, phase, messages: StoredMessage[], pendingQuestion }
 *
 * Assistant messages have ContentBlock[] content — we extract text blocks
 * and flatten to displayable strings. Tool-result user messages are skipped.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Flatten a stored message to a displayable { role, content: string } form.
 * - user (string content): pass through
 * - user (ToolResultBlockParam[]): skip — internal
 * - assistant (ContentBlock[]): extract text blocks
 * - cancel: pass through
 */
const flattenMessage = (
  msg: { role: string; content: unknown },
): { role: string; content: string } | null => {
  const { role, content } = msg;

  if (role === 'cancel') {
    return { role, content: typeof content === 'string' ? content : '' };
  }

  if (typeof content === 'string') {
    return { role, content };
  }

  if (Array.isArray(content)) {
    // User message with tool_result blocks → skip (internal)
    if (content.length > 0 && content[0]?.type === 'tool_result') {
      return null;
    }

    // Assistant message with ContentBlock[] → extract text
    const textParts = content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text as string);

    if (textParts.length === 0) return null; // tool_use only — skip
    return { role: 'assistant', content: textParts.join('\n\n') };
  }

  return null;
};

export const GET: APIRoute = async ({ request }) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  // ─── Verify JWT ───────────────────────────────────────────────────────────
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

  // ─── Fetch chat history ─────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('machine_config_chat')
    .select('messages')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[chat/history] Fetch error:', error);
    return jsonResponse({ error: 'Failed to load chat history' }, 500);
  }

  const stored = data?.messages;
  const rawMessages: Array<{ role: string; content: unknown }> =
    stored && typeof stored === 'object' && (stored as any).v === 1
      ? (stored as any).messages ?? []
      : [];

  const messages = rawMessages.map(flattenMessage).filter(Boolean);

  // Include pending question and phase for session restoration
  const record = stored as any;
  const extra: Record<string, unknown> = {};
  if (record?.phase === 'waiting_for_answer' && record.pendingQuestion) {
    extra.pendingQuestion = record.pendingQuestion;
    extra.phase = record.phase;
  }

  return jsonResponse({ messages, ...extra });
};
