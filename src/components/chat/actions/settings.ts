/**
 * Settings Actions
 *
 * Handles user settings operations:
 * - Newsletter subscription toggle
 * - Account deletion request
 * - Data export (GDPR compliance)
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
import { tryStartPostLoginSequence } from './chat';
import type { LocaleContent } from '../content';

// ─────────────────────────────────────────────────────────────────────────────
// State Update Helpers
// ─────────────────────────────────────────────────────────────────────────────
const setAccountDeletionState = (
  pending: boolean,
  requestedAt: number | null,
) => {
  store.state.accountDeletion.pending = pending;
  store.state.accountDeletion.requestedAt = requestedAt;
  store.notify();
};

const setNewsletterSyncing = (value: boolean) => {
  if (store.state.newsletterPreference.isSyncing === value) {
    return;
  }
  store.state.newsletterPreference.isSyncing = value;
  store.notify();
};

const setDataExportInFlight = (value: boolean) => {
  if (store.state.isDataExportInFlight === value) {
    return;
  }
  store.state.isDataExportInFlight = value;
  store.notify();
};

const setDataExportStatus = (status: 'idle' | 'started' | 'done') => {
  if (store.state.dataExportStatus === status) {
    return;
  }
  store.state.dataExportStatus = status;
  store.notify();
};

const setNewsletterStatus = (
  status: 'unknown' | 'subscribed' | 'unsubscribed',
) => {
  const state = store.state;
  if (state.newsletterPreference.status === status) {
    return;
  }
  state.newsletterPreference.status = status;
  state.newsletterPreference.lastUpdatedAt =
    status === 'unknown' ? null : Date.now();
  store.notify();
  if (status !== 'unknown') {
    tryStartPostLoginSequence();
  }
};

export const requestAccountDeletion = async (locale: LocaleContent) => {
  const state = store.state;
  if (!state.userId || !state.isAuthenticated) {
    return;
  }
  if (
    typeof window === 'undefined' ||
    !window.confirm(locale.settings.sections.privacy.deleteConfirmation)
  ) {
    return;
  }
  setNewsletterSyncing(true);
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
        getLocaleDateString(Date.parse(timestamp), state.localeKey) ??
          '30 days',
      );
    alert(scheduledMessage);
    setAccountDeletionState(true, Date.parse(timestamp));
    await handleSignOut();
  } catch (error) {
    console.error('[settings] Account deletion request failed', error);
    alert('Unable to schedule account deletion right now. Please try again.');
  } finally {
    setNewsletterSyncing(false);
  }
};

export const handleDataExport = async (locale: LocaleContent) => {
  const state = store.state;
  if (
    !state.userId ||
    !state.isAuthenticated ||
    state.isDataExportInFlight ||
    state.dataExportStatus !== 'idle'
  ) {
    return;
  }
  setDataExportInFlight(true);
  setDataExportStatus('started');
  try {
    const exportPayload = await exportUserData({
      userId: state.userId,
    });
    const filename = `planai-export-${
      new Date().toISOString().split('T')[0]
    }.json`;
    downloadJson(exportPayload, filename);
    setDataExportStatus('done');
  } catch (error) {
    console.error('[settings] Data export failed', error);
    alert(locale.settings.sections.privacy.requestDataError);
    setDataExportStatus('idle');
  } finally {
    setDataExportInFlight(false);
  }
};

export const persistNewsletterChoice = async (
  choice: 'yes' | 'no',
  source: NewsletterSource,
): Promise<boolean> => {
  const subscribe = choice === 'yes';
  const state = store.state;
  if (!state.userId) {
    return false;
  }
  if (!isSupabaseConfigured) {
    setNewsletterStatus(subscribe ? 'subscribed' : 'unsubscribed');
    return true;
  }
  setNewsletterSyncing(true);
  try {
    await persistNewsletterPreference({
      userId: state.userId,
      localeKey: state.localeKey,
      subscribe,
      source,
    });
    setNewsletterStatus(subscribe ? 'subscribed' : 'unsubscribed');
    return true;
  } catch (error) {
    console.error('[supabase] Failed to persist newsletter preference', error);
    return false;
  } finally {
    setNewsletterSyncing(false);
  }
};

export const handleSettingsNewsletterToggle = (checked: boolean) => {
  const choice = checked ? 'yes' : 'no';
  const targetStatus = checked ? 'subscribed' : 'unsubscribed';
  if (store.state.newsletterPreference.status === targetStatus) {
    return;
  }
  void persistNewsletterChoice(choice, 'settings_overlay').then(
    (didPersist) => {
      if (!didPersist) {
        store.notify();
      }
    },
  );
};
