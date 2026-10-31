/**
 * Profile Actions
 *
 * Drives the profile state machine (idle → loading → ready | error).
 * Loads preferences from Supabase, applies them to app state, and
 * provides persist functions for theme/language changes.
 */

import { store } from '../app/store';
import {
  fetchProfilePreferences,
  persistProfilePreferences,
} from '../supabase/profile';
import { isSupabaseConfigured } from '../supabase/client';
import { setThemeMode } from './theme';
import { cacheUserState, persistLocaleSelection } from '../app/state';
import type { NewsletterStatus } from '../app/profileState';
import {
  profileStartLoading,
  profileLoadSuccess,
  profileLoadError,
  profileSetNewsletter,
  profileSetNewsletterSyncing,
  profileSetDeletion,
  type ProfileData,
} from '../app/profileState';
import type { LocaleContent, LocaleKey } from '../content';
import { getLocaleDateString } from '../utils/date';
import { signOut } from '../auth/controller';
import { clearPreAuthState } from '../auth/preAuthCache';
import { isImpersonating, getImpersonateId } from '../impersonation';

// ─── Deletion Sign-Out ──────────────────────────────────────────────────────

export const handlePendingDeletionSignOut = (
  locale: LocaleContent,
  requestedAt: number | null,
) => {
  const dateText =
    getLocaleDateString(requestedAt, store.state.localeKey) ?? '30 days';
  const message = locale.settings.sections.privacy.deletePendingLogin.replace(
    '{{date}}',
    dateText,
  );
  alert(message);

  clearPreAuthState();
  signOut().catch((e) => console.error(e));
  store.reset();
};

/** Sync profile state machine outputs to AppState top-level fields */
const applyProfileToState = () => {
  const { profile } = store.state;
  store.state.customerToken = profile.customerToken;

  if (getImpersonateId() && profile.email) {
    store.state.userEmail = profile.email;
    store.state.userDisplayName = profile.displayName;
    store.state.userAvatarUrl = profile.avatarUrl;
  }
};

// ─── Load Profile ───────────────────────────────────────────────────────────

let loadPromise: Promise<void> | null = null;

export const loadProfilePreferences = (
  locale: LocaleContent,
): Promise<void> | void => {
  const state = store.state;
  if (!state.userId || !isSupabaseConfigured) return;
  if (loadPromise) return loadPromise;

  const impersonatedId = getImpersonateId();
  const targetUserId = impersonatedId ?? state.userId;
  const ps = state.profile;

  profileStartLoading(ps);
  profileSetNewsletterSyncing(ps, true);
  applyProfileToState();
  store.notify();

  loadPromise = fetchProfilePreferences({ userId: targetUserId })
    .then((preferences) => {
      if (!state.userId) return;

      const data: ProfileData = {
        language: preferences?.language ?? null,
        themePreference: preferences?.themePreference ?? null,
        newsletterOptIn: preferences?.newsletterOptIn ?? null,
        customerToken: preferences?.customerToken ?? null,
        pendingDeletion: preferences?.pendingDeletion ?? false,
        deletionRequestedAt: preferences?.deletionRequestedAt ?? null,
        providerIdentity: preferences?.providerIdentity ?? {},
      };

      profileLoadSuccess(ps, data, Boolean(impersonatedId));
      applyProfileToState();

      // Apply language
      if (data.language && data.language !== state.localeKey) {
        state.localeKey = data.language;
        persistLocaleSelection(data.language);
      }

      // Apply theme
      if (data.themePreference && data.themePreference !== store.state.themeMode) {
        setThemeMode(data.themePreference);
      }

      // Cache user state (only for own profile, not when impersonating)
      if (!impersonatedId) {
        cacheUserState({
          isAuthenticated: state.isAuthenticated,
          userId: state.userId,
          userEmail: state.userEmail,
          userAvatarUrl: state.userAvatarUrl,
          userDisplayName: state.userDisplayName,
          isAdmin: state.isAdmin,
          customerToken: data.customerToken,
        });
      }

      // If customer token just became available, initialize machine config chat
      if (data.customerToken && !store.state.chat?.aiChat) {
        import('./chat').then(({ restoreMachineConfigSession }) => {
          restoreMachineConfigSession();
        });
      }

      // Handle pending deletion (skip when impersonating)
      if (data.pendingDeletion && !impersonatedId) {
        handlePendingDeletionSignOut(locale, ps.deletionRequestedAt);
        return;
      }

      store.notify();
    })
    .catch((error) => {
      console.error('[profile] Failed to load preferences', error);
      profileLoadError(ps, error instanceof Error ? error.message : 'Unknown error');
      applyProfileToState();
      store.notify();
    })
    .finally(() => {
      profileSetNewsletterSyncing(ps, false);
      applyProfileToState();
      loadPromise = null;
      store.notify();
    });

  return loadPromise;
};

// ─── Persist Helpers ────────────────────────────────────────────────────────

export const persistThemePreference = () => {
  if (isImpersonating()) return;
  const state = store.state;
  if (!state.isAuthenticated || !state.userId || !isSupabaseConfigured) return;
  void persistProfilePreferences({
    userId: state.userId,
    themePreference: state.themeMode,
  }).catch((error) => {
    console.error('[profile] Failed to persist theme', error);
  });
};

export const persistLanguagePreference = (localeKey: LocaleKey) => {
  if (isImpersonating()) return;
  const state = store.state;
  if (!state.isAuthenticated || !state.userId || !isSupabaseConfigured) return;
  void persistProfilePreferences({
    userId: state.userId,
    language: localeKey,
  }).catch((error) => {
    console.error('[profile] Failed to persist language', error);
  });
};

// ─── Newsletter Status (used by settings and chat actions) ──────────────────

export const setNewsletterStatus = (status: NewsletterStatus) => {
  const ps = store.state.profile;
  if (ps.newsletterStatus === status) return;
  profileSetNewsletter(ps, status);
  applyProfileToState();
  store.notify();
};
