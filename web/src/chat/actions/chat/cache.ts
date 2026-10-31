/**
 * Chat Cache — the conversation per user and mode in sessionStorage (shown
 * instantly on reload while the server's history loads), and the anonymous
 * prompt carried over sign-in.
 */

import { store } from '../../app/store';
import { STORAGE_KEYS } from '../../constants';
import type { ChatMessage } from '../../app/state';
import type { ChatModeId } from '../../api';

// ─── Conversation cache ─────────────────────────────────────────────────────

const messagesKey = (mode: ChatModeId) => `${STORAGE_KEYS.CHAT_PREFIX}${store.state.userId ?? 'anonymous'}-${mode}`;

export const cacheChatMessages = (messages: ChatMessage[], mode: ChatModeId = store.state.activeChatMode) => {
  if (!store.state.isAuthenticated) return;
  try {
    sessionStorage.setItem(messagesKey(mode), JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
};

export const readCachedChatMessages = (mode: ChatModeId = store.state.activeChatMode): ChatMessage[] => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(messagesKey(mode)) ?? '[]');
    if (Array.isArray(parsed)) return parsed as ChatMessage[];
  } catch {
    // corrupt data — ignore
  }
  return [];
};

export const clearCachedChatMessages = (mode: ChatModeId) => {
  try {
    sessionStorage.removeItem(messagesKey(mode));
  } catch {
    // ignore
  }
};

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

// ─── Pending sales prompt (anonymous → sent after sign-in) ──────────────────

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

export const savePendingSalesPrompt = (prompt: string) => {
  const value = JSON.stringify({ prompt, savedAt: Date.now() } satisfies PendingPrompt);
  for (const storage of storages()) {
    try {
      storage.setItem(STORAGE_KEYS.PENDING_SALES_PROMPT, value);
    } catch {
      /* ignore */
    }
  }
};

export const readPendingSalesPrompt = (): string | null => {
  for (const storage of storages()) {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.PENDING_SALES_PROMPT) ?? 'null') as PendingPrompt | null;
      if (parsed && typeof parsed.prompt === 'string' && Date.now() - parsed.savedAt < PENDING_PROMPT_MAX_AGE_MS) {
        return parsed.prompt;
      }
    } catch {
      /* corrupt or unavailable */
    }
  }
  return null;
};

export const clearPendingSalesPrompt = () => {
  for (const storage of storages()) {
    try {
      storage.removeItem(STORAGE_KEYS.PENDING_SALES_PROMPT);
    } catch {
      /* ignore */
    }
  }
};

export const consumePendingSalesPrompt = (): string | null => {
  const prompt = readPendingSalesPrompt();
  clearPendingSalesPrompt();
  return prompt;
};
