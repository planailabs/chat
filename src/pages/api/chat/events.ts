/**
 * GET /api/chat/events
 *
 * Server-Sent Events endpoint. Each tab opens a persistent connection.
 * All events for the user are broadcast to all connections.
 *
 * Auth: accepts both Bearer header and ?token= query param
 * (EventSource doesn't support custom headers).
 *
 * On connect, if the user has a pending question (waiting_for_answer phase),
 * it's immediately sent so the client can show the question UI.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { addConnection, compositeKey, type SSEWriter } from '@/lib/chat/handler';
import { getChatModeConfig, type ChatModeId } from '@/lib/chat/modes';
import { env } from '@/lib/env';

// Ensure all modes are registered
import '@/lib/chat/modes/machine-config';
import '@/lib/chat/modes/sales';


export const GET: APIRoute = async ({ request }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth: Bearer header or ?token= query param ─────────────────────────
  const url = new URL(request.url);
  let jwt: string | null = null;
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    jwt = authHeader.slice(7);
  } else {
    jwt = url.searchParams.get('token');
  }

  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Mode ──────────────────────────────────────────────────────────────────
  const modeId = (url.searchParams.get('mode') ?? 'machine_config') as ChatModeId;
  const mode = getChatModeConfig(modeId);
  if (!mode) {
    return new Response(JSON.stringify({ error: `Unknown chat mode: ${modeId}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Check for pending question to send on connect ───────────────────────
  let pendingQuestion: unknown = null;
  try {
    const { data } = await supabase
      .from(mode.stateTable)
      .select('phase, pending_question')
      .eq('user_id', user.id)
      .eq('mode', mode.modeColumn)
      .maybeSingle();

    if (data?.phase === 'waiting_for_answer' && data.pending_question) {
      pendingQuestion = data.pending_question;
    }
  } catch {
    // Non-critical — continue without pending question
  }

  // ── SSE stream ──────────────────────────────────────────────────────────
  const connKey = compositeKey(user.id, modeId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const writer: SSEWriter = {
        write(event: string, data: unknown) {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream closed
          }
        },
        end() {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        },
      };

      const unsubscribe = addConnection(connKey, writer);

      // Send pending question immediately if exists
      if (pendingQuestion) {
        writer.write('question', { type: 'question', question: pendingQuestion });
      }

      // Keep-alive ping every 30s
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(pingInterval);
          unsubscribe();
        }
      }, 30_000);

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(pingInterval);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
