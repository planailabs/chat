/**
 * Conversation list actions — the sidebar's list in the store: loaded from
 * the server, updated by the event stream, renamed by the user.
 */

import { store } from '../../app/store';
import { api } from '../../api';
import { cacheConversations, clearCachedChatMessages, readCachedConversations } from './cache';
import { mergeConversations, updateConversation, type ConversationItem } from './conversationList';

export const setConversations = (list: ConversationItem[]) => {
  store.state.conversations = list;
  cacheConversations(list);
  store.notify();
};

/** First render: the list as the last visit left it. */
export const showCachedConversations = () => {
  store.state.conversations = readCachedConversations();
};

/** Refetches the list from the server. */
export const loadConversations = async () => {
  if (!store.state.isAuthenticated) return;
  try {
    const list = await api.chat.list();
    setConversations(mergeConversations(list, store.state.conversations));
  } catch (error) {
    console.error('[chat] loading the conversations failed', error);
  }
};

let refetchTimer: ReturnType<typeof setTimeout> | null = null;

/** Refetches the list shortly (several unknown events in a row: once). */
export const refetchConversationsSoon = () => {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    void loadConversations();
  }, 250);
};

/** Changes one entry; `at` also marks activity (moves it to the top). */
export const patchConversation = (id: string, patch: Partial<ConversationItem>, at?: Date) => {
  setConversations(updateConversation(store.state.conversations, id, patch, at));
};

/** Puts a conversation at the top (replacing an entry with its id). */
export const addConversation = (item: ConversationItem) => {
  setConversations([item, ...store.state.conversations.filter((c) => c.id !== item.id)]);
};

/** Drops a conversation from the list and its cached messages. */
export const forgetConversation = (id: string) => {
  clearCachedChatMessages(id);
  setConversations(store.state.conversations.filter((c) => c.id !== id));
};

export const startRenaming = (id: string) => {
  store.setState({ renamingConversationId: id });
};

export const stopRenaming = () => {
  if (store.state.renamingConversationId !== null) store.setState({ renamingConversationId: null });
};

/** Saves a new title; empty or unchanged ends editing without a request. */
export const renameConversation = async (id: string, title: string) => {
  stopRenaming();
  const current = store.state.conversations.find((c) => c.id === id);
  const trimmed = title.trim();
  if (!current || !trimmed || trimmed === current.title) return;
  patchConversation(id, { title: trimmed });
  try {
    await api.chat.rename(id, trimmed);
  } catch (error) {
    console.error('[chat] renaming failed', error);
    patchConversation(id, { title: current.title });
  }
};
