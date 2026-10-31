/**
 * Chat Cache — per user in sessionStorage (shown instantly on reload while
 * the server's copy loads): the conversation list and each conversation's
 * messages. Plus the anonymous prompt carried over sign-in.
 */

import { store } from '../../app/store';
import { STORAGE_KEYS } from '../../constants';
import type { ChatMessage } from '../../app/state';
import type { ConversationItem } from './conversationList';

// ─── Conversation cache ─────────────────────────────────────────────────────

const userKey = (suffix: string) => `${STORAGE_KEYS.CHAT_PREFIX}${store.state.userId ?? 'anonymous'}-${suffix}`;

const write = (key: string, value: unknown) => {
  if (!store.state.isAuthenticated) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
};

const readArray = <T>(key: string): T[] => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // corrupt data — ignore
  }
  return [];
};

/** Caches the open conversation's messages (a new chat has none to keep). */
export const cacheChatMessages = (messages: ChatMessage[], id: string | null = store.state.activeConversationId) => {
  if (id) write(userKey(`c-${id}`), messages);
};

export const readCachedChatMessages = (id: string): ChatMessage[] => readArray<ChatMessage>(userKey(`c-${id}`));

export const clearCachedChatMessages = (id: string) => {
  try {
    sessionStorage.removeItem(userKey(`c-${id}`));
  } catch {
    // ignore
  }
};

export const cacheConversations = (list: ConversationItem[]) => write(userKey('list'), list);

export const readCachedConversations = (): ConversationItem[] => readArray<ConversationItem>(userKey('list'));

/** Forgets every cached conversation (sign-out). */
export const clearAllCachedChatMessages = () => {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) {
      if (key?.startsWith(STORAGE_KEYS.CHAT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
};

// ─── Pending prompt (anonymous → a new conversation after sign-in) ─────────

/** A stashed prompt older than this is dropped. */
const PENDING_PROMPT_MAX_AGE_MS = 30 * 60 * 1000;

interface PendingPrompt {
  prompt: string;
  savedAt: number;
}

const storages = (): Storage[] => {
  const out: Storage[] = [];
  try {
    out.push(window.sessionStorage);
  } catch {
    /* unavailable */
  }
  try {
    out.push(window.localStorage);
  } catch {
    /* unavailable */
  }
  return out;
};

export const savePendingPrompt = (prompt: string) => {
  const value = JSON.stringify({ prompt, savedAt: Date.now() } satisfies PendingPrompt);
  for (const storage of storages()) {
    try {
      storage.setItem(STORAGE_KEYS.PENDING_PROMPT, value);
    } catch {
      /* ignore */
    }
  }
};

export const readPendingPrompt = (): string | null => {
  for (const storage of storages()) {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.PENDING_PROMPT) ?? 'null') as PendingPrompt | null;
      if (parsed && typeof parsed.prompt === 'string' && Date.now() - parsed.savedAt < PENDING_PROMPT_MAX_AGE_MS) {
        return parsed.prompt;
      }
    } catch {
      /* corrupt or unavailable */
    }
  }
  return null;
};

export const clearPendingPrompt = () => {
  for (const storage of storages()) {
    try {
      storage.removeItem(STORAGE_KEYS.PENDING_PROMPT);
    } catch {
      /* ignore */
    }
  }
};

export const consumePendingPrompt = (): string | null => {
  const prompt = readPendingPrompt();
  clearPendingPrompt();
  return prompt;
};
