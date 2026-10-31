/**
 * Profile State Machine
 *
 * Manages the lifecycle of user profile data:
 *   idle → loading → ready | error
 *
 * Single source of truth for profile-derived state:
 * - Newsletter subscription status
 * - Customer token (mac-mgmt)
 * - Account deletion status
 * - Data export status
 * - User identity (email, name, avatar — overridden when impersonating)
 *
 * All mutations go through typed transitions. Persist operations are
 * no-ops when impersonating.
 */

import type { LocaleKey } from '../content';
import type { ThemeMode } from '../actions/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProfilePhase = 'idle' | 'loading' | 'ready' | 'error';

export type NewsletterStatus = 'unknown' | 'subscribed' | 'unsubscribed';

export type DataExportStatus = 'idle' | 'started' | 'done';

export interface ProfileData {
  language: LocaleKey | null;
  themePreference: ThemeMode | null;
  newsletterOptIn: boolean | null;
  customerToken: string | null;
  pendingDeletion: boolean;
  deletionRequestedAt: string | null;
  providerIdentity: Record<string, unknown>;
}

export interface ProfileState {
  /** Current phase of the profile state machine */
  phase: ProfilePhase;

  // ─── Identity (from provider_identity or auth session) ─────────────────
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;

  // ─── Newsletter ────────────────────────────────────────────────────────
  newsletterStatus: NewsletterStatus;
  newsletterSyncing: boolean;
  newsletterUpdatedAt: number | null;

  // ─── Customer Token ────────────────────────────────────────────────────
  customerToken: string | null;

  // ─── Account Deletion ──────────────────────────────────────────────────
  deletionPending: boolean;
  deletionRequestedAt: number | null;

  // ─── Data Export ───────────────────────────────────────────────────────
  dataExportStatus: DataExportStatus;
  dataExportInFlight: boolean;

  // ─── Error ─────────────────────────────────────────────────────────────
  error: string | null;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export const createProfileState = (): ProfileState => ({
  phase: 'idle',
  email: null,
  displayName: null,
  avatarUrl: null,
  newsletterStatus: 'unknown',
  newsletterSyncing: false,
  newsletterUpdatedAt: null,
  customerToken: null,
  deletionPending: false,
  deletionRequestedAt: null,
  dataExportStatus: 'idle',
  dataExportInFlight: false,
  error: null,
});

// ─── Transitions ────────────────────────────────────────────────────────────

/** Transition to loading phase */
export const profileStartLoading = (ps: ProfileState): void => {
  ps.phase = 'loading';
  ps.error = null;
};

/** Transition to ready phase with loaded data */
export const profileLoadSuccess = (
  ps: ProfileState,
  data: ProfileData,
  isImpersonating: boolean,
): void => {
  ps.phase = 'ready';
  ps.error = null;
  ps.customerToken = data.customerToken;

  // Identity from provider_identity (used when impersonating)
  if (isImpersonating && data.providerIdentity) {
    const pi = data.providerIdentity;
    if (typeof pi.email === 'string') ps.email = pi.email;
    if (typeof pi.name === 'string') ps.displayName = pi.name;
    if (typeof pi.avatar_url === 'string') ps.avatarUrl = pi.avatar_url;
  }

  // Newsletter
  if (typeof data.newsletterOptIn === 'boolean') {
    ps.newsletterStatus = data.newsletterOptIn ? 'subscribed' : 'unsubscribed';
    ps.newsletterUpdatedAt = Date.now();
  } else {
    ps.newsletterStatus = 'unknown';
  }

  // Deletion
  if (data.pendingDeletion) {
    ps.deletionPending = true;
    const parsed = data.deletionRequestedAt ? Date.parse(data.deletionRequestedAt) : null;
    ps.deletionRequestedAt = Number.isNaN(parsed ?? NaN) ? null : parsed;
  } else {
    ps.deletionPending = false;
    ps.deletionRequestedAt = null;
  }
};

/** Transition to error phase */
export const profileLoadError = (ps: ProfileState, error: string): void => {
  ps.phase = 'error';
  ps.error = error;
};

/** Update newsletter status */
export const profileSetNewsletter = (
  ps: ProfileState,
  status: NewsletterStatus,
): void => {
  ps.newsletterStatus = status;
  ps.newsletterUpdatedAt = status === 'unknown' ? null : Date.now();
};

/** Update newsletter syncing flag */
export const profileSetNewsletterSyncing = (
  ps: ProfileState,
  syncing: boolean,
): void => {
  ps.newsletterSyncing = syncing;
};

/** Update data export status */
export const profileSetDataExport = (
  ps: ProfileState,
  status: DataExportStatus,
  inFlight: boolean,
): void => {
  ps.dataExportStatus = status;
  ps.dataExportInFlight = inFlight;
};

/** Update deletion state */
export const profileSetDeletion = (
  ps: ProfileState,
  pending: boolean,
  requestedAt: number | null,
): void => {
  ps.deletionPending = pending;
  ps.deletionRequestedAt = requestedAt;
};
