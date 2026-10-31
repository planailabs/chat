/**
 * Chat Events — applies the assistant's side of the conversation, as it
 * arrives over /api/v1/chat/events, to the chat state.
 */

import { store } from '../../app/store';
import { locales } from '../../content';
import type { ChatEventName, ChatEvents } from '../../api';
import type { ClientPrompt } from '../../app/state';
import { cacheChatMessages } from './cache';
import { finishStreamingText, transition } from './stateMachine';
import { startPreferenceQuestionStream } from './preference';
import { resyncHistory } from './session';

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

export const handleServerEvent = <E extends ChatEventName>(type: E, data: ChatEvents[E]) => {
  if (type === 'resync') {
    void resyncHistory();
    return;
  }

  const mc = store.state.chat;
  if (!mc) return;

  switch (type) {
    case 'thinking':
      transition(mc, 'waiting');
      break;

    case 'text_delta': {
      const { content } = data as ChatEvents['text_delta'];
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
      if (mc.phase === 'streaming') {
        transition(mc, 'waiting');
      }
      break;
    }

    case 'tool_start':
      transition(mc, 'tool');
      mc.toolName = (data as ChatEvents['tool_start']).name;
      break;

    case 'tool_end':
      transition(mc, 'waiting');
      break;

    case 'question': {
      const { call_id, toolName, input } = data as ChatEvents['question'];
      transition(mc, 'question');
      mc.clientPrompt = questionPrompt(call_id, toolName, input ?? {}, true);
      if (toolName === 'ask_question') {
        // The question is part of the conversation
        const question = input?.question;
        const last = mc.messages[mc.messages.length - 1];
        if (typeof question === 'string' && !(last?.role === 'assistant' && last.content === question)) {
          mc.messages.push({ role: 'assistant', content: question });
        }
      } else if (mc.clientPrompt.preference) {
        setTimeout(() => startPreferenceQuestionStream(), 0);
      }
      cacheChatMessages(mc.messages);
      break;
    }

    case 'approval': {
      const { call_id, name, input, reason } = data as ChatEvents['approval'];
      const pending = mc.approvals;
      transition(mc, 'approval');
      if (!pending.some((a) => a.callId === call_id)) {
        pending.push({ callId: call_id, name, input, reason: reason ?? null });
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
