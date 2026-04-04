/**
 * Chat State Machine — transition(), sendChatMessage, answerChatQuestion,
 * cancelChatQuestion, sendPendingSalesPrompt, legacy aliases.
 */

import { store } from '../../app/store';
import { locales } from '../../content';
import { startCharacterStream } from '../../utils/stream';
import { cacheAIChatMessages, savePendingSalesPrompt, type StoredMessage } from './cache';
import { connectEvents, postMessage } from './sse';
import { clearPreferenceTimers } from './preference';
import { fetchAIChatHistory, initAIChat } from './session';

// ─────────────────────────────────────────────────────────────────────────────
// Login Invite Stream (anonymous user prompt → sign-in invite)
// ─────────────────────────────────────────────────────────────────────────────
let loginInviteStreamCancel: (() => void) | null = null;

export const clearLoginInviteTimer = () => {
  if (loginInviteStreamCancel) {
    loginInviteStreamCancel();
    loginInviteStreamCancel = null;
  }
};

const startLoginInviteStream = () => {
  const invite = store.state.chat?.aiChat?.loginInvite;
  if (!invite) return;

  if (loginInviteStreamCancel) {
    loginInviteStreamCancel();
    loginInviteStreamCancel = null;
  }

  const totalLength = invite.text.length;
  loginInviteStreamCancel = startCharacterStream(
    totalLength,
    invite.stream.chunkSize,
    invite.stream.intervalMs,
    (index) => {
      const cur = store.state.chat?.aiChat?.loginInvite;
      if (!cur) return;
      cur.visibleText = cur.text.slice(0, index);
      store.notify();
    },
    () => {
      loginInviteStreamCancel = null;
      const cur = store.state.chat?.aiChat?.loginInvite;
      if (!cur) return;
      cur.visibleText = cur.text;
      cur.isStreaming = false;
      store.notify();
      // Reveal OAuth CTAs after a short delay
      setTimeout(() => {
        const curInvite = store.state.chat?.aiChat?.loginInvite;
        if (curInvite) {
          curInvite.ctaVisible = true;
          store.notify();
        }
      }, 200);
    },
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AI Chat State Machine
//
// Phases: idle → waiting → streaming → question → waiting → ...
//                                    → idle (done)
//         any  → error
//
// transition() is the single entry point for all phase changes. It cleans up
// the previous phase (cancels streaming, clears question/error) before
// entering the new one, which prevents stale UI from leaking across phases.
// ─────────────────────────────────────────────────────────────────────────────

/** Pending delayed transition from tool → waiting */
let toolTransitionTimer: ReturnType<typeof setTimeout> | null = null;
const TOOL_TRANSITION_DELAY_MS = 500;

/**
 * Transition to a new phase, cleaning up any state from the previous one.
 * Always call this instead of setting phase/fields directly.
 */
export const transition = (
  mc: NonNullable<typeof store.state.chat>['aiChat'],
  phase: 'idle' | 'waiting' | 'streaming' | 'tool' | 'question' | 'login' | 'error',
) => {
  if (!mc) return;

  // Always cancel a pending tool→waiting transition
  if (toolTransitionTimer) {
    clearTimeout(toolTransitionTimer);
    toolTransitionTimer = null;
  }

  // Delay tool → waiting so the spinner shows for at least 500ms
  if (mc.phase === 'tool' && phase === 'waiting') {
    toolTransitionTimer = setTimeout(() => {
      toolTransitionTimer = null;
      const cur = store.state.chat?.aiChat;
      // Only transition if still in tool phase (another event may have moved us)
      if (cur?.phase === 'tool') {
        cur.phase = 'waiting';
        cur.toolName = undefined;
        store.notify();
      }
    }, TOOL_TRANSITION_DELAY_MS);
    return;
  }

  // tool → tool: new tool starting while still showing previous — just update name
  if (mc.phase === 'tool' && phase === 'tool') {
    return;
  }

  // Finalize any pending streaming text before leaving the phase
  if (mc.streamingText?.full) {
    mc.messages.push({ role: 'assistant', content: mc.streamingText.full });
    cacheAIChatMessages(mc.messages);
  }

  // Clear transient state from any previous phase
  mc.streamingText = undefined;
  mc.clientPrompt = undefined;
  mc.error = undefined;
  mc.toolName = undefined;

  // Cancel any preference streaming timers
  clearPreferenceTimers();
  clearLoginInviteTimer();
  mc.loginInvite = undefined;

  mc.phase = phase;
};

// ─────────────────────────────────────────────────────────────────────────────
// Chat Message Sending
// ─────────────────────────────────────────────────────────────────────────────

export const sendChatMessage = async (message: string) => {
  const state = store.state;
  if (!state.chat?.aiChat) return;

  // Anonymous user: save prompt and show sign-in invite within aiChat
  if (!state.isAuthenticated || !state.userId) {
    const mc = state.chat.aiChat;
    const currentLocale = locales[state.localeKey];
    // Save the prompt for post-login send to sales bot
    savePendingSalesPrompt(message);
    // Add as user message and transition to login phase
    mc.messages.push({ role: 'user', content: message });
    const inviteStep = currentLocale.conversationScenarios.anonymousInvite.steps['invite-intro'];
    mc.loginInvite = {
      text: inviteStep.text,
      visibleText: '',
      stream: inviteStep.stream,
      isStreaming: true,
      ctaVisible: false,
    };
    mc.phase = 'login';
    cacheAIChatMessages(mc.messages);
    store.notify();
    // Start streaming the sign-in invite text
    setTimeout(() => startLoginInviteStream(), inviteStep.stream.initialDelayMs);
    return;
  }

  const mc = state.chat.aiChat;

  // If there's an active question, route as answer
  if (mc.phase === 'question') {
    answerChatQuestion(message);
    return;
  }

  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: message });
  store.notify();

  // Ensure EventSource is connected before posting
  await connectEvents();

  // POST the message — events arrive via SSE
  void postMessage({ type: 'message', text: message });
};

// Legacy alias
export const sendMachineConfigMessage = sendChatMessage;

/**
 * Sends the user's answer to a pending question via POST.
 */
export const answerChatQuestion = async (text: string) => {
  const mc = store.state.chat?.aiChat;
  if (!mc) return;

  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: text });
  cacheAIChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  void postMessage({ type: 'answer', text });
};

// Legacy alias
export const answerMachineConfigQuestion = answerChatQuestion;

export const cancelChatQuestion = async () => {
  const mc = store.state.chat?.aiChat;
  if (!mc || mc.phase !== 'question') return;

  const mode = store.state.activeChatMode;
  const cancelLabel = locales[store.state.localeKey].chatModes[mode].cancelLabel;
  transition(mc, 'waiting');
  mc.messages.push({ role: 'cancel', content: cancelLabel });
  cacheAIChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  void postMessage({ type: 'answer', text: '__cancel__' });
};

// Legacy alias
export const cancelMachineConfigQuestion = cancelChatQuestion;

/**
 * Sends a pending sales prompt after login. Handles the full lifecycle:
 * inits sales chat → fetches history → cancels any pending question → sends prompt.
 */
export const sendPendingSalesPrompt = async (prompt: string): Promise<void> => {
  const state = store.state;

  // Switch to sales mode and init empty chat
  state.activeChatMode = 'sales';
  state.chat = null;
  state.heroPhase = 'composer';
  store.notify();

  // Init the AI chat UI immediately (shows empty state)
  initAIChat([], 'idle');
  store.notify();

  // Connect SSE and fetch server history
  await connectEvents();
  const result = await fetchAIChatHistory('sales');

  const mc = store.state.chat?.aiChat;
  if (!mc) return;

  // Apply server history
  if (result && result.messages.length > 0) {
    const cancelLabel = locales[state.localeKey].chatModes.sales.cancelLabel;
    mc.messages = result.messages.map((m) =>
      m.role === 'cancel' ? { ...m, content: m.content || cancelLabel } : m,
    );
  }

  // If server is waiting for an answer, cancel it first
  if (result?.phase === 'waiting_for_answer') {
    mc.phase = 'idle';
    store.notify();
    await postMessage({ type: 'answer', text: '__cancel__' });
    // Brief wait for server to process cancellation
    await new Promise((r) => setTimeout(r, 500));
  }

  // Now send the actual prompt
  mc.phase = 'idle';
  store.notify();
  void sendChatMessage(prompt);
};
