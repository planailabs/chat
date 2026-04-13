/**
 * GET /api/admin/system-prompt-extension?userId=...&mode=...
 * PUT /api/admin/system-prompt-extension
 * DELETE /api/admin/system-prompt-extension
 *
 * Admin-only endpoint. Manages per-user, per-mode system prompt extensions.
 * GET returns { content } for a single user+mode, or { extensions: [{mode,content}] } for all modes of a user.
 * PUT body: { userId, mode, content } — upserts.
 * DELETE body: { userId, mode } — removes.
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

async function verifyAdmin(jwt: string) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return { supabase: null, error: 'Unauthorized' };

  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!adminRow) return { supabase: null, error: 'Forbidden' };

  return { supabase, error: null };
}

export const GET: APIRoute = async ({ request }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { supabase, error: authError } = await verifyAdmin(authHeader.slice(7));
  if (authError || !supabase) {
    return jsonResponse({ error: authError }, authError === 'Forbidden' ? 403 : 401);
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  const mode = url.searchParams.get('mode');
  if (mode) {
    // Single extension
    const { data, error } = await supabase
      .from('system_prompt_extensions')
      .select('content')
      .eq('user_id', userId)
      .eq('mode', mode)
      .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ content: data?.content ?? '' });
  }

  // All extensions for user
  const { data, error } = await supabase
    .from('system_prompt_extensions')
    .select('mode, content')
    .eq('user_id', userId);

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ extensions: data ?? [] });
};

export const PUT: APIRoute = async ({ request }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { supabase, error: authError } = await verifyAdmin(authHeader.slice(7));
  if (authError || !supabase) {
    return jsonResponse({ error: authError }, authError === 'Forbidden' ? 403 : 401);
  }

  let body: { userId: string; mode: string; content: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.userId || !body.mode || typeof body.content !== 'string') {
    return jsonResponse({ error: 'Missing userId, mode, or content' }, 400);
  }

  const { error: upsertError } = await supabase
    .from('system_prompt_extensions')
    .upsert(
      { user_id: body.userId, mode: body.mode, content: body.content },
      { onConflict: 'user_id,mode' },
    );

  if (upsertError) {
    return jsonResponse({ error: upsertError.message }, 500);
  }

  return jsonResponse({ status: 'ok' });
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'Server not configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { supabase, error: authError } = await verifyAdmin(authHeader.slice(7));
  if (authError || !supabase) {
    return jsonResponse({ error: authError }, authError === 'Forbidden' ? 403 : 401);
  }

  let body: { userId: string; mode: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.userId || !body.mode) {
    return jsonResponse({ error: 'Missing userId or mode' }, 400);
  }

  const { error: deleteError } = await supabase
    .from('system_prompt_extensions')
    .delete()
    .eq('user_id', body.userId)
    .eq('mode', body.mode);

  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 500);
  }

  return jsonResponse({ status: 'ok' });
};
