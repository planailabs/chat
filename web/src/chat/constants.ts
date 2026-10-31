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
  /** Anonymous prompt saved for sending to the sales chat after sign-in */
  PENDING_SALES_PROMPT: 'planai-pending-sales-prompt',
  /** Prefix of the per-user, per-mode chat message cache */
  CHAT_PREFIX: 'planai-chat-',
} as const;
