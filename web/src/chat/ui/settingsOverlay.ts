/**
 * Settings Overlay Component
 *
 * Renders the settings modal with:
 * - User profile section (avatar, name, email)
 * - Newsletter subscription toggle
 * - Privacy controls (data export, account deletion)
 * - Sign out button
 */

import type { AppState } from '../app/state';
import type { LocaleContent } from '../content';
import { escapeHtml } from '../utils/html';
import { getLocaleDateString } from '../utils/date';
import { planLogoSvg } from './planLogo';

/** Placeholder user icon for users without avatars */
const userIcon = () => `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" fill="currentColor" />
    <path
      d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
`;

export const renderSettingsOverlay = (params: {
  state: AppState;
  locale: LocaleContent;
}) => {
  const { state, locale } = params;
  if (!state.isSettingsOverlayOpen) {
    return '';
  }
  const displayName =
    state.userDisplayName?.trim() ||
    state.userEmail ||
    locale.settings.sections.profile.fields.name;
  const email = state.userEmail ?? 'Not signed in';
  // Avatar with error fallback: if image fails, show SVG icon instead
  // referrerpolicy="no-referrer" is required for Google avatars (they block unknown referrers)
  const avatar = state.userAvatarUrl
    ? `<img
        src="${escapeHtml(state.userAvatarUrl)}"
        alt="${escapeHtml(email)}"
        decoding="async"
        loading="eager"
        referrerpolicy="no-referrer"
        onload="this.parentElement.dataset.loaded='true'"
        onerror="this.parentElement.dataset.error='true'"
      />
      <span class="settings-avatar-fallback" aria-hidden="true">${userIcon()}</span>`
    : `<span class="settings-avatar-fallback">${userIcon()}</span>`;
  const closeLabel = 'Close overlay';
  const signOutDisabled = state.isAuthenticated ? '' : 'disabled';
  const profileSection = locale.settings.sections.profile;
  const privacySection = locale.settings.sections.privacy;
  const newsletterField = profileSection.fields.newsletter;
  const { profile } = state;
  const newsletterChecked =
    profile.newsletterStatus === 'subscribed' && state.isAuthenticated;
  const newsletterDisabled =
    !state.isAuthenticated || profile.newsletterSyncing;
  const profileStatusLabel = profile.newsletterSyncing
    ? `${locale.settings.savedLabel.replace('Saved', 'Saving')}…`
    : '';
  const dataExportDisabled =
    !state.isAuthenticated ||
    profile.dataExportInFlight ||
    profile.dataExportStatus !== 'idle';
  const requestDataLabel =
    profile.dataExportStatus === 'started'
      ? privacySection.requestDataStarted
      : profile.dataExportStatus === 'done'
        ? privacySection.requestDataDone
        : privacySection.requestData;
  const deletionDisabled =
    !state.isAuthenticated || profile.deletionPending;
  const formattedDeletionDate = getLocaleDateString(
    profile.deletionRequestedAt,
    state.localeKey,
  );
  const deletionNotice = profile.deletionPending
    ? privacySection.deleteScheduledInfo.replace(
        '{{date}}',
        formattedDeletionDate ?? '30 days',
      )
    : '';

  return `
    <div class="settings-overlay" data-settings-root>
      <button class="settings-overlay__backdrop" data-action="close-settings" aria-label="${escapeHtml(closeLabel)}"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(locale.settings.title)}">
        <button type="button" class="settings-close-button" data-action="close-settings" aria-label="Close">
          <span aria-hidden="true">&times;</span>
        </button>
        <div class="settings-identity">
          <div class="settings-avatar">
            ${avatar}
          </div>
          <div class="settings-identity__text">
            <p class="settings-display-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</p>
            <p class="settings-email" title="${escapeHtml(email)}">${escapeHtml(email)}</p>
          </div>
        </div>
        <div class="settings-divider" aria-hidden="true"></div>
        <section class="settings-section">
          <header class="settings-section__header">
            <p class="settings-section__title">${escapeHtml(
              profileSection.title,
            )}</p>
            ${
              profileStatusLabel
                ? `<span class="settings-section__status">${escapeHtml(
                    profileStatusLabel,
                  )}</span>`
                : ''
            }
          </header>
          <label class="settings-toggle">
            <input
              type="checkbox"
              class="settings-toggle__input"
              data-setting="newsletter-opt-in"
              ${newsletterChecked ? 'checked' : ''}
              ${newsletterDisabled ? 'disabled' : ''}
            />
            <span class="settings-toggle__icon" aria-hidden="true">
              ${
                newsletterChecked
                  ? planLogoSvg({ class: 'settings-toggle__logo' })
                  : ''
              }
            </span>
            <span>${escapeHtml(newsletterField)}</span>
          </label>
        </section>
        <div class="settings-divider" aria-hidden="true"></div>
        <section class="settings-section settings-privacy">
          <header class="settings-section__header">
            <p class="settings-section__title">${escapeHtml(
              privacySection.title,
            )}</p>
          </header>
          <div class="settings-privacy-actions">
            <button
              type="button"
              class="pill-button settings-action-button"
              data-action="request-data"
              ${dataExportDisabled ? 'disabled' : ''}
            >
              ${escapeHtml(requestDataLabel)}
            </button>
            <button
              type="button"
              class="pill-button settings-action-button is-danger"
              data-action="delete-account"
              ${deletionDisabled ? 'disabled' : ''}
            >
              ${escapeHtml(privacySection.deleteAccount)}
            </button>
          </div>
          ${
            deletionNotice
              ? `<p class="settings-privacy-inline-status">${escapeHtml(
                  deletionNotice,
                )}</p>`
              : ''
          }
        </section>
        <div class="settings-divider" aria-hidden="true"></div>
        <div class="settings-actions">
          <button type="button" class="pill-button" data-action="overlay-sign-out" ${signOutDisabled}>
            ${escapeHtml(locale.navigation.loginMenu.signOutLabel)}
          </button>
        </div>
      </section>
    </div>
  `;
};
