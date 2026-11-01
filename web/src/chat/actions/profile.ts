/**
 * Profile Actions
 *
 * Saves the user's settings (theme, language, newsletter) to their profile.
 * While an admin impersonates the user the profile is read-only: nothing is
 * written.
 */

import { store } from '../app/store';
import { api, type ProfileUpdate } from '../api';
import type { LocaleKey } from '../content';
import type { ThemeMode } from '../app/state';
import { profileSetNewsletter, profileSetNewsletterSyncing } from '../app/profileState';

const canPersist = () => store.state.isAuthenticated && !store.state.impersonating;

const persistProfile = async (update: ProfileUpdate, what: string): Promise<boolean> => {
  try {
    await api.profile.update(update);
    return true;
  } catch (error) {
    console.error(`[profile] Failed to persist ${what}`, error);
    return false;
  }
};

export const persistThemePreference = (theme: ThemeMode) => {
  if (canPersist()) void persistProfile({ theme }, 'theme');
};

export const persistLanguagePreference = (language: LocaleKey) => {
  if (canPersist()) void persistProfile({ language }, 'language');
};

/** Subscribes or unsubscribes; resolves whether the profile now says so. */
export const persistNewsletterChoice = async (
  subscribe: boolean,
  source: 'chat_flow' | 'settings',
): Promise<boolean> => {
  if (!canPersist()) return false;
  const ps = store.state.profile;
  profileSetNewsletterSyncing(ps, true);
  store.notify();
  const saved = await persistProfile({ newsletter_opt_in: subscribe, newsletter_source: source }, 'newsletter preference');
  if (saved) {
    profileSetNewsletter(ps, subscribe ? 'subscribed' : 'unsubscribed');
  }
  profileSetNewsletterSyncing(ps, false);
  store.notify();
  return saved;
};

/** Reloads the plan and the last hour's use (settings overlay, after hitting the limit). */
export const refreshBudget = async (): Promise<void> => {
  if (!store.state.isAuthenticated) return;
  try {
    const profile = await api.profile.me();
    store.state.budget = profile.budget ?? null;
  } catch (error) {
    console.error('[profile] loading the budget failed', error);
  }
};
