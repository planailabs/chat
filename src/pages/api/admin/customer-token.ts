/**
 * PUT /api/admin/customer-token
 * DELETE /api/admin/customer-token
 *
 * Admin-only endpoint. Sets or removes a customer token on a user's profile.
 * Body: { userId: string, token?: string }
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

  let body: { userId: string; token: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.userId || !body.token) {
    return jsonResponse({ error: 'Missing userId or token' }, 400);
  }

  // Validate token against mac-mgmt
  if (env.MAC_MGMT_URL) {
    try {
      const res = await fetch(`${env.MAC_MGMT_URL}/api/self`, {
        headers: { Authorization: `Bearer ${body.token}` },
      });
      if (!res.ok) {
        return jsonResponse({ error: 'Invalid token — mac-mgmt rejected it' }, 400);
      }
    } catch {
      return jsonResponse({ error: 'Failed to validate token against mac-mgmt' }, 502);
    }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ customer_token: body.token })
    .eq('user_id', body.userId);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
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

  let body: { userId: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (!body.userId) {
    return jsonResponse({ error: 'Missing userId' }, 400);
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ customer_token: null })
    .eq('user_id', body.userId);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  return jsonResponse({ status: 'ok' });
};
