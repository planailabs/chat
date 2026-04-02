/**
 * Header Component
 *
 * Renders the application header with:
 * - Logo and version badge
 * - Theme toggle
 * - Language selector dropdown
 * - Authentication controls (sign in / user menu)
 */

import {
  locales,
  supportedLocales,
  type LocaleKey,
  type LocaleContent,
} from '../content';
import type { AppState } from '../app/state';
import { getOAuthIcon } from './oauthIcons';
import { escapeHtml } from '../utils/html';
import { store } from '../app/store';
import { APP_VERSION, type ClientChatModeId } from '../constants';

/**
 * Counter for unique SVG mask IDs to prevent DOM conflicts.
 * Uses modulo to prevent unbounded growth in long-running sessions.
 */
let globeMaskCounter = 0;
const MAX_MASK_ID = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// Theme Utilities
// ─────────────────────────────────────────────────────────────────────────────

type ColorScheme = 'light' | 'dark';

const getSystemPreference = (): ColorScheme => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────────────────────

const ICON_CLASS = 'icon-size';

/** Theme toggle icon - visual state reflects current mode */
const getThemeIconSvg = (): string => {
  const currentMode = store.state.themeMode;
  const systemPref = getSystemPreference();
  const firstManual = systemPref === 'dark' ? 'light' : 'dark';

  // System mode: half-filled circle
  if (currentMode === 'system') {
    return `<svg class="${ICON_CLASS}" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>
    </svg>`;
  }

  // First manual mode (opposite of system): empty circle
  if (currentMode === firstManual) {
    return `<svg class="${ICON_CLASS}" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`;
  }

  // Second manual mode: filled circle
  return `<svg class="${ICON_CLASS}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8" fill="currentColor" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;
};

/** Language/globe icon with masked cutout for globe effect */
const getLanguageIconSvg = (): string => {
  globeMaskCounter = (globeMaskCounter + 1) % MAX_MASK_ID;
  const maskId = `globe-cutout-${globeMaskCounter}`;
  return `<svg class="${ICON_CLASS}" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <mask id="${maskId}">
        <rect width="24" height="24" fill="white"/>
        <ellipse cx="12" cy="12" rx="8" ry="11" fill="black"/>
        <ellipse cx="12" cy="12" rx="5" ry="9" fill="white"/>
        <rect x="2" y="11" width="20" height="2" fill="black"/>
      </mask>
    </defs>
    <circle cx="12" cy="12" r="10" fill="currentColor" mask="url(#${maskId})"/>
  </svg>`;
};

/** User avatar placeholder icon */
const getUserIconSvg =
  (): string => `<svg class="${ICON_CLASS}" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="8" r="3.5" fill="currentColor"/>
  <path d="M5 19c0-3.032 2.686-5 7-5s7 1.968 7 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

// ─────────────────────────────────────────────────────────────────────────────
// Dropdown Renderers
// ─────────────────────────────────────────────────────────────────────────────

interface LanguageOption {
  key: LocaleKey;
  name: string;
}

const getLanguageOptions = (): LanguageOption[] =>
  supportedLocales.map((key) => ({
    key,
    name: locales[key].languageNativeName,
  }));

const CHECK_ICON_SVG = `<svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 12.5l3.5 3.5 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const renderLanguageOptions = (currentLocale: LocaleKey): string =>
  getLanguageOptions()
    .map(({ key, name }) => {
      const isSelected = currentLocale === key;
      return `<button
        type="button"
        class="dropdown-option"
        data-action="language-select"
        data-locale="${key}"
        role="menuitemradio"
        aria-checked="${isSelected}">
        <span>${name}</span>
        ${isSelected ? CHECK_ICON_SVG : ''}
      </button>`;
    })
    .join('');

const renderAuthOptions = (locale: LocaleContent): string =>
  Object.entries(locale.navigation.loginMenu.providers)
    .map(([provider, label]) => {
      const icon = getOAuthIcon(provider);
      return `<button
        type="button"
        class="dropdown-option"
        data-action="oauth-provider"
        data-provider="${provider}"
        role="menuitem">
        <span class="dropdown-option__icon" aria-hidden="true">${icon}</span>
        <span>${escapeHtml(label)}</span>
      </button>`;
    })
    .join('');

// ─────────────────────────────────────────────────────────────────────────────
// Mode Switcher
// ─────────────────────────────────────────────────────────────────────────────

interface ChatModeOption {
  id: ClientChatModeId;
  label: string;
  requiresToken: boolean;
}

const getModeOptions = (locale: LocaleContent): ChatModeOption[] => [
  { id: 'machine_config', label: locale.chatModes.machine_config.heroBadgeLabel, requiresToken: true },
  { id: 'sales', label: locale.chatModes.sales.heroBadgeLabel, requiresToken: false },
];

const renderModeSwitcher = (locale: LocaleContent, state: AppState): string => {
  if (!state.isAuthenticated) return '';

  const options = getModeOptions(locale).filter(
    (opt) => !opt.requiresToken || state.customerToken,
  );

  // Don't show switcher if only one option available
  if (options.length <= 1) return '';

  const currentLabel = options.find((o) => o.id === state.activeChatMode)?.label ?? options[0].label;

  const optionButtons = options
    .map((opt) => {
      const isSelected = state.activeChatMode === opt.id;
      return `<button
        type="button"
        class="dropdown-option"
        data-action="switch-chat-mode"
        data-mode="${opt.id}"
        role="menuitemradio"
        aria-checked="${isSelected}">
        <span>${escapeHtml(opt.label)}</span>
        ${isSelected ? CHECK_ICON_SVG : ''}
      </button>`;
    })
    .join('');

  return `<div class="relative" data-menu="mode-switcher">
    <button
      class="pill-button pill-button--mode"
      type="button"
      data-action="mode-switcher-toggle"
      aria-haspopup="menu">
      ${escapeHtml(currentLabel)}
    </button>
    <div class="dropdown-panel dropdown-panel--mode hidden" role="menu" data-mode-dropdown>
      <div class="flex flex-col gap-1">${optionButtons}</div>
    </div>
  </div>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Header Component
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderParams {
  locale: LocaleContent;
  state: AppState;
}

/** Plan.ai logo SVG */
const LOGO_SVG = `<svg class="${ICON_CLASS}" viewBox="-8 -8 299.465 299.465" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <path fill="currentColor" fill-rule="evenodd" d="M274.603,92.329c5.73,15.386 8.862,32.032 8.862,49.403c0,78.224 -63.509,141.733 -141.733,141.733c-78.224,0 -141.732,-63.509 -141.732,-141.733c0,-78.224 63.508,-141.732 141.732,-141.732c39.909,0 75.988,16.531 101.756,43.112l-100.658,100.659l-39.103,-39.103c-5.531,-5.531 -14.512,-5.531 -20.044,0l-20.044,20.044c-5.531,5.531 -5.531,14.512 0,20.044l69.227,69.227l0.02,0.019c5.531,5.531 14.513,5.531 20.044,0l0.019,-0.019l121.654,-121.654Z"/>
</svg>`;

const buildClassList = (...classes: (string | false | undefined)[]): string =>
  classes.filter(Boolean).join(' ');

export const renderHeader = ({ locale, state }: HeaderParams): string => {
  const { navigation } = locale;

  // Build conditional class lists
  const languageToggleClasses = buildClassList(
    'icon-button',
    !state.isLanguageMenuOpen && 'tooltip',
  );

  const avatarToggleClasses = buildClassList(
    'icon-button',
    'avatar-button',
    !state.isAuthMenuOpen && 'tooltip',
  );

  // Build tooltip attributes (only when menu is closed)
  const languageTooltipAttr = state.isLanguageMenuOpen
    ? ''
    : `data-tooltip="${navigation.languageMenu.tooltip}"`;

  const avatarTooltipAttr = state.isAuthMenuOpen
    ? ''
    : `data-tooltip="${escapeHtml(navigation.settingsLabel)}"`;

  // Avatar content: user image with fallback on error, or default icon
  // The fallback SVG is always present but hidden; shown via CSS when image fails
  // referrerpolicy="no-referrer" is required for Google avatars (they block unknown referrers)
  const avatarContent = state.userAvatarUrl
    ? `<span class="avatar-shell">
        <img
          src="${escapeHtml(state.userAvatarUrl)}"
          alt="${escapeHtml(navigation.settingsLabel)}"
          decoding="async"
          loading="eager"
          referrerpolicy="no-referrer"
          onload="this.parentElement.dataset.loaded='true'"
          onerror="this.parentElement.dataset.error='true'"
        />
        <span class="avatar-fallback-icon" aria-hidden="true">${getUserIconSvg()}</span>
      </span>`
    : `<span class="avatar-shell avatar-fallback">${getUserIconSvg()}</span>`;

  // Dropdown menus
  const languageDropdown = state.isLanguageMenuOpen
    ? `<div class="dropdown-panel" role="menu">
        <div class="flex flex-col gap-1">${renderLanguageOptions(state.localeKey)}</div>
      </div>`
    : '';

  const authDropdown = !state.isAuthMenuOpen
    ? ''
    : state.isAuthenticated
      ? `<div class="dropdown-panel" role="menu">
          <div class="flex flex-col gap-1">
            <button type="button" class="dropdown-option" data-action="settings-link">
              <span>${navigation.settingsLabel}</span>
            </button>
            ${
              state.isAdmin
                ? `<a href="/dashboard/" class="dropdown-option" data-action="dashboard-link">
                    <span>Dashboard</span>
                   </a>`
                : ''
            }
            <button type="button" class="dropdown-option" data-action="sign-out">
              <span>${navigation.loginMenu.signOutLabel}</span>
            </button>
          </div>
        </div>`
      : `<div class="dropdown-panel" role="menu">
          <div class="dropdown-header">${navigation.loginMenu.title}</div>
          <div class="dropdown-divider"></div>
          <div class="flex flex-col gap-1">${renderAuthOptions(locale)}</div>
        </div>`;

  // Auth button: avatar for authenticated, sign-in pill for guests
  const authButton = state.isAuthenticated
    ? `<button
        class="${avatarToggleClasses}"
        type="button"
        data-action="user-menu-toggle"
        aria-haspopup="menu"
        aria-expanded="${state.isAuthMenuOpen}"
        ${avatarTooltipAttr}>
        ${avatarContent}
      </button>`
    : `<button
        class="pill-button"
        type="button"
        data-action="auth-toggle"
        aria-haspopup="menu"
        aria-expanded="${state.isAuthMenuOpen}">
        ${navigation.loginMenu.labelLoggedOut}
      </button>`;

  // Mobile: px-4 py-4, Desktop: px-8 py-6
  return `<header class="flex w-full items-center justify-between px-4 py-4 md:px-8 md:py-6">
    <a href="/" class="logo-link flex items-center gap-2 text-base font-semibold tracking-tight text-(--text-primary) md:text-lg focus-visible:underline">
      ${LOGO_SVG}
      <span class="flex items-baseline gap-2 leading-none">
        <span>plan.ai</span>
        <span class="text-[0.5em] font-bold text-(--text-muted)">${APP_VERSION}</span>
      </span>
    </a>

    <div class="flex items-center gap-3 text-sm text-(--text-muted) md:gap-[14px]">
      ${renderModeSwitcher(locale, state)}

      <div class="relative">
        <button
          class="icon-button tooltip"
          type="button"
          data-action="theme-toggle"
          data-tooltip="${navigation.themeToggle.tooltip}"
          aria-label="${navigation.themeToggle.label}">
          ${getThemeIconSvg()}
        </button>
      </div>

      <div class="relative" data-menu="language">
        <button
          class="${languageToggleClasses}"
          type="button"
          data-action="language-toggle"
          aria-label="${navigation.languageMenu.label}"
          aria-haspopup="menu"
          aria-expanded="${state.isLanguageMenuOpen}"
          ${languageTooltipAttr}>
          ${getLanguageIconSvg()}
        </button>
        ${languageDropdown}
      </div>

      <div class="relative" data-menu="auth">
        ${authButton}
        ${authDropdown}
      </div>
    </div>
  </header>`;
};
