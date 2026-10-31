/**
 * Chat State Machine — transition(), and the user's side of the conversation:
 * sending messages, answering or dismissing questions, approving tool calls,
 * and the sign-in invite for anonymous users.
 *
 * The assistant's side arrives over the event stream (events.ts).
 */

import { store } from '../../app/store';
import type { ChatMessage, ChatPhase, ChatSession } from '../../app/state';
import { locales } from '../../content';
import { ApiError, api } from '../../api';
import { startCharacterStream } from '../../utils/stream';
import { cacheChatMessages, savePendingSalesPrompt } from './cache';
import { connectEvents } from './sse';
import { clearPreferenceTimers } from './preference';

const locale = () => locales[store.state.localeKey];

// ─────────────────────────────────────────────────────────────────────────────
// Login Invite Stream (anonymous user prompt → sign-in invite)
// ─────────────────────────────────────────────────────────────────────────────

let loginInviteStreamCancel: (() => void) | null = null;

const clearLoginInviteTimer = () => {
  loginInviteStreamCancel?.();
  loginInviteStreamCancel = null;
};

const startLoginInviteStream = () => {
  const invite = store.state.chat?.loginInvite;
  if (!invite) return;
  clearLoginInviteTimer();
  loginInviteStreamCancel = startCharacterStream(
    invite.text.length,
    invite.stream.chunkSize,
    invite.stream.intervalMs,
    (index) => {
      const cur = store.state.chat?.loginInvite;
      if (!cur) return;
      cur.visibleText = cur.text.slice(0, index);
      store.notify();
    },
    () => {
      loginInviteStreamCancel = null;
      const cur = store.state.chat?.loginInvite;
      if (!cur) return;
      cur.visibleText = cur.text;
      cur.isStreaming = false;
      store.notify();
      // Reveal the sign-in button after a short delay
      setTimeout(() => {
        const curInvite = store.state.chat?.loginInvite;
        if (curInvite) {
          curInvite.ctaVisible = true;
          store.notify();
        }
      }, 200);
    },
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Phases
//
// idle → waiting → streaming → question | approval → waiting → ... → idle
// any  → error
//
// transition() is the single entry point for phase changes. It cleans up the
// previous phase (finishes streamed text, clears question/error) before
// entering the new one, so stale UI can't leak across phases.
// ─────────────────────────────────────────────────────────────────────────────

/** Pending delayed transition from tool → waiting */
let toolTransitionTimer: ReturnType<typeof setTimeout> | null = null;
const TOOL_TRANSITION_DELAY_MS = 500;

/** Ends a streamed text block: it becomes an assistant message. */
export const finishStreamingText = (mc: ChatSession) => {
  if (mc.streamingText) {
    mc.messages.push({ role: 'assistant', content: mc.streamingText });
    cacheChatMessages(mc.messages);
  }
  mc.streamingText = undefined;
};

export const transition = (mc: ChatSession, phase: ChatPhase) => {
  if (toolTransitionTimer) {
    clearTimeout(toolTransitionTimer);
    toolTransitionTimer = null;
  }

  // Delay tool → waiting so the spinner shows for at least 500ms
  if (mc.phase === 'tool' && phase === 'waiting') {
    toolTransitionTimer = setTimeout(() => {
      toolTransitionTimer = null;
      const cur = store.state.chat;
      if (cur?.phase === 'tool') {
        cur.phase = 'waiting';
        cur.toolName = undefined;
        store.notify();
      }
    }, TOOL_TRANSITION_DELAY_MS);
    return;
  }

  // tool → tool: another tool starts while the spinner shows — caller updates the name
  if (mc.phase === 'tool' && phase === 'tool') {
    return;
  }

  finishStreamingText(mc);
  mc.clientPrompt = undefined;
  mc.error = undefined;
  mc.toolName = undefined;
  clearPreferenceTimers();
  clearLoginInviteTimer();
  mc.loginInvite = undefined;
  mc.phase = phase;
};

/** Cancels every chat timer (mode switch, new conversation). */
export const clearChatTimers = () => {
  if (toolTransitionTimer) {
    clearTimeout(toolTransitionTimer);
    toolTransitionTimer = null;
  }
  clearPreferenceTimers();
  clearLoginInviteTimer();
};

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

const errorText = (error: unknown): string => {
  const errors = locale().chat.errors;
  if (!(error instanceof ApiError)) return errors.generic;
  switch (error.status) {
    case 401:
      return errors.signedOut;
    case 402:
      return errors.rateLimited;
    case 403:
      return store.state.impersonating ? errors.readOnly : errors.unavailable;
    case 413:
      return errors.tooLong;
    default:
      return errors.generic;
  }
};

/** Shows a failed request in the chat. */
export const showChatError = (error: unknown) => {
  console.error('[chat] request failed', error);
  const mc = store.state.chat;
  if (!mc) return;
  transition(mc, 'error');
  mc.error = errorText(error);
  store.notify();
};

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

const showLoginInvite = (mc: ChatSession, message: string) => {
  const invite = locale().chat.loginInvite;
  // Sent to the sales chat after sign-in
  savePendingSalesPrompt(message);
  transition(mc, 'login');
  mc.messages.push({ role: 'user', content: message });
  mc.loginInvite = {
    text: invite.text,
    visibleText: '',
    stream: invite.stream,
    isStreaming: true,
    ctaVisible: false,
  };
  store.notify();
  setTimeout(() => startLoginInviteStream(), invite.stream.initialDelayMs);
};

export const sendChatMessage = async (message: string) => {
  const state = store.state;
  const mc = state.chat;
  if (!mc) return;

  if (!state.isAuthenticated) {
    showLoginInvite(mc, message);
    return;
  }

  // A text question is answered through the composer
  if (mc.phase === 'question') {
    await answerChatQuestion(message);
    return;
  }

  const mode = state.activeChatMode;
  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: message });
  cacheChatMessages(mc.messages);
  store.notify();

  // The reply streams over the event stream: be listening before it starts.
  await connectEvents();
  try {
    await api.chat.send(mode, message, state.localeKey);
  } catch (error) {
    showChatError(error);
  }
};

/**
 * Answers the pending question; `content` undefined dismisses it.
 * `bubble` is what the chat shows for the answer.
 */
const submitAnswer = async (content: string | undefined, bubbles: ChatMessage[]) => {
  const mc = store.state.chat;
  const prompt = mc?.clientPrompt;
  if (!mc || !prompt) return;

  const mode = store.state.activeChatMode;
  transition(mc, 'waiting');
  mc.messages.push(...bubbles);
  cacheChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  try {
    await api.chat.answer(mode, prompt.callId, content);
  } catch (error) {
    showChatError(error);
  }
};

export const answerChatQuestion = (text: string) => submitAnswer(text, [{ role: 'user', content: text }]);

export const cancelChatQuestion = () => {
  const mc = store.state.chat;
  if (mc?.phase !== 'question') return Promise.resolve();
  const cancelLabel = locale().chatModes[store.state.activeChatMode].cancelLabel;
  return submitAnswer(undefined, [{ role: 'cancel', content: cancelLabel }]);
};

/** Answers a prompt_preference question whose exchange is already in the chat. */
export const answerPreference = (choice: 'yes' | 'no', exchange: ChatMessage[]) =>
  submitAnswer(choice === 'yes' ? 'subscribed' : 'declined', exchange);

// ─────────────────────────────────────────────────────────────────────────────
// Approvals
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalAction = 'approve' | 'deny' | 'approve_all';

export const decideApproval = async (callId: string, action: ApprovalAction) => {
  const mc = store.state.chat;
  if (!mc) return;
  const approval = mc.approvals.find((a) => a.callId === callId);
  if (!approval) return;

  const mode = store.state.activeChatMode;
  const approved = action !== 'deny';
  // "Approve all" also covers the other calls waiting right now.
  const decided = action === 'approve_all' ? mc.approvals : [approval];
  mc.approvals = mc.approvals.filter((a) => !decided.includes(a));
  for (const a of decided) {
    mc.messages.push({ role: 'approval', ...a, decision: approved ? 'approved' : 'denied' });
  }
  cacheChatMessages(mc.messages);
  if (mc.approvals.length === 0) {
    transition(mc, 'waiting');
  }
  store.notify();

  await connectEvents();
  try {
    for (const a of decided) {
      await api.chat.approve(mode, a.callId, approved, a === approval && action === 'approve_all' ? { all: true } : {});
    }
  } catch (error) {
    showChatError(error);
  }
};
