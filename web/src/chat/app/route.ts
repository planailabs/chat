/**
 * URL routing: `/` is a new chat, `/c/<conversation-id>` an open
 * conversation. The server serves index.html for any path.
 */

const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The conversation a path names, or null (new chat). */
export const conversationIdFromPath = (pathname: string): string | null =>
  CONVERSATION_PATH.exec(pathname)?.[1]?.toLowerCase() ?? null;

export const pathForConversation = (id: string | null): string => (id ? `/c/${id}` : '/');

export type HistoryMode = 'push' | 'replace' | 'none';

/** Moves the address bar; the app plugs in Vue Router's push/replace. */
export interface Navigator {
  push(path: string): void;
  replace(path: string): void;
}

const historyNavigator: Navigator = {
  push: (path) => window.history.pushState({}, '', path),
  replace: (path) => window.history.replaceState({}, '', path),
};

let navigator: Navigator | null = null;

/** Routes URL changes through `nav` (the app's router) instead of window.history. */
export const useNavigator = (nav: Navigator | null): void => {
  navigator = nav;
};

/** Points the address bar at the conversation (no reload). */
export const setConversationPath = (id: string | null, mode: HistoryMode): void => {
  if (mode === 'none' || typeof window === 'undefined') return;
  const path = pathForConversation(id);
  if (window.location.pathname === path) return;
  const nav = navigator ?? historyNavigator;
  if (mode === 'push') nav.push(path);
  else nav.replace(path);
};
