/**
 * Application State Types and Initialization
 *
 * State is divided into:
 * - UI state (menus, overlay)
 * - User state (from GET /api/v1/profile/me, cached for the first render)
 * - Chat state (the conversation list and the open conversation)
 * - Preference state (theme, locale, newsletter)
 */

import { defaultLocale, supportedLocales, type LocaleKey, type StreamConfig } from '../content';
import { STORAGE_KEYS } from '../constants';
import type { ConversationItem } from '../actions/chat/conversationList';
import { createProfileState, type ProfileState } from './profileState';
import type { Budget, PageRef, Purchase, SafetyCheck } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Theme mode preference */
export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * Chat phases:
 *   idle      → composer visible
 *   waiting   → thinking indicator, waiting for the assistant
 *   streaming → the assistant's text arrives
 *   tool      → the assistant runs a tool (spinner)
 *   question  → ask_question / prompt_preference UI
 *   approval  → tool calls wait for the user's approval
 *   login     → anonymous user prompt submitted, showing sign-in invite
 *   error     → error message + composer
 */
export type ChatPhase = 'idle' | 'waiting' | 'streaming' | 'tool' | 'question' | 'approval' | 'login' | 'error';

export type ApprovalDecision = 'approved' | 'denied';

/** A tool call the assistant wants to make, waiting for the user. */
export interface PendingApproval {
  callId: string;
  name: string;
  input: unknown;
  /** The approval hook's message to the user. */
  reason: string | null;
  /** Why the assistant wants to make the call. */
  agentReason?: string | null;
  check?: SafetyCheck | null;
  /** Set when the call buys something. */
  purchase?: Purchase | null;
}

/** A finished tool run: its name, why the assistant made it, and the safety check if one ran. */
export interface ToolRun {
  callId: string;
  name: string;
  isError: boolean;
  reason: string | null;
  /** A connector call's real target (`service.tool`), for its icon. */
  target: string | null;
  check: SafetyCheck | null;
  /** The page this call made (shown as a card that opens it). */
  page: PageRef | null;
}

/** The page shown in the side panel; `rev` reloads it (a new version arrived). */
export interface OpenPage {
  id: string;
  /** null: the latest. */
  version: number | null;
  rev: number;
  fullscreen: boolean;
}

export type ChatMessage =
  /** `id`: the server's message id (from the history; search hits point at it). */
  | { role: 'user' | 'assistant' | 'cancel'; content: string; id?: number }
  /** An answered question: the question and the answer (null: dismissed). */
  | { role: 'qa'; question: string; answer: string | null }
  | ({ role: 'tool' } & ToolRun)
  /** A past approval request; `decision` is known for the ones made here. */
  | ({ role: 'approval'; decision: ApprovalDecision | null } & PendingApproval);

/** prompt_preference: scripted question with yes/no buttons and a follow-up. */
export interface PreferencePrompt {
  subPhase: 'streaming_question' | 'awaiting_choice' | 'persisting' | 'streaming_followup' | 'done';
  questionText: string;
  visibleQuestionText: string;
  followupText?: string;
  visibleFollowupText?: string;
  stream: StreamConfig;
  choice?: 'yes' | 'no';
  ctaLocked?: boolean;
}

/** A client-side tool call (question) waiting for the user's answer. */
export interface ClientPrompt {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
  preference?: PreferencePrompt;
}

export interface LoginInvite {
  text: string;
  visibleText: string;
  stream: StreamConfig;
  isStreaming: boolean;
  ctaVisible: boolean;
  ctaLocked?: boolean;
}

/** The conversation on screen. */
export interface ChatSession {
  messages: ChatMessage[];
  phase: ChatPhase;
  /** The assistant's text block arriving right now */
  streamingText?: string;
  error?: string;
  clientPrompt?: ClientPrompt;
  /** Tool calls waiting for approval (shown in the 'approval' phase) */
  approvals: PendingApproval[];
  loginInvite?: LoginInvite;
  /** Name of the running tool (set during 'tool' phase) */
  toolName?: string;
  /** Why the assistant runs it. */
  toolReason?: string | null;
  /** The running connector call's target, for its icon. */
  toolTarget?: string | null;
  /** Shown as working only because the conversation list said so (until its history or an event says otherwise). */
  assumedWorking?: boolean;
}

export interface AppState {
  // ─── Preferences ───────────────────────────────────────────────────────────
  localeKey: LocaleKey;
  themeMode: ThemeMode;

  // ─── UI State ──────────────────────────────────────────────────────────────
  isLanguageMenuOpen: boolean;
  isAuthMenuOpen: boolean;
  isSettingsOverlayOpen: boolean;
  /** Mobile: the conversations drawer is open. */
  isSidebarOpen: boolean;
  /** Desktop: the sidebar is collapsed (remembered in this browser). */
  isSidebarCollapsed: boolean;
  /** The conversation whose title is being edited in the sidebar. */
  renamingConversationId: string | null;

  // ─── User State ────────────────────────────────────────────────────────────
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  /** An admin looks at this user's account (read-only). */
  impersonating: boolean;
  /** Signed in, but an admin hasn't approved the account yet. */
  awaitingApproval: boolean;

  /** The user's plan and the last hour's use (null until known). */
  budget: Budget | null;

  // ─── Chat State ────────────────────────────────────────────────────────────
  /** The user's conversations, most recent first. */
  conversations: ConversationItem[];
  /** The conversation on screen (its URL is /c/<id>); null: a new chat. */
  activeConversationId: string | null;
  /** A message to scroll to and highlight once it is shown (a search hit). */
  highlightMessageId: number | null;
  /** null until the chat is set up on load */
  chat: ChatSession | null;
  /** The page in the side panel, if one is open. */
  openPage: OpenPage | null;
  /** The worker in the side panel, if one is open (instead of a page). */
  openWorker: string | null;
  /** Bumped when a worker of the conversation on screen moves on. */
  workersRev: number;

  // ─── Profile State Machine ─────────────────────────────────────────────────
  profile: ProfileState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Locale Detection
// ─────────────────────────────────────────────────────────────────────────────

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

export interface CachedUserState {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  impersonating: boolean;
}

/** Max age for a cached signed-in state (5 minutes) */
const USER_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

const readCachedUserState = (): CachedUserState | null => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEYS.USER_CACHE);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as CachedUserState & { timestamp?: number };
    if (typeof parsed.isAuthenticated !== 'boolean') return null;
    // Signed-in state expires; the signed-out state is remembered.
    if (parsed.isAuthenticated && (!parsed.timestamp || Date.now() - parsed.timestamp > USER_CACHE_MAX_AGE_MS)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/** Saves the user state from AppState for instant header render on reload. */
export const cacheUserState = (state: AppState): void => {
  const cached: CachedUserState & { timestamp: number } = {
    isAuthenticated: state.isAuthenticated,
    userId: state.userId,
    userEmail: state.userEmail,
    userDisplayName: state.userDisplayName,
    isAdmin: state.isAdmin,
    impersonating: state.impersonating,
    timestamp: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEYS.USER_CACHE, JSON.stringify(cached));
  } catch {
    // Ignore storage errors
  }
};

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

/** The signed-out user state. */
export const signedOutUserState = (): Pick<
  AppState,
  'isAuthenticated' | 'userId' | 'userEmail' | 'userDisplayName' | 'isAdmin' | 'impersonating' | 'awaitingApproval'
> => ({
  isAuthenticated: false,
  userId: null,
  userEmail: null,
  userDisplayName: null,
  isAdmin: false,
  impersonating: false,
  awaitingApproval: false,
});

const readSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === '1';
  } catch {
    return false;
  }
};

export const persistSidebarCollapsed = (collapsed: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, collapsed ? '1' : '0');
  } catch {
    // Ignore storage errors
  }
};

/**
 * Creates the initial application state, with the cached user state so the
 * header doesn't flash "Sign in" before the profile loads.
 */
export const createInitialState = (): AppState => {
  const cachedUser = readCachedUserState();
  const user = cachedUser ?? signedOutUserState();
  return {
    localeKey: readStoredLocale() ?? detectBrowserLocale(),
    themeMode: 'system', // Updated by initTheme
    isLanguageMenuOpen: false,
    isAuthMenuOpen: false,
    isSettingsOverlayOpen: false,
    isSidebarOpen: false,
    isSidebarCollapsed: readSidebarCollapsed(),
    renamingConversationId: null,
    awaitingApproval: false,
    ...user,
    conversations: [],
    budget: null,
    activeConversationId: null,
    highlightMessageId: null,
    chat: null,
    openPage: null,
    openWorker: null,
    workersRev: 0,
    profile: createProfileState(),
  };
};

/** Persists locale selection to sessionStorage and updates document lang. */
export const persistLocaleSelection = (locale: LocaleKey): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
  try {
    sessionStorage.setItem(STORAGE_KEYS.LANGUAGE, locale);
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
};
