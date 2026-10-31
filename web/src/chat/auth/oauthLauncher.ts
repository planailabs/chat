import type { HeroPhase } from '../app/state';
import type { LocaleKey } from '../content';
import {
  appendPromptToCache,
  clearPreAuthState,
  createBaseCache,
  readPreAuthState,
  savePreAuthState,
  updatePreAuthState,
  type PreAuthCachePayload,
} from './preAuthCache';
import { signInWithProvider, type AuthProvider } from './controller';

export type OAuthLaunchOrigin = 'chat' | 'nav';

export interface OAuthLaunchContext {
  origin: OAuthLaunchOrigin;
  localeKey: LocaleKey;
  heroPhase: HeroPhase;
  prompt?: string | null;
  selectedProvider?: string | null;
}

export interface OAuthLaunchResult {
  status: 'started' | 'skipped' | 'error';
  reason?: 'in-flight';
  error?: unknown;
}

interface OAuthLauncherDeps {
  readCache: typeof readPreAuthState;
  appendPrompt: typeof appendPromptToCache;
  updateCache: typeof updatePreAuthState;
  clearCache: typeof clearPreAuthState;
  createCache: typeof createBaseCache;
  saveCache: typeof savePreAuthState;
  signIn: (provider: AuthProvider) => Promise<void>;
  now: () => number;
}

const defaultDeps: OAuthLauncherDeps = {
  readCache: readPreAuthState,
  appendPrompt: appendPromptToCache,
  updateCache: updatePreAuthState,
  clearCache: clearPreAuthState,
  createCache: createBaseCache,
  saveCache: savePreAuthState,
  signIn: signInWithProvider,
  now: () => Date.now(),
};

export const createOAuthLauncher = (overrides?: Partial<OAuthLauncherDeps>) => {
  const deps: OAuthLauncherDeps = { ...defaultDeps, ...overrides };
  let isInFlight = false;

  const ensurePromptCached = (
    prompt: string | null | undefined,
    localeKey: LocaleKey,
  ): PreAuthCachePayload => {
    let cache = deps.readCache();
    const trimmedPrompt = prompt?.trim();

    if (trimmedPrompt) {
      const lastContent =
        cache?.prompts[cache.prompts.length - 1]?.content ?? null;
      if (!cache || lastContent !== trimmedPrompt) {
        cache = deps.appendPrompt(trimmedPrompt, localeKey);
      }
    } else if (!cache) {
      // If no prompt and no cache, create a base cache so we can persist pendingAuth
      cache = deps.createCache(localeKey);
      deps.saveCache(cache);
    }

    // Return cache (guaranteed to be non-null now unless createCache failed)
    return cache || deps.createCache(localeKey);
  };

  const launch = async (
    provider: AuthProvider,
    context: OAuthLaunchContext,
  ): Promise<OAuthLaunchResult> => {
    if (isInFlight) {
      return {
        status: 'skipped',
        reason: 'in-flight',
      };
    }

    let cache = ensurePromptCached(context.prompt, context.localeKey);

    // We always want to track pendingAuth, even if prompts are empty (Nav flow)
    cache = deps.updateCache({
      localeKey: context.localeKey,
      heroPhase: context.heroPhase,
      timestamp: deps.now(),
      restored: false,
      pendingAuth: true,
      source: context.origin,
      selectedProvider: context.selectedProvider ?? null,
    })!; // updateCache returns null only if cache missing, but we ensured it exists.

    try {
      isInFlight = true;
      await deps.signIn(provider);
      return { status: 'started' };
    } catch (error) {
      if (cache) {
        deps.updateCache({
          pendingAuth: false,
          source: undefined,
          selectedProvider: null,
        });
      }
      return { status: 'error', error };
    } finally {
      isInFlight = false;
    }
  };

  const getIsInFlight = () => isInFlight;

  return {
    launch,
    isInFlight: getIsInFlight,
  };
};
