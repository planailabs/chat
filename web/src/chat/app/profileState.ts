/**
 * Profile State Machine
 *
 * Manages the lifecycle of the user's profile settings:
 *   idle → loading → ready | error
 *
 * Single source of truth for:
 * - Newsletter subscription status
 * - Account deletion status
 * - Data export status
 *
 * All mutations go through typed transitions.
 */

import type { Profile } from '../api';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProfilePhase = 'idle' | 'loading' | 'ready' | 'error';

export type NewsletterStatus = 'unknown' | 'subscribed' | 'unsubscribed';

export type DataExportStatus = 'idle' | 'started' | 'done';

export interface ProfileState {
  phase: ProfilePhase;
  newsletterStatus: NewsletterStatus;
  newsletterSyncing: boolean;
  deletionPending: boolean;
  deletionRequestedAt: number | null;
  dataExportStatus: DataExportStatus;
  dataExportInFlight: boolean;
  error: string | null;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export const createProfileState = (): ProfileState => ({
  phase: 'idle',
  newsletterStatus: 'unknown',
  newsletterSyncing: false,
  deletionPending: false,
  deletionRequestedAt: null,
  dataExportStatus: 'idle',
  dataExportInFlight: false,
  error: null,
});

// ─── Transitions ────────────────────────────────────────────────────────────

export const profileStartLoading = (ps: ProfileState): void => {
  ps.phase = 'loading';
  ps.error = null;
};

export const profileLoadSuccess = (ps: ProfileState, profile: Profile): void => {
  ps.phase = 'ready';
  ps.error = null;
  ps.newsletterStatus = profile.newsletter_opt_in ? 'subscribed' : 'unsubscribed';
  const requestedAt = profile.deletion_requested_at ? Date.parse(profile.deletion_requested_at) : NaN;
  profileSetDeletion(ps, profile.deletion_requested_at !== null, Number.isNaN(requestedAt) ? null : requestedAt);
};

export const profileLoadError = (ps: ProfileState, error: string): void => {
  ps.phase = 'error';
  ps.error = error;
};

export const profileSetNewsletter = (ps: ProfileState, status: NewsletterStatus): void => {
  ps.newsletterStatus = status;
};

export const profileSetNewsletterSyncing = (ps: ProfileState, syncing: boolean): void => {
  ps.newsletterSyncing = syncing;
};

export const profileSetDataExport = (ps: ProfileState, status: DataExportStatus, inFlight: boolean): void => {
  ps.dataExportStatus = status;
  ps.dataExportInFlight = inFlight;
};

export const profileSetDeletion = (ps: ProfileState, pending: boolean, requestedAt: number | null): void => {
  ps.deletionPending = pending;
  ps.deletionRequestedAt = requestedAt;
};
