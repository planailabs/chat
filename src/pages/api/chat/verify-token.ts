/**
 * GET /api/chat/verify-token
 *
 * Validates the customer token by calling mac-mgmt /api/self.
 * Returns { valid: true, identity } or { valid: false }.
 */

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const MAC_MGMT_URL = process.env.MAC_MGMT_URL;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async ({ request }) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MAC_MGMT_URL) {
    return jsonResponse({ valid: false, error: 'Server not configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ valid: false }, 401);
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
    return jsonResponse({ valid: false }, 401);
  }

  // Look up customer token from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('customer_token')
    .eq('user_id', user.id)
    .maybeSingle();

  const customerToken = profile?.customer_token;
  if (!customerToken) {
    return jsonResponse({ valid: false });
  }

  // Validate against mac-mgmt
  try {
    const res = await fetch(`${MAC_MGMT_URL}/api/self`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!res.ok) {
      return jsonResponse({ valid: false });
    }
    const identity = await res.json();
    return jsonResponse({ valid: true, identity });
  } catch {
    return jsonResponse({ valid: false });
  }
};
