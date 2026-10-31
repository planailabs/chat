/**
 * Chat Cache — sessionStorage persistence for AI chat messages, JWT cache,
 * and pending sales prompt (anonymous → post-login send).
 */

import { store } from '../../app/store';
import { chatStorageKey, STORAGE_KEYS, type ClientChatModeId } from '../../constants';

// ─────────────────────────────────────────────────────────────────────────────
// AI Chat Persistence (server-side via Supabase, sessionStorage as cache)
// ─────────────────────────────────────────────────────────────────────────────

export type StoredMessage = { id?: string; role: 'user' | 'assistant' | 'cancel'; content: string };

export const cacheAIChatMessages = (messages: StoredMessage[], modeId?: ClientChatModeId) => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    sessionStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
};

export const readCachedAIChatMessages = (modeId?: ClientChatModeId): StoredMessage[] | null => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // corrupt data — ignore
  }
  return null;
};

export const clearAIChatMessages = (modeId?: ClientChatModeId) => {
  try {
    const key = chatStorageKey(modeId ?? store.state.activeChatMode);
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
};

// Legacy aliases for backwards compat
export const cacheMachineConfigMessages = cacheAIChatMessages;
export const readCachedMachineConfigMessages = readCachedAIChatMessages;
export const clearMachineConfigMessages = () => clearAIChatMessages('machine_config');

// ─── Pending Sales Prompt (anonymous → post-login send) ─────────────────────

export const savePendingSalesPrompt = (prompt: string) => {
  try {
    sessionStorage.setItem(STORAGE_KEYS.PENDING_SALES_PROMPT, prompt);
  } catch { /* ignore */ }
};

export const readPendingSalesPrompt = (): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_KEYS.PENDING_SALES_PROMPT);
  } catch {
    return null;
  }
};

export const consumePendingSalesPrompt = (): string | null => {
  try {
    const prompt = sessionStorage.getItem(STORAGE_KEYS.PENDING_SALES_PROMPT);
    if (prompt) {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING_SALES_PROMPT);
    }
    return prompt;
  } catch {
    return null;
  }
};

// ─── JWT Cache ──────────────────────────────────────────────────────────────

export let cachedJwt: { token: string; expiresAt: number } | null = null;

export const clearCachedJwt = () => { cachedJwt = null; };

export const getJwt = async (): Promise<string | null> => {
  if (cachedJwt && Date.now() < cachedJwt.expiresAt) return cachedJwt.token;
  const { supabaseClient } = await import('../../supabase/client');
  const session = await supabaseClient?.auth.getSession();
  const token = session?.data?.session?.access_token ?? null;
  if (token) cachedJwt = { token, expiresAt: Date.now() + 30_000 };
  return token;
};
