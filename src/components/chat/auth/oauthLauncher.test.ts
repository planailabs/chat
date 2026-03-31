import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreAuthCachePayload } from './preAuthCache';
import { createOAuthLauncher } from './oauthLauncher';
import type { AuthProvider } from './controller';

const createMockCache = () => {
  let cache: PreAuthCachePayload | null = null;

  const appendPrompt = vi.fn((content: string) => {
    const prompt = {
      id: 'uuid-1',
      content,
      createdAt: 1,
    };
    cache = {
      prompts: [prompt],
      localeKey: 'en',
      heroPhase: 'chat',
      timestamp: 1,
      restored: false,
      pendingAuth: false,
    };
    return cache;
  });

  const readCache = vi.fn(() => cache);
  const updateCache = vi.fn((updates: Partial<PreAuthCachePayload>) => {
    if (!cache) {
      return null;
    }
    cache = { ...cache, ...updates };
    return cache;
  });
  const clearCache = vi.fn(() => {
    cache = null;
  });

  const createCache = vi.fn((localeKey) => {
    cache = {
      prompts: [],
      localeKey,
      heroPhase: 'composer',
      timestamp: 1,
      restored: false,
      pendingAuth: false,
    };
    return cache;
  });

  const saveCache = vi.fn((payload) => {
    cache = payload;
  });

  return {
    appendPrompt,
    readCache,
    updateCache,
    clearCache,
    createCache,
    saveCache,
    get cache() {
      return cache;
    },
  };
};

const baseContext = {
  origin: 'chat' as const,
  localeKey: 'en' as const,
  heroPhase: 'chat' as const,
};

const resolveImmediately = vi.fn(async () => {});

beforeEach(() => {
  resolveImmediately.mockClear();
});

describe('oauthLauncher', () => {
  it('appends prompt and marks cache pending before launching', async () => {
    const cache = createMockCache();
    const launcher = createOAuthLauncher({
      appendPrompt: cache.appendPrompt,
      readCache: cache.readCache,
      updateCache: cache.updateCache,
      clearCache: cache.clearCache,
      createCache: cache.createCache,
      saveCache: cache.saveCache,
      signIn: resolveImmediately,
      now: () => 123,
    });

    const result = await launcher.launch('google', {
      ...baseContext,
      prompt: 'Cached prompt',
      selectedProvider: 'google',
    });

    expect(result.status).toBe('started');
    expect(cache.appendPrompt).toHaveBeenCalledWith('Cached prompt', 'en');
    expect(cache.updateCache).toHaveBeenCalledWith({
      localeKey: 'en',
      heroPhase: 'chat',
      timestamp: 123,
      restored: false,
      pendingAuth: true,
      source: 'chat',
      selectedProvider: 'google',
    });
    expect(resolveImmediately).toHaveBeenCalledWith('google');
  });

  it('skips duplicate launches while OAuth is in flight', async () => {
    const cache = createMockCache();
    const signIn = vi
      .fn<(provider: AuthProvider) => Promise<void>>()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
    const launcher = createOAuthLauncher({
      appendPrompt: cache.appendPrompt,
      readCache: cache.readCache,
      updateCache: cache.updateCache,
      clearCache: cache.clearCache,
      createCache: cache.createCache,
      saveCache: cache.saveCache,
      signIn,
      now: () => 123,
    });

    void launcher.launch('google', { ...baseContext, prompt: 'First try' });
    const secondResult = await launcher.launch('google', {
      ...baseContext,
      prompt: 'Second try',
    });

    expect(secondResult.status).toBe('skipped');
    expect(secondResult.reason).toBe('in-flight');
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('clears pending flag when OAuth launch fails', async () => {
    const cache = createMockCache();
    const error = new Error('missing env');
    const signIn = vi
      .fn<(provider: AuthProvider) => Promise<void>>()
      .mockRejectedValueOnce(error);
    const launcher = createOAuthLauncher({
      appendPrompt: cache.appendPrompt,
      readCache: cache.readCache,
      updateCache: cache.updateCache,
      clearCache: cache.clearCache,
      createCache: cache.createCache,
      saveCache: cache.saveCache,
      signIn,
      now: () => 123,
    });

    const result = await launcher.launch('google' as AuthProvider, {
      ...baseContext,
      prompt: 'Broken prompt',
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe(error);
    expect(cache.updateCache).toHaveBeenLastCalledWith({
      pendingAuth: false,
      source: undefined,
      selectedProvider: null,
    });
  });

  it('creates cache and persists pendingAuth for nav origin without prompt', async () => {
    const cache = createMockCache();
    const launcher = createOAuthLauncher({
      appendPrompt: cache.appendPrompt,
      readCache: cache.readCache,
      updateCache: cache.updateCache,
      clearCache: cache.clearCache,
      createCache: cache.createCache,
      saveCache: cache.saveCache,
      signIn: resolveImmediately,
      now: () => 123,
    });

    const result = await launcher.launch('google', {
      ...baseContext,
      origin: 'nav',
      prompt: null,
    });

    expect(result.status).toBe('started');
    expect(cache.createCache).toHaveBeenCalled(); // Should create cache
    expect(cache.updateCache).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingAuth: true,
        source: 'nav',
      }),
    );
  });
});
