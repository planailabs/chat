/// <reference types="vite/client" />
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import { getEnvOrThrow } from '../env';

const SUPABASE_URL = getEnvOrThrow('SUPABASE_URL');
const SUPABASE_ANON_KEY = getEnvOrThrow('SUPABASE_PUBLISHABLE_KEY');
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const createSessionStorageAdapter = () => {
  if (typeof window === 'undefined') {
    const memoryStore = new Map<string, string>();
    return {
      getItem: async (key: string) => memoryStore.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memoryStore.set(key, value);
      },
      removeItem: async (key: string) => {
        memoryStore.delete(key);
      },
    };
  }

  return {
    getItem: async (key: string) => window.sessionStorage.getItem(key),
    setItem: async (key: string, value: string) => {
      window.sessionStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      window.sessionStorage.removeItem(key);
    },
  };
};

export const supabaseClient = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: true,
        storage: createSessionStorageAdapter(),
        storageKey: 'planai-supabase-auth',
      },
    })
  : null;

export const isSupabaseConfigured = hasSupabaseConfig;

export class SupabaseUnavailableError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Supabase client unavailable; ensure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are configured.',
    );
    this.name = 'SupabaseUnavailableError';
  }
}

export const getSupabaseClientOrThrow = (
  override?: SupabaseClient | null,
): SupabaseClient => {
  const resolved = override ?? supabaseClient;
  if (!resolved || (!override && !hasSupabaseConfig)) {
    throw new SupabaseUnavailableError();
  }
  return resolved;
};
