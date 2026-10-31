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

/** Points the address bar at the conversation (no reload). */
export const setConversationPath = (id: string | null, mode: HistoryMode): void => {
  if (mode === 'none' || typeof window === 'undefined') return;
  const path = pathForConversation(id);
  if (window.location.pathname === path) return;
  if (mode === 'push') {
    window.history.pushState({ conversation: id }, '', path);
  } else {
    window.history.replaceState({ conversation: id }, '', path);
  }
};
