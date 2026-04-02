/**
 * Application State Types and Initialization
 *
 * Defines the shape of global application state and provides
 * factory functions for creating initial state.
 *
 * State is divided into:
 * - UI state (menus, overlays, phases)
 * - User state (authentication, profile)
 * - Chat state (conversation, streaming)
 * - Preference state (theme, locale, newsletter)
 */

import {
  defaultLocale,
  supportedLocales,
  type LocaleKey,
  type ScenarioId,
  type StepCta,
  type StreamConfig,
} from '../content';
import { STORAGE_KEYS, type ClientChatModeId } from '../constants';
import { createProfileState, type ProfileState } from './profileState';

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Phases of the hero/composer section */
export type HeroPhase = 'composer' | 'fading' | 'chat';

/** Theme mode preference */
export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * Chat conversation state.
 * Tracks the current conversation, streaming state, and CTAs.
 */
export interface ChatState {
  /** The user's submitted prompt */
  userPrompt: string;
  /** Currently visible portion of assistant's response (for streaming) */
  assistantVisibleText: string;
  /** Full assistant response text */
  assistantFullText: string;
  /** Streaming configuration for this response */
  stream: StreamConfig;
  /** Whether the assistant response is currently streaming */
  isStreaming: boolean;
  /** Whether CTAs (call-to-action buttons) are visible */
  ctaVisible: boolean;
  /** Animation style for CTA reveal */
  ctaRevealStyle?: 'fade' | 'instant';
  /** Currently selected CTA (e.g., OAuth provider) */
  selectedCta?: string | null;
  /** Whether CTAs are locked (disabled during auth flow) */
  isCtaLocked?: boolean;
  /** Animation flag: user bubble just appeared */
  userBubbleJustAppeared?: boolean;
  /** Animation flag: assistant bubble just appeared */
  assistantBubbleJustAppeared?: boolean;
  /** Whether this chat was restored from pre-auth cache */
  restoredFromChatCta?: boolean;
  /** Current CTA configuration */
  cta?: StepCta;
  /** Current position in the conversation scenario */
  conversation?: {
    scenarioId: ScenarioId;
    stepId: string;
  };
  /** AI chat state (machine config, sales, newsletter, etc.) */
  aiChat?: {
    messages: Array<{ id?: string; role: 'user' | 'assistant' | 'cancel'; content: string }>;
    /**
     * State machine phase:
     *   idle      → composer visible
     *   waiting   → thinking indicator, waiting for server
     *   streaming → word-by-word reveal of assistant text
     *   tool      → executing a server-side tool (spinner indicator)
     *   question  → showing ask_question UI (buttons or text input)
     *   error     → error message + composer
     */
    phase: 'idle' | 'waiting' | 'streaming' | 'tool' | 'question' | 'error';
    /** Word-by-word streaming reveal of the last assistant message */
    streamingText?: { full: string; visible: string };
    error?: string;
    /** Active client-side tool prompt (waiting for user input) */
    clientPrompt?: {
      toolName: string;
      input: Record<string, unknown>;
      preference?: {
        subPhase: 'streaming_question' | 'awaiting_choice' | 'persisting' | 'streaming_followup' | 'done';
        questionText: string;
        visibleQuestionText: string;
        followupText?: string;
        visibleFollowupText?: string;
        stream: StreamConfig;
        choice?: 'yes' | 'no';
        ctaLocked?: boolean;
      };
    };
    /** Name of currently executing tool (set during 'tool' phase) */
    toolName?: string;
  };
  /** Post-login UI state (signed-in bubble, newsletter prompt) */
  postLogin?: {
    signedInBubbleVisible: boolean;
    signedInBubbleJustAppeared?: boolean;
    newsletter?: {
      visibleText: string;
      fullText: string;
      stream: StreamConfig;
      isStreaming: boolean;
      ctaVisible: boolean;
      enableCtas?: boolean;
      ctaLocked?: boolean;
      choice?: 'yes' | 'no';
      response?: 'yes' | 'no';
      responseBubble?: string;
      followup?: {
        visibleText: string;
        fullText: string;
        stream: StreamConfig;
        isStreaming: boolean;
      };
    };
  };
}

/**
 * Root application state interface.
 * Contains all UI, user, and preference state.
 */
export interface AppState {
  // ─── Preferences ───────────────────────────────────────────────────────────
  /** Selected locale key */
  localeKey: LocaleKey;
  /** Theme mode preference */
  themeMode: ThemeMode;

  // ─── UI State ──────────────────────────────────────────────────────────────
  /** Whether the language dropdown is open */
  isLanguageMenuOpen: boolean;
  /** Whether the auth/user dropdown is open */
  isAuthMenuOpen: boolean;
  /** Whether the settings overlay is visible */
  isSettingsOverlayOpen: boolean;
  /** Current hero section phase */
  heroPhase: HeroPhase;

  // ─── User State ────────────────────────────────────────────────────────────
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Supabase user ID (if authenticated) */
  userId: string | null;
  /** User's email address */
  userEmail: string | null;
  /** User's avatar URL from OAuth provider */
  userAvatarUrl: string | null;
  /** User's display name from OAuth provider */
  userDisplayName: string | null;
  /** Whether user is an admin */
  isAdmin: boolean;
  /** mac-mgmt customer token (if user has one) */
  customerToken: string | null;

  // ─── Chat State ────────────────────────────────────────────────────────────
  /** Active AI chat mode */
  activeChatMode: ClientChatModeId;
  /** Current chat conversation state (null when not in chat phase) */
  chat: ChatState | null;

  // ─── Profile State Machine ─────────────────────────────────────────────────
  /** Profile preferences lifecycle (idle → loading → ready | error) */
  profile: ProfileState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Locale Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads stored locale preference from sessionStorage.
 * Returns null if not found or invalid.
 */
const readStoredLocale = (): LocaleKey | null => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEYS.LANGUAGE);
    if (stored && supportedLocales.includes(stored as LocaleKey)) {
      return stored as LocaleKey;
    }
  } catch {
    // Ignore storage access issues (private browsing, etc.)
  }
  return null;
};

/**
 * Detects browser locale from navigator.language.
 * Falls back to default locale if detection fails.
 */
const detectBrowserLocale = (): LocaleKey => {
  if (typeof navigator === 'undefined') {
    return defaultLocale;
  }

  const lang = navigator.language || navigator.languages?.[0];
  if (lang && lang.toLowerCase().startsWith('de')) {
    return 'de';
  }
  return defaultLocale;
};

// ─────────────────────────────────────────────────────────────────────────────
// User State Cache (prevents header layout shift on reload)
// ─────────────────────────────────────────────────────────────────────────────

/** Cached user state for instant header render */
interface CachedUserState {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  customerToken: string | null;
  timestamp: number;
}

/** Max age for cached user state (5 minutes) */
const USER_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Reads cached user state from sessionStorage.
 * Returns null if not found, invalid, or expired.
 */
const readCachedUserState = (): Partial<CachedUserState> | null => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEYS.USER_CACHE);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as CachedUserState;

    // Validate structure
    if (typeof parsed.isAuthenticated !== 'boolean') return null;

    // Check expiration (only if authenticated - we want to remember logged-out state)
    if (parsed.isAuthenticated && parsed.timestamp) {
      const age = Date.now() - parsed.timestamp;
      if (age > USER_CACHE_MAX_AGE_MS) return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

/**
 * Saves user state to sessionStorage for instant header render on reload.
 */
export const cacheUserState = (state: {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  customerToken?: string | null;
}): void => {
  try {
    const cached: CachedUserState = {
      ...state,
      customerToken: state.customerToken ?? null,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEYS.USER_CACHE, JSON.stringify(cached));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Clears cached user state (call on sign out).
 */
export const clearCachedUserState = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEYS.USER_CACHE);
  } catch {
    // Ignore storage errors
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// State Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the initial application state.
 * Uses cached user state from sessionStorage to prevent header layout shift.
 */
export const createInitialState = (): AppState => {
  // Read cached user state for instant header render
  const cachedUser = readCachedUserState();

  return {
    localeKey: readStoredLocale() ?? detectBrowserLocale(),
    themeMode: 'system', // Initial default, will be updated by initTheme
    isLanguageMenuOpen: false,
    isAuthMenuOpen: false,
    isSettingsOverlayOpen: false,
    // Use cached auth state to prevent "Sign in" → avatar flash
    isAuthenticated: cachedUser?.isAuthenticated ?? false,
    userId: cachedUser?.userId ?? null,
    userEmail: cachedUser?.userEmail ?? null,
    userAvatarUrl: cachedUser?.userAvatarUrl ?? null,
    userDisplayName: cachedUser?.userDisplayName ?? null,
    isAdmin: cachedUser?.isAdmin ?? false,
    customerToken: cachedUser?.customerToken ?? null,
    heroPhase: 'composer',
    activeChatMode: 'machine_config',
    chat: null,
    profile: createProfileState(),
  };
};

/**
 * Persists locale selection to sessionStorage and updates document lang.
 * Fails silently if storage is unavailable.
 */
export const persistLocaleSelection = (locale: LocaleKey): void => {
  // Update document lang attribute for accessibility and SEO
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }

  try {
    sessionStorage.setItem(STORAGE_KEYS.LANGUAGE, locale);
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
};
