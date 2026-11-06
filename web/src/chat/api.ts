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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
  /** An admin has let this account in; until then it can't chat. */
  approved: boolean;
  /** Purchases may be made from MCP clients (each confirmed with its price). */
  mcp_purchases: boolean;
  /** An admin is looking at this user's account (read-only). */
  impersonating: boolean;
  /** The user's plan and its hourly budget, with the last hour's use. */
  budget?: Budget | null;
  /** The plan.ai applications this user may see. */
  apps?: AppLink[];
}

/** A sidebar link to a plan.ai application. */
export interface AppLink {
  name: string;
  url: string;
  icon?: string | null;
  description: string;
  /** Per language; fall back to `en`, then `name`. */
  label: Record<string, string>;
}

/** A plan's hourly token budget (0 = unlimited) and the last rolling hour's use. */
export interface Budget {
  plan_id: string;
  plan_name: string;
  hourly_input_tokens: number;
  hourly_output_tokens: number;
  used_input_tokens: number;
  used_output_tokens: number;
}

/** A plan (`GET /api/v1/plan`): free, assigned to users by admins. */
export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  window_days: number;
  limits: { hourly_input_tokens?: number; hourly_output_tokens?: number };
  /** Users on it. */
  users: number;
}

export interface PlanInput {
  id: string;
  name: string;
  /** Tokens per user per rolling hour; 0 = unlimited. */
  hourly_input_tokens: number;
  hourly_output_tokens: number;
}

export interface ProfileUpdate {
  language?: Language;
  theme?: ThemePreference;
  newsletter_opt_in?: boolean;
  newsletter_source?: 'chat_flow' | 'settings';
  mcp_purchases?: boolean;
}

/** An app the user connected through MCP (`GET /api/v1/mcp_app`). */
export interface McpApp {
  client_id: string;
  name: string;
  connected_at: string;
  last_used_at: string | null;
}

/** One call a connected app made (`GET /api/v1/mcp_call`, newest first). */
export interface McpCall {
  client: string;
  tool: string;
  decision: 'allow' | 'deny';
  reason: string;
  created_at: string;
}

/** A team the user is in, as the connectors settings show it. */
export interface ConnectorTeam {
  id: string;
  name: string;
  /** The user's personal team: their own connectors. */
  personal: boolean;
  role: 'admin' | 'write' | 'read';
  /** May add, change and remove its connectors (team admins). */
  can_manage: boolean;
}

export type ConnectorStatus = 'ready' | 'connected' | 'connect_first' | 'needs_reconnect';
export type OauthMode = 'shared' | 'per_member';

/** An MCP server of the user's or a team's, or a configured OAuth app (`GET /api/v1/connector`). */
export interface Connector {
  /** A uuid, or `app:<name>` for a configured app. */
  id: string;
  team_id: string | null;
  name: string;
  /** The name the assistant knows it by (`acme/crm`). */
  service: string;
  description: string;
  url: string;
  auth: 'bearer' | 'oauth' | 'none';
  oauth_mode: OauthMode | null;
  /** A bearer token's last four characters (`…abcd`) or `set`; never the token. */
  token: string | null;
  status: ConnectorStatus;
  status_detail: string | null;
  can_manage: boolean;
  can_connect: boolean;
  source: 'team' | 'config';
}

export interface ConnectorList {
  /** The server can store connectors. */
  enabled: boolean;
  teams: ConnectorTeam[];
  connectors: Connector[];
}

export type ConnectorAuth = { type: 'bearer'; token: string } | { type: 'oauth'; mode: OauthMode } | { type: 'none' };

export interface ConnectorInput {
  /** Absent: the personal team. */
  team_id?: string;
  name: string;
  description?: string;
  url: string;
  auth: ConnectorAuth;
}

export interface ConnectorChange {
  name?: string;
  description?: string;
  url?: string;
  token?: string;
  mode?: OauthMode;
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

/**
 * The approval hook's judgement of a call on the user's services: what it
 * decided, and the safety check's verdict (null: none ran) and reasoning.
 */
export interface SafetyCheck {
  agent_reason?: string | null;
  decision: 'allowed' | 'denied' | 'asked';
  /** `always`: on the always-ask list (no validator; the user decides). */
  verdict: 'approved' | 'rejected' | 'failed' | 'always' | null;
  reasoning?: string | null;
}

/** A tool run (history `role: "tool"`, the `tool_end` event). */
export interface ToolData extends AnswerData {
  /** Why the assistant made the call. */
  reason?: string | null;
  /** A connector call's real target, `service.tool`. */
  target?: string | null;
  check?: SafetyCheck | null;
  /** The page the call made: an artifact the assistant published, or a service tool's view. */
  artifact?: PageRef | null;
}

/** A page in a conversation (an artifact or an MCP Apps view), as a tool run names it. */
export interface PageRef {
  id: string;
  kind: 'artifact' | 'mcp_app';
  title: string;
  version: number | null;
}

/** A page ready for the iframe (`srcdoc`), and what its host needs. */
export interface PageDoc {
  id: string;
  kind: 'artifact' | 'mcp_app';
  title: string;
  name: string | null;
  service: string | null;
  conversation: string;
  version: number;
  latest: number;
  html: string;
  tool: { name: string; arguments: Record<string, unknown> | null; result: unknown; definition: unknown } | null;
  prefers_border: boolean | null;
}

/** A worker (sub-agent) of a conversation. */
export interface Worker {
  id: string;
  task: string | null;
  state: 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'paused';
  tokens: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

/** One step of a worker's transcript. */
export interface WorkerStep {
  kind: 'task' | 'text' | 'tool' | 'result' | 'message';
  text: string;
  tool?: string;
}

/** A page's tool call: the result, or what the user has to confirm first. */
export type PageCallResult = { confirm: { message: string; tool: string; token: string } } | Record<string, unknown>;

export interface ApprovalData {
  call_id: string;
  name: string;
  input: unknown;
  /** The approval hook's message to the user. */
  reason?: string | null;
  /** Why the assistant wants to make the call. */
  agent_reason?: string | null;
  check?: SafetyCheck | null;
  /** Set when the call buys something: confirmed with `confirm_purchase`. */
  purchase?: Purchase | null;
}

/** What an approval would buy (shown as a "Confirm purchase" card). */
export interface Purchase {
  tool: string;
  product: string;
  product_name: string;
  organization_name: string;
  price_cents: number;
  currency: string;
  interval: 'month' | 'year' | 'once' | 'usage';
  trial_days?: number | null;
  summary: string;
}

export type HistoryMessage =
  | { id: number; role: 'user' | 'assistant'; content: string; data: null; at: string }
  | { id: number; role: 'question'; content: string; data: QuestionData; at: string }
  | { id: number; role: 'answer'; content: string; data: AnswerData; at: string }
  | { id: number; role: 'tool'; content: string; data: ToolData; at: string }
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
  tool_start: { name: string; call_id?: string; reason?: string | null; target?: string | null };
  tool_end: { name: string } & Partial<ToolData>;
  question: QuestionData;
  approval: ApprovalData;
  done: Empty;
  error: { message: string };
  resync: Empty;
  /** A page's KV view changed (a handler ran, the assistant set values). */
  artifact_kv: { artifact: string; kv: Record<string, unknown> };
  /** A worker of the conversation moved on (spawned, a step, done). */
  worker: { agent: string };
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
  'artifact_kv',
  'worker',
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
  /** Their plan (their personal team's). */
  plan_id: string;
  /** An admin has let them in. */
  approved: boolean;
  created_at: string;
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

  mcp: {
    apps: () => request<McpApp[]>('GET', '/api/v1/mcp_app'),
    disconnect: (client_id: string) => request<Ok>('POST', '/api/v1/mcp_app/remove', { client_id }),
    calls: () => request<McpCall[]>('GET', '/api/v1/mcp_call'),
  },

  connectors: {
    list: () => request<ConnectorList>('GET', '/api/v1/connector'),
    create: (input: ConnectorInput) => request<Connector>('POST', '/api/v1/connector', input),
    update: (id: string, change: ConnectorChange) => request<Connector>('PATCH', `/api/v1/connector/${encodeURIComponent(id)}`, change),
    remove: (id: string) => request<Ok>('DELETE', `/api/v1/connector/${encodeURIComponent(id)}`),
    /** The link that starts the OAuth sign-in (open it in this browser). */
    connect: (id: string) => request<{ url: string }>('POST', `/api/v1/connector/${encodeURIComponent(id)}/connect`, {}),
    disconnect: (id: string) => request<Ok>('POST', `/api/v1/connector/${encodeURIComponent(id)}/disconnect`, {}),
  },

  /** The conversations' workers (sub-agents). */
  workers: {
    list: (conversation: string) => request<Worker[]>('GET', `/api/v1/conversations/${encodeURIComponent(conversation)}/workers`),
    get: (id: string) => request<{ id: string; steps: WorkerStep[]; phase: string | null }>('GET', `/api/v1/workers/${encodeURIComponent(id)}`),
    stop: (id: string) => request<Empty>('POST', `/api/v1/workers/${encodeURIComponent(id)}/stop`, {}),
    message: (id: string, text: string) => request<Empty>('POST', `/api/v1/workers/${encodeURIComponent(id)}/message`, { text }),
  },
  /** Pages (artifacts, MCP Apps views): what their iframe host asks for. */
  pages: {
    get: (id: string, opts: { version?: number; theme?: 'light' | 'dark' }) => request<PageDoc>('GET', `/api/v1/pages/${encodeURIComponent(id)}${query(opts)}`),
    kv: (id: string) => request<{ kv: Record<string, unknown> }>('GET', `/api/v1/pages/${encodeURIComponent(id)}/kv`),
    backflow: (id: string, body: { action: string; component: string | null; value: unknown; version: string | null; lang: string; gesture: boolean }) =>
      request<{ response: unknown; kv?: Record<string, unknown>; sent?: boolean }>('POST', `/api/v1/pages/${encodeURIComponent(id)}/backflow`, body),
    call: (id: string, body: { name: string; arguments: Record<string, unknown>; confirmed?: string }) =>
      request<PageCallResult>('POST', `/api/v1/pages/${encodeURIComponent(id)}/call`, body),
    message: (id: string, text: string, lang: string, gesture: boolean) => request<Empty>('POST', `/api/v1/pages/${encodeURIComponent(id)}/message`, { text, lang, gesture }),
    context: (id: string, report: unknown) => request<Empty>('POST', `/api/v1/pages/${encodeURIComponent(id)}/context`, report),
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
    /** `confirm_purchase`: the user confirmed a purchase (its card's checkbox). */
    approve: (id: string, callId: string, approved: boolean, options: { all?: boolean; reason?: string; confirm_purchase?: boolean } = {}) =>
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
    plans: () => request<Plan[]>('GET', '/api/v1/plan'),
    putPlan: (plan: PlanInput) => request<unknown>('POST', '/api/v1/plan/put', plan),
    /** Returns the user's new budget. */
    setPlan: (userId: string, planId: string) => request<Budget>('POST', '/api/v1/user/set_plan', { user_id: userId, plan_id: planId }),
    /** The user's prompt extension: empty, or one entry. */
    promptExtension: (userId: string) => request<PromptExtension[]>('GET', `/api/v1/prompt_extension${query({ user_id: userId })}`),
    setPromptExtension: (userId: string, content: string) =>
      request<Ok>('POST', '/api/v1/prompt_extension/set', { user_id: userId, content }),
    removePromptExtension: (userId: string) => request<Ok>('POST', '/api/v1/prompt_extension/remove', { user_id: userId }),
    staffPings: (includeResolved: boolean) =>
      request<StaffPing[]>('GET', `/api/v1/staff_ping${query({ include_resolved: includeResolved })}`),
    resolvePing: (id: number) => request<Ok>('POST', '/api/v1/staff_ping/resolve', { id }),
    /** Accounts waiting for approval, newest first. */
    pendingUsers: () => request<UserHit[]>('GET', `/api/v1/user${query({ q: '', pending: 'true' })}`),
    approveUser: (user_id: string) => request<Ok>('POST', '/api/v1/user/approve', { user_id }),
  },
};
