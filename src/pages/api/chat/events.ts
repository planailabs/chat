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
import { addConnection, type SSEWriter } from '@/lib/chat/handler';

const SUPABASE_URL = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const GET: APIRoute = async ({ request }) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth: Bearer header or ?token= query param ─────────────────────────
  let jwt: string | null = null;
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    jwt = authHeader.slice(7);
  } else {
    const url = new URL(request.url);
    jwt = url.searchParams.get('token');
  }

  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
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
    const { data: chatRow } = await supabase
      .from('machine_config_chat')
      .select('messages')
      .eq('user_id', user.id)
      .maybeSingle();

    const stored = chatRow?.messages;
    if (stored && typeof stored === 'object' && (stored as any).v === 1) {
      const record = stored as { phase: string; pendingQuestion: unknown };
      if (record.phase === 'waiting_for_answer' && record.pendingQuestion) {
        pendingQuestion = record.pendingQuestion;
      }
    }
  } catch {
    // Non-critical — continue without pending question
  }

  // ── SSE stream ──────────────────────────────────────────────────────────
  const userId = user.id;

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

      const unsubscribe = addConnection(userId, writer);

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
