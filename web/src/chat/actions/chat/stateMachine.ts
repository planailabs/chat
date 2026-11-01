/**
 * Chat State Machine — transition(), and the user's side of the conversation:
 * sending messages, answering or dismissing questions, approving tool calls,
 * and the sign-in invite for anonymous users.
 *
 * The assistant's side arrives over the event stream (events.ts).
 */

import { store } from '../../app/store';
import type { ChatMessage, ChatPhase, ChatSession } from '../../app/state';
import { refreshBudget } from '../profile';
import { locales } from '../../content';
import { ApiError, api } from '../../api';
import { startCharacterStream } from '../../utils/stream';
import { setConversationPath } from '../../app/route';
import { cacheChatMessages, savePendingPrompt } from './cache';
import { connectEvents } from './sse';
import { clearPreferenceTimers } from './preference';
import { beginNewConversation, endNewConversation } from './events';
import { addConversation, loadConversations, patchConversation } from './conversations';
import { titleFrom } from './conversationList';

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
      // This chat only (another conversation may be on screen by now).
      if (store.state.chat === mc && mc.phase === 'tool') {
        mc.phase = 'waiting';
        mc.toolName = undefined;
        mc.toolReason = undefined;
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
  mc.toolReason = undefined;
  clearPreferenceTimers();
  clearLoginInviteTimer();
  mc.loginInvite = undefined;
  mc.phase = phase;
};

/** Cancels every chat timer (switching conversations). */
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
    case 402: {
      const plan = store.state.budget?.plan_name;
      return plan ? errors.planLimited.replace('{{plan}}', plan) : errors.rateLimited;
    }
    case 403:
      return store.state.impersonating ? errors.readOnly : errors.unavailable;
    case 413:
      return errors.tooLong;
    default:
      return errors.generic;
  }
};

/** Shows a failed request in the chat (`mc`: only if that chat is still on screen). */
export const showChatError = (error: unknown, mc: ChatSession | null = store.state.chat) => {
  console.error('[chat] request failed', error);
  if (!mc || store.state.chat !== mc) return;
  transition(mc, 'error');
  mc.error = errorText(error);
  store.notify();
  // The hourly limit: reload the plan's numbers (and name the current plan).
  if (error instanceof ApiError && error.status === 402) {
    const shown = mc.error;
    void refreshBudget().then(() => {
      if (mc.phase === 'error' && mc.error === shown) mc.error = errorText(error);
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

const showLoginInvite = (mc: ChatSession, message: string) => {
  const invite = locale().chat.loginInvite;
  // Starts a conversation after sign-in
  savePendingPrompt(message);
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

  const id = state.activeConversationId;
  transition(mc, 'waiting');
  mc.messages.push({ role: 'user', content: message });
  cacheChatMessages(mc.messages);
  if (id) patchConversation(id, { busy: true }, new Date());
  store.notify();

  // The reply streams over the event stream: be listening before it starts.
  await connectEvents();
  if (id) {
    try {
      await api.chat.send(id, message, state.localeKey);
    } catch (error) {
      showChatError(error, mc);
    }
    return;
  }
  await startConversation(mc, message);
};

/** The first message of a new chat: the conversation gets its id, URL and sidebar entry. */
const startConversation = async (mc: ChatSession, message: string) => {
  beginNewConversation();
  let id: string;
  try {
    ({ id } = await api.chat.send(null, message, store.state.localeKey));
  } catch (error) {
    endNewConversation(null);
    showChatError(error, mc);
    return;
  }
  const now = new Date().toISOString();
  addConversation({ id, title: titleFrom(message), created_at: now, updated_at: now, busy: true });
  // Still on this new chat: it becomes the conversation.
  if (store.state.chat === mc && store.state.activeConversationId === null) {
    store.state.activeConversationId = id;
    setConversationPath(id, 'push');
    cacheChatMessages(mc.messages, id);
  }
  endNewConversation(id);
  store.notify();
  // The server's title.
  void loadConversations();
};

/**
 * Answers the pending question; `content` undefined dismisses it.
 * `bubble` is what the chat shows for the answer.
 */
const submitAnswer = async (content: string | undefined, bubbles: ChatMessage[]) => {
  const mc = store.state.chat;
  const prompt = mc?.clientPrompt;
  if (!mc || !prompt) return;

  const id = store.state.activeConversationId;
  if (!id) return;
  transition(mc, mc.approvals.length > 0 ? 'approval' : 'waiting');
  mc.messages.push(...bubbles);
  cacheChatMessages(mc.messages);
  store.notify();

  await connectEvents();
  try {
    await api.chat.answer(id, prompt.callId, content);
  } catch (error) {
    showChatError(error, mc);
  }
};

/** The pending ask_question's text, if any (shown with its answer). */
const pendingQuestionText = (): string | null => {
  const input = store.state.chat?.clientPrompt?.input;
  return typeof input?.question === 'string' && input.question.trim() ? input.question : null;
};

/** What the chat keeps of an answered question: "question → answer" (or the answer alone). */
const answerBubble = (answer: string | null): ChatMessage => {
  const question = pendingQuestionText();
  if (question) return { role: 'qa', question, answer };
  return answer === null ? { role: 'cancel', content: locale().chat.skipLabel } : { role: 'user', content: answer };
};

export const answerChatQuestion = (text: string) => submitAnswer(text, [answerBubble(text)]);

export const cancelChatQuestion = () => {
  const mc = store.state.chat;
  if (mc?.phase !== 'question') return Promise.resolve();
  return submitAnswer(undefined, [answerBubble(null)]);
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
  const id = store.state.activeConversationId;
  if (!approval || !id) return;

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
      await api.chat.approve(id, a.callId, approved, a === approval && action === 'approve_all' ? { all: true } : {});
    }
  } catch (error) {
    showChatError(error, mc);
  }
};

/** The composer shows when the assistant isn't working and nothing else waits on the user (a text question uses it too). */
export const showsComposer = (mc: ChatSession): boolean => {
  if (mc.phase === 'idle' || mc.phase === 'error') return true;
  if (mc.phase !== 'question') return false;
  const prompt = mc.clientPrompt;
  return prompt?.toolName === 'ask_question' && (prompt.input as { type?: string }).type === 'text';
};
