/**
 * Settings Actions
 *
 * Handles user settings operations:
 * - Newsletter subscription toggle
 * - Account deletion request
 * - Data export (GDPR compliance)
 *
 * All state transitions go through the profile state machine.
 */

import { store } from '../app/store';
import { persistProfilePreferences } from '../supabase/profile';
import {
  persistNewsletterPreference,
  type NewsletterSource,
} from '../supabase/newsletter';
import { exportUserData, downloadJson } from '../supabase/export';
import { isSupabaseConfigured } from '../supabase/client';
import { getLocaleDateString } from '../utils/date';
import { handleSignOut } from './auth';
import { setNewsletterStatus } from './profile';
import { tryStartPostLoginSequence } from './chat';
import type { LocaleContent } from '../content';
import { isImpersonating } from '../impersonation';
import {
  profileSetNewsletterSyncing,
  profileSetDataExport,
  profileSetDeletion,
} from '../app/profileState';


// ─── Account Deletion ───────────────────────────────────────────────────────

export const requestAccountDeletion = async (locale: LocaleContent) => {
  if (isImpersonating()) return;
  const state = store.state;
  if (!state.userId || !state.isAuthenticated) return;
  if (typeof window === 'undefined' ||
      !window.confirm(locale.settings.sections.privacy.deleteConfirmation)) {
    return;
  }

  const ps = state.profile;
  profileSetNewsletterSyncing(ps, true);
  store.notify();

  try {
    const timestamp = new Date().toISOString();
    await persistProfilePreferences({
      userId: state.userId,
      pendingDeletion: true,
      deletionRequestedAt: timestamp,
    });
    const scheduledMessage =
      locale.settings.sections.privacy.deleteScheduledInfo.replace(
        '{{date}}',
        getLocaleDateString(Date.parse(timestamp), state.localeKey) ?? '30 days',
      );
    alert(scheduledMessage);
    profileSetDeletion(ps, true, Date.parse(timestamp));
    store.notify();
    await handleSignOut();
  } catch (error) {
    console.error('[settings] Account deletion request failed', error);
    alert('Unable to schedule account deletion right now. Please try again.');
  } finally {
    profileSetNewsletterSyncing(ps, false);
    store.notify();
  }
};

// ─── Data Export ─────────────────────────────────────────────────────────────

export const handleDataExport = async (locale: LocaleContent) => {
  const state = store.state;
  const ps = state.profile;
  if (!state.userId || !state.isAuthenticated ||
      ps.dataExportInFlight || ps.dataExportStatus !== 'idle') {
    return;
  }

  profileSetDataExport(ps, 'started', true);
  store.notify();

  try {
    const exportPayload = await exportUserData({ userId: state.userId });
    const filename = `planai-export-${new Date().toISOString().split('T')[0]}.json`;
    downloadJson(exportPayload, filename);
    profileSetDataExport(ps, 'done', false);
  } catch (error) {
    console.error('[settings] Data export failed', error);
    alert(locale.settings.sections.privacy.requestDataError);
    profileSetDataExport(ps, 'idle', false);
  } finally {
    store.notify();
  }
};

// ─── Newsletter ──────────────────────────────────────────────────────────────

export const persistNewsletterChoice = async (
  choice: 'yes' | 'no',
  source: NewsletterSource,
): Promise<boolean> => {
  if (isImpersonating()) return true;
  const subscribe = choice === 'yes';
  const state = store.state;
  if (!state.userId) return false;
  if (!isSupabaseConfigured) {
    setNewsletterStatus(subscribe ? 'subscribed' : 'unsubscribed');
    tryStartPostLoginSequence();
    return true;
  }

  const ps = state.profile;
  profileSetNewsletterSyncing(ps, true);
  store.notify();

  try {
    await persistNewsletterPreference({
      userId: state.userId,
      localeKey: state.localeKey,
      subscribe,
      source,
    });
    setNewsletterStatus(subscribe ? 'subscribed' : 'unsubscribed');
    tryStartPostLoginSequence();
    return true;
  } catch (error) {
    console.error('[supabase] Failed to persist newsletter preference', error);
    return false;
  } finally {
    profileSetNewsletterSyncing(ps, false);
    store.notify();
  }
};

export const handleSettingsNewsletterToggle = (checked: boolean) => {
  const choice = checked ? 'yes' : 'no';
  const targetStatus = checked ? 'subscribed' : 'unsubscribed';
  if (store.state.profile.newsletterStatus === targetStatus) return;
  void persistNewsletterChoice(choice, 'settings_overlay').then((didPersist) => {
    if (!didPersist) store.notify();
  });
};
