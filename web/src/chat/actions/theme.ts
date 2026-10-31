/**
 * Theme Actions
 *
 * Handles theme mode switching (system/light/dark):
 * - Applies theme to document
 * - Persists to sessionStorage
 * - Saves to the user's profile (if signed in)
 * - Listens for system preference changes
 */

import { ref } from 'vue';
import { store } from '../app/store';
import type { ThemeMode } from '../app/state';
import { STORAGE_KEYS } from '../constants';
import { persistThemePreference } from './profile';

// ─────────────────────────────────────────────────────────────────────────────
// System Preference Detection
// ─────────────────────────────────────────────────────────────────────────────

/** Media query for detecting system dark mode preference */
const prefersDark =
  typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

const getSystemPreference = (): 'light' | 'dark' =>
  prefersDark?.matches ? 'dark' : 'light';

/** The system's color scheme (follows changes). */
export const systemTheme = ref(getSystemPreference());

const applyDocumentTheme = (theme: 'light' | 'dark') => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
};

export const initTheme = () => {
  // 1. Read from storage or default
  let mode: ThemeMode = 'system';
  try {
    const stored = sessionStorage.getItem(STORAGE_KEYS.THEME);
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      mode = stored;
    }
  } catch {
    // Ignore storage errors
  }

  // 2. Set initial state
  store.setState({ themeMode: mode });

  // 3. Apply to DOM immediately
  const effective = mode === 'system' ? getSystemPreference() : mode;
  applyDocumentTheme(effective);

  // 4. Listen for system changes
  prefersDark?.addEventListener('change', () => {
    systemTheme.value = getSystemPreference();
    if (store.state.themeMode === 'system') applyDocumentTheme(systemTheme.value);
  });
};

/** Shows and remembers a theme for this session (the profile's, on load). */
export const applyThemeMode = (mode: ThemeMode) => {
  store.setState({ themeMode: mode });
  applyDocumentTheme(mode === 'system' ? getSystemPreference() : mode);
  try {
    sessionStorage.setItem(STORAGE_KEYS.THEME, mode);
  } catch {
    // Ignore storage errors
  }
};

/** The user picked a theme: also saved to their profile. */
export const setThemeMode = (mode: ThemeMode) => {
  applyThemeMode(mode);
  persistThemePreference(mode);
};

export const cycleThemeMode = () => {
  const current = store.state.themeMode;
  const systemPref = getSystemPreference();
  // Order: Light -> Dark -> System -> Light... (adjusted based on current system)
  // If system is Dark: System(Dark) -> Light -> Dark -> System
  // If system is Light: System(Light) -> Dark -> Light -> System

  // Simplified rotation for clarity:
  // If System (Dark) -> Light
  // If System (Light) -> Dark
  // If Light -> Dark
  // If Dark -> System

  let next: ThemeMode;

  if (current === 'system') {
    next = systemPref === 'dark' ? 'light' : 'dark';
  } else if (current === 'light') {
    next = 'dark';
  } else {
    next = 'system';
  }

  setThemeMode(next);
};
