/**
 * Chat Session — sets up the conversation of the active mode: cached
 * messages first, then the server's history (and what it waits on), the
 * greeting for an empty conversation, and the prompt an anonymous user typed
 * before signing in.
 */

import { store } from '../../app/store';
import type { ChatMessage, ChatPhase } from '../../app/state';
import { locales } from '../../content';
import { api, type ChatModeId, type History } from '../../api';
import { cacheChatMessages, readCachedChatMessages, readPendingSalesPrompt } from './cache';
import { connectEvents, disconnectEvents } from './sse';
import { questionPrompt } from './events';
import { historyToChat } from './history';
import { clearChatTimers, sendChatMessage, showChatError, transition } from './stateMachine';

const locale = () => locales[store.state.localeKey];

export const initChat = (messages: ChatMessage[], phase: ChatPhase = 'idle') => {
  store.state.chat = { messages, phase, approvals: [] };
  store.notify();
};

/** Signed out: an empty chat, or the stashed prompt with the sign-in invite. */
export const showAnonymousChat = () => {
  const pending = readPendingSalesPrompt();
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
  if (store.state.isAuthenticated) {
    initChat(readCachedChatMessages());
  } else {
    showAnonymousChat();
  }
};

const loadHistory = async (mode: ChatModeId): Promise<History | null> => {
  try {
    return await api.chat.history(mode);
  } catch (error) {
    console.error('[chat] loading the history failed', error);
    return null;
  }
};

/** Replaces the chat with the server's record of it. */
const applyHistory = (history: History) => {
  const mc = store.state.chat;
  if (!mc) return;
  const mode = store.state.activeChatMode;
  const snapshot = historyToChat(history, locale(), locale().chatModes[mode].cancelLabel);

  // A turn in progress keeps showing its progress.
  const live = mc.phase === 'waiting' || mc.phase === 'streaming' || mc.phase === 'tool';
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
  } else if (!live) {
    transition(mc, 'idle');
  }
  cacheChatMessages(mc.messages, mode);
  store.notify();
};

/** Refetches the history (the event stream missed something). */
export const resyncHistory = async () => {
  const mode = store.state.activeChatMode;
  const history = await loadHistory(mode);
  if (history && store.state.activeChatMode === mode) applyHistory(history);
};

/** Signed in: the conversation of the active mode, kept live. */
export const openChat = async () => {
  const mode = store.state.activeChatMode;
  initChat(readCachedChatMessages(mode));
  void connectEvents();

  const history = await loadHistory(mode);
  if (!history || store.state.activeChatMode !== mode) return;
  applyHistory(history);

  // An empty conversation starts with the mode's greeting, if it has one.
  const greeting = locale().chatModes[mode].greeting;
  if (history.messages.length === 0 && greeting && !store.state.impersonating) {
    void sendChatMessage(greeting);
  }
};

/**
 * After sign-in: the prompt typed while signed out goes to the sales chat,
 * after anything that conversation still waits on is dismissed.
 */
export const sendPendingSalesPrompt = async (prompt: string) => {
  disconnectEvents();
  store.state.activeChatMode = 'sales';
  initChat(readCachedChatMessages('sales'));
  await connectEvents();

  const history = await loadHistory('sales');
  if (history) {
    applyHistory(history);
    try {
      for (const q of history.pending_questions ?? []) {
        await api.chat.answer('sales', q.call_id);
      }
      for (const a of history.pending_approvals ?? []) {
        await api.chat.approve('sales', a.call_id, false);
      }
    } catch (error) {
      showChatError(error);
      return;
    }
  }

  const mc = store.state.chat;
  if (!mc) return;
  mc.approvals = [];
  transition(mc, 'idle');
  store.notify();
  void sendChatMessage(prompt);
};

