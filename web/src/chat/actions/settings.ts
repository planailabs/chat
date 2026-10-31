/**
 * Settings Actions
 *
 * - Newsletter subscription toggle
 * - Account deletion request
 * - Data export (GDPR)
 *
 * State transitions go through the profile state machine.
 */

import { store } from '../app/store';
import { api } from '../api';
import type { LocaleContent } from '../content';
import { getLocaleDateString } from '../utils/date';
import { downloadJson } from '../utils/download';
import { profileSetDataExport, profileSetDeletion, profileSetNewsletterSyncing } from '../app/profileState';
import { handleSignOut } from './auth';
import { persistNewsletterChoice } from './profile';

// ─── Account Deletion ───────────────────────────────────────────────────────

export const requestAccountDeletion = async (locale: LocaleContent) => {
  const state = store.state;
  if (!state.isAuthenticated || state.impersonating) return;
  if (!window.confirm(locale.settings.sections.privacy.deleteConfirmation)) return;

  const ps = state.profile;
  profileSetNewsletterSyncing(ps, true);
  store.notify();

  try {
    await api.profile.requestDeletion();
  } catch (error) {
    console.error('[settings] Account deletion request failed', error);
    alert(locale.settings.sections.privacy.deleteError);
    profileSetNewsletterSyncing(ps, false);
    store.notify();
    return;
  }
  const requestedAt = Date.now();
  profileSetDeletion(ps, true, requestedAt);
  profileSetNewsletterSyncing(ps, false);
  store.notify();
  alert(
    locale.settings.sections.privacy.deleteScheduledInfo.replace(
      '{{date}}',
      getLocaleDateString(requestedAt, state.localeKey) ?? '30 days',
    ),
  );
  handleSignOut();
};

// ─── Data Export ────────────────────────────────────────────────────────────

export const handleDataExport = async (locale: LocaleContent) => {
  const state = store.state;
  const ps = state.profile;
  if (!state.isAuthenticated || ps.dataExportInFlight || ps.dataExportStatus !== 'idle') return;

  profileSetDataExport(ps, 'started', true);
  store.notify();

  try {
    const data = await api.profile.export();
    downloadJson(data, `planai-export-${new Date().toISOString().split('T')[0]}.json`);
    profileSetDataExport(ps, 'done', false);
  } catch (error) {
    console.error('[settings] Data export failed', error);
    alert(locale.settings.sections.privacy.requestDataError);
    profileSetDataExport(ps, 'idle', false);
  } finally {
    store.notify();
  }
};

// ─── Newsletter ─────────────────────────────────────────────────────────────

export const handleSettingsNewsletterToggle = (checked: boolean) => {
  const targetStatus = checked ? 'subscribed' : 'unsubscribed';
  if (store.state.profile.newsletterStatus === targetStatus) return;
  // On failure (or while impersonating) the re-render restores the toggle.
  void persistNewsletterChoice(checked, 'settings').then((saved) => {
    if (!saved) store.notify();
  });
};
