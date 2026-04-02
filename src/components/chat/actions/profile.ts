import { store } from '../app/store';
import {
  fetchProfilePreferences,
  persistProfilePreferences,
} from '../supabase/profile';
import { isSupabaseConfigured } from '../supabase/client';
import { setThemeMode } from './theme';
import { cacheUserState, persistLocaleSelection, type NewsletterStatus } from '../app/state';
import type { LocaleContent, LocaleKey } from '../content';
import { getLocaleDateString } from '../utils/date';
import { signOut } from '../auth/controller';
import { clearPreAuthState } from '../auth/preAuthCache';
import { isImpersonating, getImpersonateId } from '../impersonation';

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

  // Perform sign out
  clearPreAuthState();
  signOut().catch((e) => console.error(e));
  store.reset();
};

const setNewsletterStatus = (status: NewsletterStatus) => {
  const state = store.state;
  if (state.newsletterPreference.status === status) {
    return;
  }
  state.newsletterPreference.status = status;
  state.newsletterPreference.lastUpdatedAt =
    status === 'unknown' ? null : Date.now();
  store.notify();
};

const setAccountDeletionState = (
  pending: boolean,
  requestedAt: number | null,
) => {
  store.state.accountDeletion.pending = pending;
  store.state.accountDeletion.requestedAt = requestedAt;
};

const setNewsletterSyncing = (value: boolean) => {
  if (store.state.newsletterPreference.isSyncing === value) {
    return;
  }
  store.state.newsletterPreference.isSyncing = value;
  store.notify();
};

let profileSyncPromise: Promise<void> | null = null;

export const loadProfilePreferences = (
  locale: LocaleContent,
): Promise<void> | void => {
  const state = store.state;
  if (!state.userId || !isSupabaseConfigured) {
    return;
  }
  if (profileSyncPromise) {
    return profileSyncPromise;
  }

  // When impersonating, fetch the impersonated user's profile (for customerToken)
  // but skip applying their personal preferences (theme, language, newsletter, deletion).
  const impersonatedId = getImpersonateId();
  const targetUserId = impersonatedId ?? state.userId;

  setNewsletterSyncing(true);
  profileSyncPromise = fetchProfilePreferences({
    userId: targetUserId,
  })
    .then((preferences) => {
      if (!state.userId) {
        return;
      }

      if (preferences?.language && preferences.language !== state.localeKey) {
        state.localeKey = preferences.language;
        persistLocaleSelection(preferences.language);
        store.notify();
      }
      if (
        preferences?.themePreference &&
        preferences.themePreference !== store.state.themeMode
      ) {
        setThemeMode(preferences.themePreference);
      }
      if (preferences?.customerToken !== undefined) {
        const hadToken = Boolean(state.customerToken);
        state.customerToken = preferences.customerToken;
        if (!impersonatedId) {
          cacheUserState({
            isAuthenticated: state.isAuthenticated,
            userId: state.userId,
            userEmail: state.userEmail,
            userAvatarUrl: state.userAvatarUrl,
            userDisplayName: state.userDisplayName,
            isAdmin: state.isAdmin,
            customerToken: preferences.customerToken,
          });
        }
        store.notify();
        if (!hadToken && preferences.customerToken) {
          import('./chat').then(({ restoreMachineConfigSession }) => {
            restoreMachineConfigSession();
          });
        }
      }
      if (typeof preferences?.newsletterOptIn === 'boolean') {
        setNewsletterStatus(
          preferences.newsletterOptIn ? 'subscribed' : 'unsubscribed',
        );
      } else {
        setNewsletterStatus('unknown');
      }
      // Skip deletion sign-out when impersonating — don't kick out the admin
      if (preferences?.pendingDeletion && !impersonatedId) {
        const parsed = preferences.deletionRequestedAt
          ? Date.parse(preferences.deletionRequestedAt)
          : null;
        const timestamp = Number.isNaN(parsed ?? NaN) ? null : parsed;
        setAccountDeletionState(true, timestamp);
        handlePendingDeletionSignOut(locale, timestamp);
        return;
      }
      setAccountDeletionState(false, null);
    })
    .catch((error) => {
      console.error('[supabase] Failed to load profile preferences', error);
    })
    .finally(() => {
      setNewsletterSyncing(false);
      profileSyncPromise = null;
    });

  return profileSyncPromise;
};

export const persistThemePreference = () => {
  if (isImpersonating()) return;
  const state = store.state;
  if (!state.isAuthenticated || !state.userId || !isSupabaseConfigured) {
    return;
  }
  const currentTheme = state.themeMode;
  void persistProfilePreferences({
    userId: state.userId,
    themePreference: currentTheme,
  }).catch((error) => {
    console.error('[supabase] Failed to persist theme preference', error);
  });
};

export const persistLanguagePreference = (localeKey: LocaleKey) => {
  if (isImpersonating()) return;
  const state = store.state;
  if (!state.isAuthenticated || !state.userId || !isSupabaseConfigured) {
    return;
  }
  void persistProfilePreferences({
    userId: state.userId,
    language: localeKey,
  }).catch((error) => {
    console.error('[supabase] Failed to persist language preference', error);
  });
};
