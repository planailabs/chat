import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendPromptToCache,
  clearPreAuthState,
  readPreAuthState,
  updatePreAuthState,
} from './preAuthCache';

const createMockSessionStorage = () => {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  return storage;
};

describe('preAuthCache', () => {
  beforeEach(() => {
    const storage = createMockSessionStorage();
    vi.stubGlobal('window', { sessionStorage: storage } as Window &
      typeof globalThis);
    let counter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => {
        counter += 1;
        return `uuid-${counter}`;
      }),
    });
    clearPreAuthState();
  });

  it('stores prompts in order with metadata', () => {
    appendPromptToCache('First prompt', 'en');
    appendPromptToCache('Second prompt', 'en');

    const cached = readPreAuthState();
    expect(cached).not.toBeNull();
    expect(cached?.prompts).toHaveLength(2);
    expect(cached?.prompts[0].content).toBe('First prompt');
    expect(cached?.prompts[1].content).toBe('Second prompt');
    expect(cached?.heroPhase).toBe('chat');
  });

  it('preserves prompts when updating metadata', () => {
    appendPromptToCache('Only prompt', 'en');
    updatePreAuthState({
      pendingAuth: true,
      source: 'chat',
    });

    const cached = readPreAuthState();
    expect(cached?.pendingAuth).toBe(true);
    expect(cached?.source).toBe('chat');
    expect(cached?.prompts[0].content).toBe('Only prompt');
  });

  it('clears cache correctly', () => {
    appendPromptToCache('Clear me', 'en');
    clearPreAuthState();
    expect(readPreAuthState()).toBeNull();
  });
});
