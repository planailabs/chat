import type { HeroPhase } from '../app/state';
import type { LocaleKey } from '../content';
import { STORAGE_KEYS } from '../constants';

const CACHE_KEY = STORAGE_KEYS.PRE_AUTH_CACHE;

export interface CachedPrompt {
  id: string;
  content: string;
  createdAt: number;
  localeKey?: LocaleKey;
}

export interface PreAuthCachePayload {
  prompts: CachedPrompt[];
  localeKey: LocaleKey;
  heroPhase: HeroPhase;
  timestamp: number;
  restored?: boolean;
  source?: 'chat' | 'nav';
  pendingAuth?: boolean;
  selectedProvider?: string | null;
}

const getStorage = (type: 'session' | 'local'): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storage =
      type === 'session' ? window.sessionStorage : window.localStorage;
    if (!storage) return null;
    // Test storage access (some browsers throw on property access if disabled)
    const key = '__storage_test__';
    storage.setItem(key, key);
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
};

const readCache = (): PreAuthCachePayload | null => {
  // Try sessionStorage first
  const session = getStorage('session');
  if (session) {
    const raw = session.getItem(CACHE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as PreAuthCachePayload;
      } catch {
        // invalid json
      }
    }
  }

  // Fallback to localStorage (for Android Chrome / Custom Tabs isolation)
  const local = getStorage('local');
  if (local) {
    const raw = local.getItem(CACHE_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw) as PreAuthCachePayload;
        // If found in local, we might want to migrate it to session for consistency,
        // but for now just returning it is enough.
        // We verify timestamp to ensure we don't pick up stale data?
        // 30 min expiration
        if (Date.now() - data.timestamp < 30 * 60 * 1000) {
          return data;
        }
      } catch {
        // invalid json
      }
    }
  }
  return null;
};

export const readPreAuthState = () => readCache();

const writeCache = (payload: PreAuthCachePayload) => {
  const str = JSON.stringify(payload);

  // Write to sessionStorage
  const session = getStorage('session');
  if (session) {
    try {
      session.setItem(CACHE_KEY, str);
    } catch {
      /* ignore */
    }
  }

  // Write to localStorage as backup
  const local = getStorage('local');
  if (local) {
    try {
      local.setItem(CACHE_KEY, str);
    } catch {
      /* ignore */
    }
  }
};

export const savePreAuthState = (payload: PreAuthCachePayload) =>
  writeCache(payload);

export const updatePreAuthState = (updates: Partial<PreAuthCachePayload>) => {
  const current = readCache();
  if (!current) {
    return null;
  }
  const next = { ...current, ...updates };
  writeCache(next);
  return next;
};

export const clearPreAuthState = () => {
  const session = getStorage('session');
  if (session) {
    try {
      session.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
  const local = getStorage('local');
  if (local) {
    try {
      local.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
};

export const createBaseCache = (localeKey: LocaleKey): PreAuthCachePayload => ({
  prompts: [],
  localeKey,
  heroPhase: 'composer',
  timestamp: Date.now(),
  restored: false,
  pendingAuth: false,
});

export const createCachedPrompt = (
  content: string,
  localeKey: LocaleKey,
): CachedPrompt => ({
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  content,
  createdAt: Date.now(),
  localeKey,
});

export const appendPromptToCache = (
  content: string,
  localeKey: LocaleKey,
  providedPrompt?: CachedPrompt,
) => {
  const existing = readCache() ?? createBaseCache(localeKey);
  const prompt: CachedPrompt = providedPrompt
    ? { ...providedPrompt, localeKey: providedPrompt.localeKey ?? localeKey }
    : createCachedPrompt(content, localeKey);
  const next: PreAuthCachePayload = {
    ...existing,
    localeKey,
    heroPhase: 'chat',
    timestamp: Date.now(),
    pendingAuth: existing.pendingAuth ?? false,
    selectedProvider: existing.selectedProvider ?? null,
    prompts: [...existing.prompts, prompt],
  };
  savePreAuthState(next);
  return next;
};
