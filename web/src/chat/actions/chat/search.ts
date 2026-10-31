/**
 * Searching the user's own conversations (sidebar): the server's hits
 * grouped by conversation, their snippets as safe HTML, and opening a hit.
 */

import { store } from '../../app/store';
import { api, type SearchHit } from '../../api';
import { escapeHtml } from '../../utils/escape';
import { openConversation } from './session';

/** The server marks matches between these two private-use characters. */
export const MATCH_OPEN = '';
export const MATCH_CLOSE = '';

/**
 * A snippet as HTML: everything escaped, then only the match markers turned
 * into <mark>…</mark> (an unclosed one is closed at the end).
 */
export const snippetHtml = (snippet: string): string => {
  let open = false;
  let html = '';
  for (const part of escapeHtml(snippet).split(/([])/)) {
    if (part === MATCH_OPEN) {
      if (!open) html += '<mark>';
      open = true;
    } else if (part === MATCH_CLOSE) {
      if (open) html += '</mark>';
      open = false;
    } else {
      html += part;
    }
  }
  return open ? `${html}</mark>` : html;
};

/** The snippet as plain text (markers removed). */
export const snippetText = (snippet: string): string => snippet.replace(/[]/g, '');

/** The whole title with the (possibly cropped) title snippet's matches marked in place. */
export const titleHtml = (title: string, snippet: string): string => {
  const plain = snippetText(snippet);
  const at = plain ? title.indexOf(plain) : -1;
  if (at < 0) return snippetHtml(snippet);
  return escapeHtml(title.slice(0, at)) + snippetHtml(snippet) + escapeHtml(title.slice(at + plain.length));
};

export interface SearchGroup {
  conversation: string;
  title: string;
  /** The title's snippet when the title matched. */
  titleHit: SearchHit | null;
  /** Message hits, best first, at most `perGroup`. */
  hits: SearchHit[];
}

/** Hits grouped by conversation, in the order of each conversation's best hit. */
export const groupHits = (hits: SearchHit[], perGroup = 3): SearchGroup[] => {
  const groups = new Map<string, SearchGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.conversation);
    if (!group) {
      group = { conversation: hit.conversation, title: hit.title, titleHit: null, hits: [] };
      groups.set(hit.conversation, group);
    }
    if (hit.message_id === null) group.titleHit ??= hit;
    else if (group.hits.length < perGroup) group.hits.push(hit);
  }
  return [...groups.values()];
};

/** Empty or punctuation-only queries aren't sent (the server answers [] anyway). */
export const isSearchable = (q: string): boolean => /[\p{L}\p{N}]/u.test(q);

export const searchConversations = async (q: string): Promise<SearchHit[]> => (isSearchable(q) ? api.chat.search(q.trim()) : []);

/** Opens the hit's conversation; a message hit is scrolled to and highlighted. */
export const openSearchHit = async (conversation: string, messageId: number | null) => {
  if (conversation !== store.state.activeConversationId) await openConversation(conversation, 'push');
  else store.state.isSidebarOpen = false;
  store.state.highlightMessageId = messageId;
};
