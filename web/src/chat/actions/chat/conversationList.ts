/**
 * The sidebar's conversation list, as pure functions: grouping by date,
 * moving a conversation to the top on activity, and where a server event
 * belongs.
 */

import type { ChatEventName, Conversation } from '../../api';

/** A conversation in the sidebar. */
export interface ConversationItem extends Conversation {
  /** The assistant is working in it (seen on the event stream). */
  busy?: boolean;
  /** Something happened in it since the user last looked. */
  unread?: boolean;
}

export type ConversationGroupKey = 'today' | 'yesterday' | 'previous7Days' | 'older';

export interface ConversationGroup {
  key: ConversationGroupKey;
  items: ConversationItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Most recently updated first. */
export const sortConversations = <T extends Conversation>(list: T[]): T[] =>
  [...list].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

/**
 * Today / Yesterday / Previous 7 days / Older, by last activity in local
 * time, newest first; empty groups are left out.
 */
export const groupConversations = (list: ConversationItem[], now: Date = new Date()): ConversationGroup[] => {
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const weekAgo = today - 7 * DAY_MS;
  const groups: Record<ConversationGroupKey, ConversationItem[]> = { today: [], yesterday: [], previous7Days: [], older: [] };
  for (const c of sortConversations(list)) {
    const t = Date.parse(c.updated_at);
    const key: ConversationGroupKey = t >= today ? 'today' : t >= yesterday ? 'yesterday' : t >= weekAgo ? 'previous7Days' : 'older';
    groups[key].push(c);
  }
  return (Object.keys(groups) as ConversationGroupKey[]).filter((k) => groups[k].length > 0).map((key) => ({ key, items: groups[key] }));
};

/** The list with `id` updated by `patch` (and moved to the top when `at` is given). */
export const updateConversation = (
  list: ConversationItem[],
  id: string,
  patch: Partial<ConversationItem>,
  at?: Date,
): ConversationItem[] => {
  const current = list.find((c) => c.id === id);
  if (!current) return list;
  const updated = { ...current, ...patch, ...(at ? { updated_at: at.toISOString() } : {}) };
  const rest = list.filter((c) => c.id !== id);
  return at ? [updated, ...rest] : list.map((c) => (c.id === id ? updated : c));
};

/** The server's list, keeping what this tab knows (busy, unread) about each. */
export const mergeConversations = (server: Conversation[], known: ConversationItem[]): ConversationItem[] => {
  const byId = new Map(known.map((c) => [c.id, c]));
  return sortConversations(
    server.map((c) => {
      const k = byId.get(c.id);
      return k ? { ...c, busy: k.busy, unread: k.unread } : { ...c };
    }),
  );
};

/** Where an event of the shared stream belongs. */
export type EventDestination =
  /** Refetch the list and the open conversation. */
  | 'resync'
  /** The conversation on screen. */
  | 'open'
  /** Another conversation in the sidebar. */
  | 'background'
  /** A conversation this tab doesn't know (new, e.g. from another tab). */
  | 'unknown';

export const eventDestination = (
  name: ChatEventName,
  conversation: string | undefined,
  openId: string | null,
  known: ConversationItem[],
): EventDestination => {
  if (name === 'resync' || !conversation) return 'resync';
  if (conversation === openId) return 'open';
  return known.some((c) => c.id === conversation) ? 'background' : 'unknown';
};

/** What an event in a conversation that isn't on screen does to its sidebar entry. */
export const backgroundActivity = (name: ChatEventName): Pick<ConversationItem, 'busy' | 'unread'> | null => {
  switch (name) {
    case 'thinking':
    case 'text_delta':
    case 'tool_start':
    case 'tool_end':
      return { busy: true };
    case 'text_done':
      return { busy: true, unread: true };
    // Waiting for the user, finished or failed: news, and no longer working.
    case 'question':
    case 'approval':
    case 'done':
    case 'error':
      return { busy: false, unread: true };
    default:
      return null;
  }
};

/** A title for a new conversation until the server's arrives (as the server derives it). */
export const titleFrom = (text: string): string => {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  const chars = Array.from(line);
  if (chars.length <= 60) return line;
  const cut = chars.slice(0, 60).join('');
  const space = cut.lastIndexOf(' ');
  const head = space > 20 ? cut.slice(0, space) : cut;
  return `${head.trimEnd()}…`;
};
