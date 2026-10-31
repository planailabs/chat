/**
 * Typed client for the Rust server's API (`/api/v1/...`), shared by the chat
 * and the admin dashboard. Same origin, cookie session: signed-out calls get
 * a 401, which callers turn into "signed out" or a sign-in redirect.
 */

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The server's error code (`unauthorized`, `forbidden`, …). */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

type Method = 'GET' | 'POST' | 'PATCH';

const request = async <T>(method: Method, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
    const code = typeof data.error === 'string' ? data.error : 'http_error';
    const message = typeof data.message === 'string' ? data.message : `${method} ${path}: ${res.status}`;
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
};

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ─── Sign-in ────────────────────────────────────────────────────────────────

/** Sends the browser through the sign-in flow, back to `path` afterwards. */
export const signIn = (path: string = window.location.pathname + window.location.search): void => {
  window.location.href = `/auth/login?redirect=${encodeURIComponent(path)}`;
};

export const signOut = (): void => {
  window.location.href = '/auth/logout';
};

// ─── Impersonation (admins) ─────────────────────────────────────────────────

/** Read by the server's auth layer for admins: they act as this user. */
export const IMPERSONATE_COOKIE = 'impersonate_user_id';

export const startImpersonation = (userId: string): void => {
  document.cookie = `${IMPERSONATE_COOKIE}=${encodeURIComponent(userId)}; path=/; SameSite=Lax`;
};

export const stopImpersonation = (): void => {
  document.cookie = `${IMPERSONATE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type Language = 'en' | 'de';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Profile {
  user_id: string;
  email: string;
  name: string;
  is_admin: boolean;
  language: Language;
  theme: ThemePreference;
  newsletter_opt_in: boolean;
  deletion_requested_at: string | null;
  /** An admin is looking at this user's account (read-only). */
  impersonating: boolean;
}

export interface ProfileUpdate {
  language?: Language;
  theme?: ThemePreference;
  newsletter_opt_in?: boolean;
  newsletter_source?: 'chat_flow' | 'settings';
}

/** One of the user's conversations (`GET /api/v1/chat`, newest first). */
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionData {
  call_id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AnswerData {
  call_id: string;
  is_error: boolean | null;
}

export interface ApprovalData {
  call_id: string;
  name: string;
  input: unknown;
  reason?: string | null;
}

export type HistoryMessage =
  | { id: number; role: 'user' | 'assistant'; content: string; data: null; at: string }
  | { id: number; role: 'question'; content: string; data: QuestionData; at: string }
  | { id: number; role: 'answer'; content: string; data: AnswerData; at: string }
  | { id: number; role: 'tool'; content: string; data: AnswerData; at: string }
  | { id: number; role: 'approval'; content: string; data: ApprovalData; at: string };

export interface PendingQuestion {
  call_id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A search hit (`POST /api/v1/chat/search`): a message, or the title when `message_id` is null. */
export interface SearchHit {
  conversation: string;
  title: string;
  message_id: number | null;
  role: 'user' | 'assistant' | null;
  /** Text around the match; matches between U+E000 and U+E001. */
  snippet: string;
  at: string;
}

export interface History {
  id: string;
  title: string;
  messages: HistoryMessage[];
  phase: string | null;
  pending_questions: PendingQuestion[] | null;
  pending_approvals: ApprovalData[] | null;
  auto_approve: boolean;
}

/** An event without a payload (besides its conversation). */
type Empty = { conversation?: string };

/**
 * Server-sent events of `/api/v1/chat/events`, by event name. One stream
 * carries all the user's conversations: every event but `resync` names its
 * `conversation`.
 */
export interface ChatEvents {
  thinking: Empty;
  text_delta: { content: string };
  text_done: { content: string };
  tool_start: { name: string };
  tool_end: { name: string };
  question: QuestionData;
  approval: ApprovalData;
  done: Empty;
  error: { message: string };
  resync: Empty;
}

export type ChatEventName = keyof ChatEvents;

/** An event's data as it arrives: tagged with its conversation. */
export type ConversationEvent<E extends ChatEventName = ChatEventName> = ChatEvents[E] & { conversation?: string };

export const CHAT_EVENT_NAMES: ChatEventName[] = [
  'thinking',
  'text_delta',
  'text_done',
  'tool_start',
  'tool_end',
  'question',
  'approval',
  'done',
  'error',
  'resync',
];

export interface Stats {
  messages_today: number;
  messages_total: number;
  active_users_today: number;
  unresolved_pings: number;
  users_total: number;
  /** Last 48 hours, hourly. */
  activity: { hour: string; messages: number }[];
  tokens: { hour: string; input: number; output: number; cached: number }[];
  /** Last 24 hours. */
  top_users: { email: string; input: number; output: number }[];
}

export interface AdminMessage {
  id: number;
  user_id: string;
  email: string;
  /** The conversation's title. */
  conversation: string | null;
  role: string;
  content: string;
  created_at: string;
}

export interface UserHit {
  id: string;
  email: string;
  name: string;
  has_extension: boolean;
}

export interface PromptExtension {
  content: string;
  updated_at: string;
}

export interface StaffPing {
  id: number;
  user_id: string;
  email: string;
  reason: string;
  message: string;
  resolved_at: string | null;
  created_at: string;
}

interface Ok {
  ok: boolean;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export const api = {
  profile: {
    me: () => request<Profile>('GET', '/api/v1/profile/me'),
    update: (update: ProfileUpdate) => request<Profile>('PATCH', '/api/v1/profile/me', update),
    /** Everything stored about the user. */
    export: () => request<unknown>('POST', '/api/v1/profile/export', {}),
    requestDeletion: () => request<Ok>('POST', '/api/v1/profile/request_deletion', {}),
  },

  chat: {
    list: () => request<Conversation[]>('GET', '/api/v1/chat'),
    /** 404: the conversation is gone. */
    history: (id: string) => request<History>('POST', '/api/v1/chat/history', { id }),
    /** No `id`: starts a new conversation. Returns the conversation's id. */
    send: (id: string | null, text: string, lang: Language) =>
      request<{ id: string }>('POST', '/api/v1/chat/send', id ? { id, text, lang } : { text, lang }),
    /** `content` absent: the user dismissed the question. */
    answer: (id: string, callId: string, content?: string) =>
      request<Ok>('POST', '/api/v1/chat/answer', content === undefined ? { id, call_id: callId } : { id, call_id: callId, content }),
    approve: (id: string, callId: string, approved: boolean, options: { all?: boolean; reason?: string } = {}) =>
      request<Ok>('POST', '/api/v1/chat/approve', { id, call_id: callId, approved, ...options }),
    /** Full text over the user's own titles and messages, best first (at most 50). */
    search: (q: string) => request<SearchHit[]>('POST', '/api/v1/chat/search', { q }),
    rename: (id: string, title: string) => request<Ok>('POST', '/api/v1/chat/rename', { id, title }),
    /** Deletes the conversation and its messages. */
    remove: (id: string) => request<Ok>('POST', '/api/v1/chat/remove', { id }),
    eventsUrl: '/api/v1/chat/events',
  },

  admin: {
    stats: () => request<Stats>('GET', '/api/v1/stats/all'),
    messages: (limit: number) => request<AdminMessage[]>('GET', `/api/v1/message${query({ limit })}`),
    users: (q: string) => request<UserHit[]>('GET', `/api/v1/user${query({ q })}`),
    /** The user's prompt extension: empty, or one entry. */
    promptExtension: (userId: string) => request<PromptExtension[]>('GET', `/api/v1/prompt_extension${query({ user_id: userId })}`),
    setPromptExtension: (userId: string, content: string) =>
      request<Ok>('POST', '/api/v1/prompt_extension/set', { user_id: userId, content }),
    removePromptExtension: (userId: string) => request<Ok>('POST', '/api/v1/prompt_extension/remove', { user_id: userId }),
    staffPings: (includeResolved: boolean) =>
      request<StaffPing[]>('GET', `/api/v1/staff_ping${query({ include_resolved: includeResolved })}`),
    resolvePing: (id: number) => request<Ok>('POST', '/api/v1/staff_ping/resolve', { id }),
  },
};
