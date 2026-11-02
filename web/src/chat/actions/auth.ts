/**
 * Authentication Actions
 *
 * The server owns the session (cookie). On load the profile tells who is
 * signed in; a 401 means nobody is. Signing in and out are page navigations.
 */

import { store } from '../app/store';
import { cacheUserState, clearCachedUserState, persistLocaleSelection, signedOutUserState } from '../app/state';
import { profileLoadError, profileLoadSuccess, profileStartLoading } from '../app/profileState';
import { api, isUnauthorized, signIn, signOut, stopImpersonation, type Profile } from '../api';
import { conversationIdFromPath } from '../app/route';
import { locales } from '../content';
import { getLocaleDateString } from '../utils/date';
import { applyThemeMode } from './theme';
import {
  clearAllCachedChatMessages,
  clearPendingPrompt,
  connectEvents,
  consumePendingPrompt,
  disconnectEvents,
  loadConversations,
  openConversation,
  readPendingPrompt,
  sendPendingPrompt,
  showAnonymousChat,
} from './chat';

// ─── Sign-in / sign-out ─────────────────────────────────────────────────────

/**
 * Sends the browser to sign-in; it comes back to the page it left (a typed
 * prompt starts a new chat, so that one comes back to `/`).
 */
export const handleSignIn = () => {
  store.setState({ isAuthMenuOpen: false });
  signIn(readPendingPrompt() ? '/' : window.location.pathname);
};

/** Forgets everything stored for the user in this browser, then signs out. */
export const handleSignOut = () => {
  clearPendingPrompt();
  clearCachedUserState();
  clearAllCachedChatMessages();
  disconnectEvents();
  signOut();
};

/** Admins: back to being themselves. */
export const handleStopImpersonation = () => {
  stopImpersonation();
  clearCachedUserState();
  disconnectEvents();
  window.location.href = '/';
};

/** A user whose deletion is pending can't use the account: tell them and sign out. */
export const handlePendingDeletionSignOut = (requestedAt: number | null) => {
  const { localeKey } = store.state;
  const dateText = getLocaleDateString(requestedAt, localeKey) ?? '30 days';
  alert(locales[localeKey].settings.sections.privacy.deletePendingLogin.replace('{{date}}', dateText));
  handleSignOut();
};

// ─── Session start ──────────────────────────────────────────────────────────

const applySignedOut = () => {
  const state = store.state;
  const wasAuthenticated = state.isAuthenticated;
  Object.assign(state, signedOutUserState());
  cacheUserState(state);
  if (wasAuthenticated) {
    // The cached conversation belonged to a session that has ended.
    showAnonymousChat();
  }
  store.notify();
};

const applyProfile = (profile: Profile) => {
  const state = store.state;
  state.isAuthenticated = true;
  state.userId = profile.user_id;
  state.userEmail = profile.email;
  state.userDisplayName = profile.name.trim() || null;
  state.isAdmin = profile.is_admin;
  state.impersonating = profile.impersonating;
  state.awaitingApproval = !profile.approved && !profile.impersonating;
  state.budget = profile.budget ?? null;
  state.isAuthMenuOpen = false;
  profileLoadSuccess(state.profile, profile);

  // New profiles start out as 'en': only another language is a choice the
  // user made, which then wins over the browser's language.
  if (profile.language !== 'en' && profile.language !== state.localeKey) {
    state.localeKey = profile.language;
    persistLocaleSelection(profile.language);
  }
  if (profile.theme !== state.themeMode) {
    applyThemeMode(profile.theme);
  }
};

/** Loads who is signed in, then their conversations and the one in the URL. */
export const startSession = async () => {
  const state = store.state;
  profileStartLoading(state.profile);

  let profile: Profile;
  try {
    profile = await api.profile.me();
  } catch (error) {
    if (!isUnauthorized(error)) {
      console.error('[auth] loading the profile failed', error);
      profileLoadError(state.profile, error instanceof Error ? error.message : String(error));
    }
    applySignedOut();
    return;
  }

  applyProfile(profile);
  if (profile.deletion_requested_at && !profile.impersonating) {
    handlePendingDeletionSignOut(state.profile.deletionRequestedAt);
    return;
  }
  cacheUserState(state);
  store.notify();
  // Nothing to load until an admin lets the account in: App shows why.
  if (state.awaitingApproval) return;

  void connectEvents();
  void loadConversations();
  const pendingPrompt = profile.impersonating ? null : consumePendingPrompt();
  if (pendingPrompt) {
    await sendPendingPrompt(pendingPrompt);
  } else {
    await openConversation(conversationIdFromPath(window.location.pathname), 'none');
  }
};
