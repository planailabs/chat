/**
 * Chat Events — the one event stream carries all the user's conversations.
 * Events of the conversation on screen drive the chat; the others mark their
 * sidebar entry (working, news) and move it to the top. An event of a
 * conversation this tab doesn't know refetches the list — unless a new
 * conversation is being started here: its first events can arrive before its
 * id, so they wait for it.
 */

import { store } from '../../app/store';
import { locales } from '../../content';
import type { ChatEventName, ChatEvents, ConversationEvent } from '../../api';
import type { ChatSession, ClientPrompt } from '../../app/state';
import { pendingApprovalOf, toolRunOf } from './toolRuns';
import { cacheChatMessages } from './cache';
import { finishStreamingText, transition } from './stateMachine';
import { startPreferenceQuestionStream } from './preference';
import { resyncAll } from './session';
import { backgroundActivity, eventDestination } from './conversationList';
import { patchConversation, refetchConversationsSoon } from './conversations';
import { openPage } from '../pages';

// ─── Routing ────────────────────────────────────────────────────────────────

/** Events that count as activity (move the conversation to the top). */
const MARKS_ACTIVITY = new Set<ChatEventName>(['thinking', 'text_done', 'question', 'approval', 'done', 'error']);

/** New conversations being started here (sent, id not back yet). */
let startingConversations = 0;
let heldEvents: { name: ChatEventName; data: ConversationEvent }[] = [];

export const beginNewConversation = () => {
  startingConversations++;
};

/**
 * The new conversation's id is known (null: starting it failed): its held
 * events are applied; when nothing is starting any more, the rest belong to
 * conversations from elsewhere.
 */
export const endNewConversation = (id: string | null) => {
  startingConversations = Math.max(0, startingConversations - 1);
  const mine = heldEvents.filter((e) => e.data.conversation === id);
  heldEvents = heldEvents.filter((e) => e.data.conversation !== id);
  for (const { name, data } of mine) routeServerEvent(name, data);
  if (startingConversations === 0 && heldEvents.length > 0) {
    heldEvents = [];
    refetchConversationsSoon();
  }
};

/** Dispatches an event of the shared stream to where it belongs. */
export const routeServerEvent = <E extends ChatEventName>(name: E, data: ConversationEvent<E>) => {
  // A page's KV view: for its host (the side panel), wherever the page is.
  if (name === 'artifact_kv') {
    window.dispatchEvent(new CustomEvent('page-kv', { detail: data }));
    return;
  }
  const state = store.state;
  const id = data.conversation;
  const destination = eventDestination(name, id, state.activeConversationId, state.conversations);
  if (destination === 'resync') {
    void resyncAll();
    return;
  }
  if (destination === 'unknown') {
    if (startingConversations > 0) heldEvents.push({ name, data: data as ConversationEvent });
    else refetchConversationsSoon();
    return;
  }

  const activity = backgroundActivity(name);
  const at = MARKS_ACTIVITY.has(name) ? new Date() : undefined;
  if (destination === 'open') {
    // The open conversation has no "news"; whether it works matters when it's reopened.
    if (activity && (at || state.conversations.find((c) => c.id === id)?.busy !== activity.busy)) {
      patchConversation(id!, { busy: activity.busy }, at);
    }
    handleServerEvent(name, data);
  } else if (activity) {
    patchConversation(id!, activity, at);
  }
};

// ─── The conversation on screen ─────────────────────────────────────────────

/** The question UI for a client tool call; `streamed` animates a preference question. */
export const questionPrompt = (callId: string, toolName: string, input: Record<string, unknown>, streamed: boolean): ClientPrompt => {
  const prompt: ClientPrompt = { callId, toolName, input };
  if (toolName === 'prompt_preference') {
    const prefContent = locales[store.state.localeKey].preferencePrompts[input.preference_id as string];
    if (prefContent) {
      prompt.preference = {
        subPhase: streamed ? 'streaming_question' : 'awaiting_choice',
        questionText: prefContent.question,
        visibleQuestionText: streamed ? '' : prefContent.question,
        stream: prefContent.stream,
      };
    }
  }
  return prompt;
};

/** The chat waits on the user (a question or approvals): work events don't replace that UI. */
const awaitsUser = (mc: ChatSession) => (mc.phase === 'question' && mc.clientPrompt !== undefined) || (mc.phase === 'approval' && mc.approvals.length > 0);

/**
 * Applies an event of the open conversation to the chat. While the assistant
 * works (thinking, streaming, a model step's text, tools) the phase is never
 * idle, so the composer stays hidden until `done`, a question, an approval or
 * an error.
 */
export const handleServerEvent = <E extends ChatEventName>(type: E, data: ChatEvents[E]) => {
  const mc = store.state.chat;
  if (!mc) return;
  mc.assumedWorking = false;

  switch (type) {
    case 'thinking':
      // From the tool spinner, `transition` keeps it a moment longer.
      if (!awaitsUser(mc)) transition(mc, 'waiting');
      break;

    case 'text_delta': {
      const { content } = data as ChatEvents['text_delta'];
      if (awaitsUser(mc)) break;
      if (mc.phase !== 'streaming') {
        transition(mc, 'streaming');
      }
      mc.streamingText = (mc.streamingText ?? '') + content;
      break;
    }

    case 'text_done': {
      // The full block; a turn may have several (between tool calls).
      const { content } = data as ChatEvents['text_done'];
      mc.streamingText = undefined;
      mc.messages.push({ role: 'assistant', content });
      cacheChatMessages(mc.messages);
      // More may follow (tools, another step): still working until `done`.
      if (!awaitsUser(mc) && mc.phase !== 'waiting') {
        transition(mc, 'waiting');
      }
      break;
    }

    case 'tool_start': {
      const { name, reason, target } = data as ChatEvents['tool_start'];
      if (awaitsUser(mc)) break;
      transition(mc, 'tool');
      mc.toolName = name;
      mc.toolReason = reason?.trim() || null;
      mc.toolTarget = target?.trim() || null;
      break;
    }

    case 'tool_end': {
      const end = data as ChatEvents['tool_end'];
      const run = toolRunOf(end.name, end);
      mc.messages.push({ role: 'tool', ...run });
      // A new page (or version) opens beside the conversation as it arrives.
      if (run.page) openPage(run.page.id);
      cacheChatMessages(mc.messages);
      if (!awaitsUser(mc)) transition(mc, 'waiting');
      break;
    }

    case 'question': {
      const { call_id, toolName, input } = data as ChatEvents['question'];
      transition(mc, 'question');
      mc.clientPrompt = questionPrompt(call_id, toolName, input ?? {}, true);
      // An ask_question is shown by its prompt while pending, then as
      // "question → answer" (stateMachine's answerBubble).
      if (toolName !== 'ask_question' && mc.clientPrompt.preference) {
        setTimeout(() => startPreferenceQuestionStream(), 0);
      }
      cacheChatMessages(mc.messages);
      break;
    }

    case 'approval': {
      const approval = pendingApprovalOf(data as ChatEvents['approval']);
      const pending = mc.approvals;
      transition(mc, 'approval');
      if (!pending.some((a) => a.callId === approval.callId)) {
        pending.push(approval);
      }
      mc.approvals = pending;
      break;
    }

    case 'done':
      finishStreamingText(mc);
      // A question or approval outlives the turn's end.
      if (mc.phase !== 'question' && mc.phase !== 'approval') {
        transition(mc, 'idle');
      }
      break;

    case 'error':
      transition(mc, 'error');
      mc.error = (data as ChatEvents['error']).message || locales[store.state.localeKey].chat.errors.generic;
      break;
  }
  store.notify();
};
