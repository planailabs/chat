/**
 * Authentication Actions
 *
 * Handles OAuth sign-in/out flows and session state management.
 * Coordinates between Supabase auth, UI state, and profile sync.
 */

import { store } from '../app/store';
import { cacheUserState, clearCachedUserState } from '../app/state';
import {
  signOut,
  type AuthProvider,
  checkAdminStatus,
} from '../auth/controller';
import {
  createOAuthLauncher,
  type OAuthLaunchResult,
} from '../auth/oauthLauncher';
import { clearPreAuthState } from '../auth/preAuthCache';
import { ctaController } from '../chat/ctaController';
import { syncCachedPromptsToSupabase } from './messages';
import { loadProfilePreferences } from './profile';
import { persistProfilePreferences } from '../supabase/profile';
import { locales } from '../content';
import type { Session } from '@supabase/supabase-js';
import {
  tryStartPostLoginSequence,
  setShouldRunPostLoginSequence,
  clearMachineConfigMessages,
  disconnectEvents,
  consumePendingSalesPrompt,
  sendPendingSalesPrompt,
} from './chat';
import {
  USER_METADATA_NAME_KEYS,
  USER_METADATA_AVATAR_KEYS,
} from '../constants';
import { isImpersonating } from '../impersonation';

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Flow
// ─────────────────────────────────────────────────────────────────────────────

const oauthLauncher = createOAuthLauncher();

export const handleSignOut = async () => {
  clearPreAuthState();
  clearCachedUserState();
  clearMachineConfigMessages();
  disconnectEvents();
  try {
    await signOut();
  } catch (error) {
    console.error('Sign out failed', error);
  } finally {
    const win = typeof window !== 'undefined' ? window : undefined;
    if (win?.location) {
      win.location.reload();
    } else {
      store.reset();
    }
  }
};

export const handleOAuthLaunchResult = (
  result: OAuthLaunchResult,
  origin: 'chat' | 'nav',
) => {
  if (result.status === 'error') {
    console.error('OAuth sign-in failed', result.error);
    if (origin === 'chat') {
      ctaController.resetAuthCtas();
    }
  }
};

export const launchOAuthFlow = async (
  provider: AuthProvider,
  origin: 'chat' | 'nav',
) => {
  const state = store.state;
  const result = await oauthLauncher.launch(provider, {
    origin,
    localeKey: state.localeKey,
    heroPhase: state.heroPhase,
    prompt: state.chat?.userPrompt ?? null,
    selectedProvider: state.chat?.selectedCta ?? null,
  });
  handleOAuthLaunchResult(result, origin);
};

/**
 * Extracts display name from OAuth provider metadata.
 * Searches through common metadata keys in priority order.
 */
const extractUserDisplayName = (
  metadata: Record<string, unknown> | undefined | null,
): string | null => {
  if (!metadata) {
    return null;
  }
  for (const key of USER_METADATA_NAME_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
};

/**
 * Extracts avatar URL from OAuth provider metadata.
 * Searches through common metadata keys in priority order.
 */
const extractUserAvatarUrl = (
  metadata: Record<string, unknown> | undefined | null,
): string | null => {
  if (!metadata) {
    return null;
  }
  for (const key of USER_METADATA_AVATAR_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
};

const buildProviderIdentity = (
  session: Session | null,
  displayName: string | null,
  avatarUrl: string | null,
) => {
  const user = session?.user;
  if (!user) {
    return {};
  }
  return {
    provider: user.app_metadata?.provider ?? null,
    email: user.email ?? null,
    name: displayName,
    avatar_url: avatarUrl,
    metadata: user.user_metadata ?? null,
    identities: user.identities ?? null,
  };
};

export const applySessionToState = (session: Session | null) => {
  const state = store.state;
  const nextAuthenticated = Boolean(session?.user);
  const nextEmail = session?.user?.email ?? null;
  const nextUserId = session?.user?.id ?? null;
  const userMetadata = (session?.user?.user_metadata ?? null) as Record<
    string,
    unknown
  > | null;
  const nextAvatar = extractUserAvatarUrl(userMetadata);
  const nextDisplayName = extractUserDisplayName(userMetadata);

  // Optimistically keep admin status if user hasn't changed to prevent flicker
  // If user changed or logged out, reset to false until verified
  let nextIsAdmin = false;
  if (nextAuthenticated && state.userId === nextUserId && state.isAdmin) {
    nextIsAdmin = true;
  }

  // Update state — when impersonating, defer identity to profile load
  state.isAuthenticated = nextAuthenticated;
  state.userId = nextUserId;
  state.isAdmin = nextIsAdmin;
  if (isImpersonating()) {
    // Keep identity null until impersonated user's profile loads
    state.userEmail = null;
    state.userAvatarUrl = null;
    state.userDisplayName = null;
  } else {
    state.userEmail = nextEmail;
    state.userAvatarUrl = nextAvatar;
    state.userDisplayName = nextDisplayName;
  }

  // Cache user state for instant header render on page reload
  // Preserve existing customerToken — it's set later by loadProfilePreferences
  cacheUserState({
    isAuthenticated: nextAuthenticated,
    userId: nextUserId,
    userEmail: nextEmail,
    userAvatarUrl: nextAvatar,
    userDisplayName: nextDisplayName,
    isAdmin: nextIsAdmin,
    customerToken: state.customerToken,
  });

  // Verify admin status asynchronously if authenticated
  if (nextAuthenticated) {
    checkAdminStatus().then((isAdmin) => {
      // Only update if changed (and user is still the same - check if needed? store.state is live)
      if (
        store.state.isAdmin !== isAdmin &&
        store.state.userId === nextUserId
      ) {
        store.setState({ isAdmin });
        // Update cache with verified status
        cacheUserState({
          isAuthenticated: store.state.isAuthenticated,
          userId: store.state.userId,
          userEmail: store.state.userEmail,
          userAvatarUrl: store.state.userAvatarUrl,
          userDisplayName: store.state.userDisplayName,
          isAdmin: isAdmin,
          customerToken: store.state.customerToken,
        });
      }
    });
  }

  if (nextAuthenticated && nextUserId && !isImpersonating()) {
    const providerIdentity = buildProviderIdentity(
      session,
      nextDisplayName,
      nextAvatar,
    );
    void persistProfilePreferences({
      userId: nextUserId,
      providerIdentity,
    });
  }

  if (nextAuthenticated) {
    state.isAuthMenuOpen = false;

    // Lock auth CTAs now that sign-in is confirmed
    // (buttons stay clickable until this point for iOS back-navigation)
    if (state.chat?.ctaVisible && !state.chat.isCtaLocked) {
      ctaController.lockAuthCtas();
    }

    // Clean up URL hash if it contains auth tokens
    if (
      typeof window !== 'undefined' &&
      window.location.hash &&
      window.location.hash.includes('access_token')
    ) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }

    syncCachedPromptsToSupabase();
    const maybePromise = loadProfilePreferences(locales[state.localeKey]);

    // Check for a pending sales prompt saved before sign-in
    const pendingSalesPrompt = consumePendingSalesPrompt();
    if (pendingSalesPrompt) {
      // Init sales chat, cancel any pending question, then send the prompt
      void sendPendingSalesPrompt(pendingSalesPrompt);
    } else if (state.chat?.restoredFromChatCta && !state.chat.postLogin) {
      // Only trigger post-login sequence if we are restoring AND it hasn't started yet.
      setShouldRunPostLoginSequence(true);

      // We must wait for profile preferences to load (newsletter status) before starting.
      if (maybePromise) {
        void maybePromise.then(() => {
          tryStartPostLoginSequence();
        });
      } else {
        // If no promise (already loaded or not needed), try immediately.
        tryStartPostLoginSequence();
      }
    }
  }

  store.notify();
};
