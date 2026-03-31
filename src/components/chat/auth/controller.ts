import type { Provider, Session } from '@supabase/supabase-js';
import { supabaseClient, isSupabaseConfigured } from '../supabase/client';
import { OAUTH_PROVIDER_MAP, type OAuthProvider } from '../constants';

export type AuthProvider = OAuthProvider;

export type SessionListener = (session: Session | null) => void;

export const initAuthController = (listener: SessionListener) => {
  if (!isSupabaseConfigured || !supabaseClient) {
    console.warn(
      '[auth] Supabase environment variables missing; auth disabled until configured.',
    );
    listener(null);
    return;
  }
  supabaseClient.auth.getSession().then(({ data }) => {
    listener(data.session ?? null);
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    listener(session);
  });
};

export const signInWithProvider = async (provider: AuthProvider) => {
  if (!isSupabaseConfigured || !supabaseClient) {
    const error = new Error(
      'Supabase environment variables missing; cannot start OAuth flow.',
    );
    console.error('[auth] %s', error.message);
    throw error;
  }
  const mappedProvider = OAUTH_PROVIDER_MAP[provider] as Provider;

  // Dynamically redirect to the current URL (where the user initiated the login)
  let redirectTo: string | undefined;
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.hash = ''; // Clear hash to avoid conflicts with Supabase auth fragment
    redirectTo = url.toString();
  }

  console.log('[auth] initiating sign-in', { provider, redirectTo });

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: mappedProvider,
    options: {
      redirectTo,
    },
  });
  if (error) {
    throw error;
  }
};

export const signOut = async () => {
  if (!isSupabaseConfigured || !supabaseClient) {
    console.warn(
      '[auth] Supabase not configured; skipping sign-out request but clearing UI state.',
    );
    return;
  }
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    throw error;
  }
};

/**
 * Checks if the current user is an admin.
 * Uses 'admins' table check (backed by RLS).
 */
export const checkAdminStatus = async (): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabaseClient) {
    return false;
  }

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session?.user) return false;

  const { data: adminRow } = await supabaseClient
    .from('admins')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  return !!adminRow;
};
