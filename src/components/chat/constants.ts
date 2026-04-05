/**
 * Application-wide constants
 *
 * Centralizes magic numbers, storage keys, and configuration values
 * to improve maintainability and prevent inconsistencies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Application Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const APP_NAME = 'plan.ai';
export const APP_VERSION = 'v0.7.3';

// ─────────────────────────────────────────────────────────────────────────────
// Storage Keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys used for sessionStorage.
 * Note: This app uses sessionStorage only (no localStorage or cookies)
 * per privacy requirements documented in INFO.md
 */
export const STORAGE_KEYS = {
  /** Theme mode preference (system | light | dark) */
  THEME: 'planai-theme-mode',
  /** Selected language locale */
  LANGUAGE: 'planai-language',
  /** Pre-auth state cache for OAuth flow restoration */
  PRE_AUTH_CACHE: 'planai-preauth-cache',
  /** Supabase auth session (managed by Supabase client) */
  SUPABASE_AUTH: 'planai-supabase-auth',
  /** Cached user state for instant header render (prevents layout shift) */
  USER_CACHE: 'planai-user-cache',
  /** Anonymous sales prompt saved for post-login send */
  PENDING_SALES_PROMPT: 'planai-pending-sales-prompt',
  /** Machine config chat conversation history (legacy, aliased to AI_CHAT with machine_config mode) */
  MACHINE_CONFIG_CHAT: 'planai-machine-config-chat',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Per-mode storage key for chat conversation cache */
export const chatStorageKey = (modeId: string): string =>
  modeId === 'machine_config' ? STORAGE_KEYS.MACHINE_CONFIG_CHAT : `planai-chat-${modeId}`;

/** Chat mode IDs available on the client */
export type ClientChatModeId = 'machine_config' | 'sales';

// ─────────────────────────────────────────────────────────────────────────────
// Theme Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const THEME = {
  DARK: {
    BACKGROUND: '#1e1e1e',
    TEXT: '#dadada',
  },
  LIGHT: {
    BACKGROUND: '#fcfcfc',
    TEXT: '#222222',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Composer Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const COMPOSER = {
  /** Default maximum character limit */
  MAX_CHARS: 1024,
  /** Maximum height in pixels before scrolling */
  MAX_HEIGHT: 200,
  /** Minimum height (single line) in pixels */
  MIN_HEIGHT: 24,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Animation Timings (in milliseconds)
// ─────────────────────────────────────────────────────────────────────────────

export const TIMING = {
  /** Default streaming configuration */
  STREAM: {
    INITIAL_DELAY: 480,
    CHUNK_SIZE: 3,
    INTERVAL: 28,
  },
  /** CTA reveal delay after stream completes */
  CTA_REVEAL_DELAY: 200,
  /** Newsletter CTA reveal delay */
  NEWSLETTER_CTA_DELAY: 250,
  /** Hero transition fade timing */
  HERO_FADE: 50,
  /** App fade-in animation duration */
  APP_FADE_IN: 1200,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Retry Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const RETRY = {
  /** Maximum number of retry attempts for API calls */
  MAX_ATTEMPTS: 3,
  /** Base delay between retries (exponential backoff) */
  BASE_DELAY_MS: 180,
  /** HTTP status codes that warrant a retry */
  RETRYABLE_STATUS_CODES: [408, 425, 429, 500, 502, 503, 504] as const,
  /** PostgREST error codes that warrant a retry */
  RETRYABLE_POSTGREST_CODES: ['PGRST116', 'PGRST518', '57014'] as const,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Provider Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps our internal provider names to Supabase provider identifiers.
 * microsoft -> azure is required by Supabase's naming convention.
 */
export const OAUTH_PROVIDER_MAP = {
  google: 'google',
  apple: 'apple',
  github: 'github',
  microsoft: 'azure',
} as const;

export type OAuthProvider = keyof typeof OAUTH_PROVIDER_MAP;
export type SupabaseProvider =
  (typeof OAUTH_PROVIDER_MAP)[keyof typeof OAUTH_PROVIDER_MAP];

// ─────────────────────────────────────────────────────────────────────────────
// User Metadata Keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys to search in OAuth user metadata for display name.
 * Order matters - first match wins.
 */
export const USER_METADATA_NAME_KEYS = [
  'full_name',
  'name',
  'user_name',
  'preferred_username',
  'given_name',
] as const;

/**
 * Keys to search in OAuth user metadata for avatar URL.
 */
export const USER_METADATA_AVATAR_KEYS = ['avatar_url', 'picture'] as const;
