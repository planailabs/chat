import type {
  PostgrestMaybeSingleResponse,
  SupabaseClient,
} from '@supabase/supabase-js';
import type { LocaleKey } from '../content';
import type { ThemeMode } from '../actions/theme';
import {
  supabaseClient,
  isSupabaseConfigured,
  getSupabaseClientOrThrow,
} from './client';
import { executeWithRetry } from './retry';

interface ClientDeps {
  client?: SupabaseClient;
}

export interface FetchProfilePreferencesParams extends ClientDeps {
  userId: string;
}

export interface ProfilePreferences {
  language: LocaleKey | null;
  themePreference: ThemeMode | null;
  newsletterOptIn: boolean | null;
  pendingDeletion: boolean;
  deletionRequestedAt: string | null;
  providerIdentity: Record<string, unknown>;
  customerToken: string | null;
}

type ProfileRow = {
  language: LocaleKey | null;
  theme_preference: ThemeMode | null;
  newsletter_opt_in: boolean | null;
  pending_deletion: boolean | null;
  deletion_requested_at: string | null;
  provider_identity: Record<string, unknown> | null;
  customer_token: string | null;
};

export const fetchProfilePreferences = async ({
  userId,
  client,
}: FetchProfilePreferencesParams): Promise<ProfilePreferences | null> => {
  const resolvedClient = client ?? supabaseClient;
  if (!resolvedClient || (!client && !isSupabaseConfigured)) {
    return null;
  }
  const { data, error } = await executeWithRetry<
    PostgrestMaybeSingleResponse<ProfileRow>
  >(async () =>
    resolvedClient
      .from('profiles')
      .select(
        'language, theme_preference, newsletter_opt_in, pending_deletion, deletion_requested_at, provider_identity, customer_token',
      )
      .eq('user_id', userId)
      .maybeSingle(),
  );
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  return {
    language: (data.language as LocaleKey | null) ?? null,
    themePreference: (data.theme_preference as ThemeMode | null) ?? null,
    newsletterOptIn:
      typeof data.newsletter_opt_in === 'boolean'
        ? data.newsletter_opt_in
        : null,
    pendingDeletion: Boolean(data.pending_deletion),
    deletionRequestedAt: (data.deletion_requested_at as string | null) ?? null,
    providerIdentity: (data.provider_identity as Record<string, unknown>) ?? {},
    customerToken: (data.customer_token as string | null) ?? null,
  };
};

export interface PersistProfilePreferencesParams extends ClientDeps {
  userId: string;
  language?: LocaleKey | null;
  themePreference?: ThemeMode | null;
  newsletterOptIn?: boolean | null;
  pendingDeletion?: boolean | null;
  deletionRequestedAt?: string | null;
  providerIdentity?: Record<string, unknown> | null;
}

export const persistProfilePreferences = async ({
  userId,
  language,
  themePreference,
  newsletterOptIn,
  pendingDeletion,
  deletionRequestedAt,
  providerIdentity,
  client,
}: PersistProfilePreferencesParams) => {
  const resolvedClient = getSupabaseClientOrThrow(client ?? null);
  const payload: Record<string, unknown> = { user_id: userId };
  if (typeof language !== 'undefined') {
    payload.language = language;
  }
  if (typeof themePreference !== 'undefined') {
    payload.theme_preference = themePreference;
  }
  if (typeof newsletterOptIn !== 'undefined') {
    payload.newsletter_opt_in = newsletterOptIn;
  }
  if (typeof pendingDeletion !== 'undefined') {
    payload.pending_deletion = pendingDeletion;
  }
  if (typeof deletionRequestedAt !== 'undefined') {
    payload.deletion_requested_at = deletionRequestedAt;
  }
  if (typeof providerIdentity !== 'undefined') {
    payload.provider_identity = providerIdentity ?? {};
  }
  if (Object.keys(payload).length === 1) {
    return;
  }
  await executeWithRetry(async () => {
    const { error } = await resolvedClient
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) {
      throw error;
    }
  });
};
