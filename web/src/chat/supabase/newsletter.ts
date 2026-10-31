import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocaleKey } from '../content';
import { getSupabaseClientOrThrow } from './client';
import { executeWithRetry } from './retry';
import { persistProfilePreferences } from './profile';

type NewsletterSource = 'chat_flow' | 'settings_overlay';

interface ClientDeps {
  client?: SupabaseClient;
}

interface PersistNewsletterParams extends ClientDeps {
  userId: string;
  localeKey: LocaleKey;
  subscribe: boolean;
  source: NewsletterSource;
}

export const persistNewsletterPreference = async ({
  userId,
  localeKey,
  subscribe,
  source,
  client,
}: PersistNewsletterParams) => {
  const resolvedClient = getSupabaseClientOrThrow(client ?? null);
  await persistProfilePreferences({
    userId,
    language: localeKey,
    newsletterOptIn: subscribe,
    client: resolvedClient,
  });
  const status = subscribe ? 'subscribed' : 'unsubscribed';
  await executeWithRetry(async () => {
    const { error: eventError } = await resolvedClient
      .from('newsletter_events')
      .insert({
        user_id: userId,
        status,
        source,
      });
    if (eventError) {
      throw eventError;
    }
  });
};

export type { NewsletterSource };
