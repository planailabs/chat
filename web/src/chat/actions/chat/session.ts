/**
 * Chat Session — which conversation is on screen: a new chat (`/`) or a
 * conversation (`/c/<id>`), shown from the cache first, then from the
 * server's history (and what it waits on). Also the prompt an anonymous user
 * typed before signing in, sent as a new conversation.
 */

import { store } from '../../app/store';
import type { ChatMessage, ChatPhase } from '../../app/state';
import { conversationIdFromPath, setConversationPath, type HistoryMode } from '../../app/route';
import { locales } from '../../content';
import { ApiError, api, type History } from '../../api';
import { readCachedChatMessages, readPendingPrompt, cacheChatMessages } from './cache';
import { connectEvents } from './sse';
import { questionPrompt } from './events';
import { historyToChat, isWorkingPhase } from './history';
import { forgetConversation, loadConversations, patchConversation, showCachedConversations } from './conversations';
import { clearChatTimers, sendChatMessage, transition } from './stateMachine';

const locale = () => locales[store.state.localeKey];

export const initChat = (messages: ChatMessage[], phase: ChatPhase = 'idle') => {
  store.state.chat = { messages, phase, approvals: [] };
  store.notify();
};

/** Signed out: an empty chat, or the stashed prompt with the sign-in invite. */
export const showAnonymousChat = () => {
  store.state.activeConversationId = null;
  store.state.conversations = [];
  const pending = readPendingPrompt();
  if (!pending) {
    initChat([]);
    return;
  }
  const invite = locale().chat.loginInvite;
  initChat([{ role: 'user', content: pending }], 'login');
  store.state.chat!.loginInvite = {
    text: invite.text,
    visibleText: invite.text,
    stream: invite.stream,
    isStreaming: false,
    ctaVisible: true,
  };
  store.notify();
};

/** First render, before the profile is known: whatever the last visit showed. */
export const showCachedChat = () => {
  if (!store.state.isAuthenticated) {
    showAnonymousChat();
    return;
  }
  showCachedConversations();
  const id = conversationIdFromPath(window.location.pathname);
  store.state.activeConversationId = id;
  initChat(id ? readCachedChatMessages(id) : []);
};

/** The history, null when it couldn't be loaded, 'gone' when it no longer exists. */
const loadHistory = async (id: string): Promise<History | 'gone' | null> => {
  try {
    return await api.chat.history(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return 'gone';
    console.error('[chat] loading the history failed', error);
    return null;
  }
};

const isLive = (phase: ChatPhase) => phase === 'waiting' || phase === 'streaming' || phase === 'tool';

/** Replaces the chat with the server's record of it. */
const applyHistoryUnsafe = (history: History) => {
  const mc = store.state.chat;
  if (!mc) return;
  const snapshot = historyToChat(history, locale());
  // A turn in progress keeps showing its progress: the server's phase says
  // whether the agent works (the list's flag only when it doesn't say).
  const working = history.phase ? isWorkingPhase(history.phase) : store.state.conversations.find((c) => c.id === history.id)?.busy === true;
  // Live: events of this conversation already drive the chat (not just the list's guess).
  const liveNow = isLive(mc.phase) && !mc.assumedWorking;
  const busy = liveNow || working;
  mc.assumedWorking = false;
  if (history.phase) patchConversation(history.id, { busy: working && !snapshot.pendingQuestion && snapshot.approvals.length === 0 });

  clearChatTimers();
  mc.streamingText = undefined;
  mc.messages = snapshot.messages;
  mc.approvals = snapshot.approvals;
  if (snapshot.pendingQuestion) {
    transition(mc, 'question');
    const { callId, toolName, input } = snapshot.pendingQuestion;
    mc.clientPrompt = questionPrompt(callId, toolName, input, false);
  } else if (snapshot.approvals.length > 0) {
    transition(mc, 'approval');
  } else if (busy) {
    // Running tools: the working spinner, as the live tool_start would show it.
    // (A missed tool_start shows as the spinner too.)
    if (!liveNow || (mc.phase === 'waiting' && history.phase === 'tools')) transition(mc, history.phase === 'tools' ? 'tool' : 'waiting');
  } else {
    transition(mc, 'idle');
  }
  cacheChatMessages(mc.messages, history.id);
  store.notify();
};

/** Applies a history; a record it can't read shows an error line instead of breaking the chat. */
const applyHistory = (history: History) => {
  try {
    applyHistoryUnsafe(history);
  } catch (error) {
    console.error('[chat] applying the history failed', error, history);
    const mc = store.state.chat;
    if (!mc) return;
    transition(mc, 'error');
    mc.error = locale().chat.errors.generic;
    store.notify();
  }
};

/** The conversation on screen no longer exists: back to a new chat. */
const conversationGone = (id: string) => {
  forgetConversation(id);
  if (store.state.activeConversationId === id) void openConversation(null, 'replace');
};

/** Refetches the open conversation (the event stream missed something). */
export const resyncOpenConversation = async () => {
  const id = store.state.activeConversationId;
  if (!id) return;
  const history = await loadHistory(id);
  if (store.state.activeConversationId !== id) return;
  if (history === 'gone') conversationGone(id);
  else if (history) applyHistory(history);
};

/** Refetches everything shown: the list and the open conversation. */
export const resyncAll = async () => {
  await Promise.all([loadConversations(), resyncOpenConversation()]);
};

/**
 * Shows conversation `id` (null: a new chat) and points the URL at it
 * (`nav`: push a history entry, replace it, or leave the URL alone).
 */
export const openConversation = async (id: string | null, nav: HistoryMode = 'push') => {
  const state = store.state;
  const previous = state.activeConversationId;
  // Leaving a conversation mid-turn: the sidebar shows it working.
  if (previous && previous !== id && state.chat && isLive(state.chat.phase)) {
    patchConversation(previous, { busy: true });
  }

  setConversationPath(id, nav);
  clearChatTimers();
  state.activeConversationId = id;
  state.highlightMessageId = null;
  state.isSidebarOpen = false;
  state.renamingConversationId = null;

  if (!id) {
    initChat([]);
    return;
  }
  if (state.conversations.some((c) => c.id === id && c.unread)) patchConversation(id, { unread: false });
  // Until its history is back: working if the list says so (no composer flash).
  const assumedWorking = state.conversations.some((c) => c.id === id && c.busy);
  initChat(readCachedChatMessages(id), assumedWorking ? 'waiting' : 'idle');
  if (assumedWorking) store.state.chat!.assumedWorking = true;
  void connectEvents();

  const history = await loadHistory(id);
  if (store.state.activeConversationId !== id) return;
  if (history === 'gone') conversationGone(id);
  else if (history) applyHistory(history);
};

/** After sign-in: the prompt typed while signed out starts a new conversation. */
export const sendPendingPrompt = async (prompt: string) => {
  await openConversation(null, 'replace');
  void sendChatMessage(prompt);
};
