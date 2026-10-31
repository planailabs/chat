import { store } from '../app/store';
import { insertUserMessages } from '../supabase/messages';
import {
  readPreAuthState,
  clearPreAuthState,
  type CachedPrompt,
} from '../auth/preAuthCache';
import type { LocaleKey } from '../content';
import { isImpersonating } from '../impersonation';

const normalizePromptLocales = (
  prompts: CachedPrompt[],
  fallbackLocale: LocaleKey,
) =>
  prompts.map((prompt) => ({
    ...prompt,
    localeKey: prompt.localeKey ?? fallbackLocale,
  }));

export const persistPromptsToSupabase = async (
  prompts: CachedPrompt[],
  fallbackLocale: LocaleKey,
): Promise<boolean> => {
  if (isImpersonating()) return true; // Don't write prompts for impersonated users
  const state = store.state;
  if (!state.userId || prompts.length === 0) {
    return false;
  }
  const normalized = normalizePromptLocales(prompts, fallbackLocale);
  try {
    await insertUserMessages({
      userId: state.userId,
      prompts: normalized,
    });
    return true;
  } catch (error) {
    console.error('[supabase] Failed to persist prompts', error);
    return false;
  }
};

let promptSyncPromise: Promise<void> | null = null;

export const syncCachedPromptsToSupabase = () => {
  const state = store.state;
  if (!state.userId || promptSyncPromise) {
    return;
  }
  const cached = readPreAuthState();
  if (!cached || cached.prompts.length === 0) {
    return;
  }
  promptSyncPromise = persistPromptsToSupabase(cached.prompts, cached.localeKey)
    .then((didPersist) => {
      if (didPersist) {
        clearPreAuthState();
      }
    })
    .finally(() => {
      promptSyncPromise = null;
    });
};
