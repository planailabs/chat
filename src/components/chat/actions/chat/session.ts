/**
 * Chat Session — restoreAIChatSession, fetchAIChatHistory, verifyCustomerToken,
 * initAIChat, restoreMachineConfigSession (legacy alias), ChatHistoryResult.
 */

import { store } from '../../app/store';
import { type ClientChatModeId } from '../../constants';
import { locales } from '../../content';
import { withImpersonate } from '../../impersonation';
import {
  cacheAIChatMessages,
  readCachedAIChatMessages,
  clearAIChatMessages,
  readPendingSalesPrompt,
  getJwt,
  type StoredMessage,
} from './cache';
import { connectEvents, disconnectEvents } from './sse';
import { sendChatMessage } from './stateMachine';

export interface ChatHistoryResult {
  messages: StoredMessage[];
  phase?: string;
  pendingQuestion?: Record<string, unknown>;
}

export const initAIChat = (messages: StoredMessage[], phase: 'idle' | 'waiting' = 'idle') => {
  const state = store.state;
  state.chat = {
    userPrompt: messages[0]?.content ?? '',
    assistantVisibleText: '',
    assistantFullText: '',
    stream: { initialDelayMs: 0, chunkSize: 1, intervalMs: 0 },
    isStreaming: false,
    ctaVisible: false,
    aiChat: {
      messages,
      phase,
    },
  };
  state.heroPhase = 'chat';
  store.notify();
};

/**
 * Validates the customer token against mac-mgmt via the server proxy.
 * Returns true if valid, false otherwise. On failure, clears the token from state.
 */
const verifyCustomerToken = async (): Promise<boolean> => {
  try {
    const jwt = await getJwt();
    if (!jwt) return false;
    const res = await fetch(withImpersonate('/api/chat/verify-token/'), {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
};

/**
 * Fetches chat history from the server and populates state + sessionStorage cache.
 * Returns messages, phase, and pendingQuestion (if waiting_for_answer).
 */
export const fetchAIChatHistory = async (modeId?: ClientChatModeId): Promise<ChatHistoryResult | null> => {
  try {
    const jwt = await getJwt();
    if (!jwt) return null;

    const mode = modeId ?? store.state.activeChatMode;
    const response = await fetch(withImpersonate(`/api/chat/history/?mode=${encodeURIComponent(mode)}`), {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const messages = (data.messages ?? []) as StoredMessage[];
    if (messages.length > 0) {
      cacheAIChatMessages(messages, modeId);
    }
    return {
      messages,
      phase: data.phase,
      pendingQuestion: data.pendingQuestion,
    };
  } catch {
    // Network error — fall through
  }
  return null;
};

/**
 * Restores an AI chat session on page load.
 * - Shows cached messages instantly (sessionStorage)
 * - For machine_config: validates customer token against mac-mgmt
 * - Fetches authoritative history from server
 */
export const restoreAIChatSession = (): void => {
  const state = store.state;
  const mode = state.activeChatMode;

  // Machine config mode requires customer token.
  // When impersonating, the token will arrive async via loadProfilePreferences,
  // which calls restoreMachineConfigSession() once customerToken is set.
  if (mode === 'machine_config' && !state.customerToken) return;

  // Don't re-init if already active
  if (state.chat?.aiChat) return;

  // Anonymous users in sales mode: show chat UI
  if (!state.isAuthenticated) {
    const pending = readPendingSalesPrompt();
    if (pending) {
      // Restore with login phase: show prompt + sign-in invite (skip streaming)
      const currentLocale = locales[state.localeKey];
      const inviteStep = currentLocale.conversationScenarios.anonymousInvite.steps['invite-intro'];
      initAIChat([{ role: 'user', content: pending }], 'idle');
      const mc = state.chat?.aiChat;
      if (mc) {
        mc.phase = 'login';
        mc.loginInvite = {
          text: inviteStep.text,
          visibleText: inviteStep.text,
          stream: inviteStep.stream,
          isStreaming: false,
          ctaVisible: true,
        };
      }
    } else {
      initAIChat([]);
    }
    store.notify();
    return;
  }

  // Instant restore from sessionStorage cache (show immediately while server loads)
  const cached = readCachedAIChatMessages(mode);
  if (cached && cached.length > 0) {
    initAIChat(cached);
  } else {
    initAIChat([]);
    store.notify();
  }

  // Pre-connect EventSource eagerly
  void connectEvents();

  // Fetch authoritative history from server — then decide whether to auto-send greeting
  const applyHistory = (result: ChatHistoryResult | null) => {
    const mc = store.state.chat?.aiChat;
    if (!mc) return;

    if (result && result.messages.length > 0) {
      const cancelLabel = locales[store.state.localeKey].chatModes[mode].cancelLabel;
      mc.messages = result.messages.map((m) =>
        m.role === 'cancel' ? { ...m, content: m.content || cancelLabel } : m,
      );
      store.state.chat!.userPrompt = result.messages[0]?.content ?? '';

      // Restore pending question if server is waiting for an answer
      if (result.phase === 'waiting_for_answer' && result.pendingQuestion) {
        mc.phase = 'question';
        // Backwards compat: old format has { type, question, options }, new has { toolName, input }
        const pq = result.pendingQuestion;
        if (pq.toolName) {
          mc.clientPrompt = { toolName: pq.toolName as string, input: (pq.input ?? {}) as Record<string, unknown> };
        } else {
          mc.clientPrompt = { toolName: 'ask_question', input: pq };
        }
        // For prompt_preference: restore with subPhase 'awaiting_choice' (skip streaming)
        if (mc.clientPrompt.toolName === 'prompt_preference') {
          const prefId = mc.clientPrompt.input.preference_id as string;
          const locale = locales[store.state.localeKey];
          const prefContent = locale.preferencePrompts[prefId];
          if (prefContent) {
            mc.clientPrompt.preference = {
              subPhase: 'awaiting_choice',
              questionText: prefContent.question,
              visibleQuestionText: prefContent.question,
              stream: prefContent.stream,
            };
          }
        }
      } else {
        mc.phase = 'idle';
      }

      store.notify();
    } else {
      // Server has no history — auto-send greeting if the mode has one
      const locale = locales[store.state.localeKey];
      const greeting = locale.chatModes[mode].greeting;
      if (greeting) {
        void sendChatMessage(greeting);
      }
    }
  };

  if (mode === 'machine_config') {
    const tokenValid = verifyCustomerToken();
    const historyFetch = fetchAIChatHistory(mode);

    void Promise.all([tokenValid, historyFetch]).then(([valid, result]) => {
      if (!valid) {
        console.warn('[chat] Customer token invalid, disabling machine config');
        store.state.customerToken = null;
        if (store.state.chat?.aiChat) {
          store.state.chat.aiChat = undefined;
          store.state.heroPhase = 'composer';
        }
        clearAIChatMessages(mode);
        disconnectEvents();
        store.notify();
        return;
      }
      applyHistory(result);
    });
  } else {
    void fetchAIChatHistory(mode).then(applyHistory);
  }
};

// Legacy alias
export const restoreMachineConfigSession = restoreAIChatSession;
