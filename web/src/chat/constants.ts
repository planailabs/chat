/**
 * Application-wide constants
 */

export const APP_VERSION = 'v0.7.3';

/**
 * Keys used for browser storage. Everything lives in sessionStorage except
 * the pending prompt, which is mirrored to localStorage so it survives a
 * sign-in that opens in another tab (Android custom tabs).
 */
export const STORAGE_KEYS = {
  /** Theme mode preference (system | light | dark) */
  THEME: 'planai-theme-mode',
  /** Selected language locale */
  LANGUAGE: 'planai-language',
  /** Cached user state for instant header render (prevents layout shift) */
  USER_CACHE: 'planai-user-cache',
  /** Anonymous prompt, sent as a new conversation after sign-in */
  PENDING_PROMPT: 'planai-pending-prompt',
  /** Prefix of the per-user caches (conversation list, each conversation's messages) */
  CHAT_PREFIX: 'planai-chat-',
  /** Desktop sidebar collapsed (localStorage) */
  SIDEBAR_COLLAPSED: 'planai-sidebar-collapsed',
} as const;
