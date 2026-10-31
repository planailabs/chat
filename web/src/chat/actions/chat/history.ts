/**
 * Chat History — turns the server's conversation record into what the chat
 * shows: the same bubbles the live conversation produced, plus whatever the
 * conversation waits on (a question, approvals).
 */

import type { History, QuestionData } from '../../api';
import type { ChatMessage, ClientPrompt, PendingApproval } from '../../app/state';
import type { LocaleContent } from '../../content';

export interface ChatSnapshot {
  messages: ChatMessage[];
  /** The question the assistant waits on, if any. */
  pendingQuestion: ClientPrompt | null;
  approvals: PendingApproval[];
}

const questionText = (input: Record<string, unknown>): string | null =>
  typeof input.question === 'string' && input.question.trim() ? input.question : null;

const preferenceOf = (input: Record<string, unknown>, locale: LocaleContent) =>
  typeof input.preference_id === 'string' ? locale.preferencePrompts[input.preference_id] : undefined;

/** A dismissed question shows as the Skip label. */
export const historyToChat = (history: History, locale: LocaleContent): ChatSnapshot => {
  const pending = history.pending_questions?.[0];
  const pendingQuestion: ClientPrompt | null = pending ? { callId: pending.call_id, toolName: pending.name, input: pending.input ?? {} } : null;
  const approvals: PendingApproval[] = (history.pending_approvals ?? []).map((a) => ({
    callId: a.call_id,
    name: a.name,
    input: a.input,
    reason: a.reason ?? null,
  }));
  const pendingApprovalIds = new Set(approvals.map((a) => a.callId));

  const questions = new Map<string, QuestionData>();
  const messages: ChatMessage[] = [];

  for (const m of history.messages) {
    switch (m.role) {
      case 'user':
      case 'assistant':
        messages.push({ role: m.role, content: m.content });
        break;

      case 'question': {
        questions.set(m.data.call_id, m.data);
        const input = m.data.input ?? {};
        if (m.data.toolName === 'prompt_preference') {
          // A pending preference question is shown by its own prompt UI.
          const pref = preferenceOf(input, locale);
          if (pref && m.data.call_id !== pendingQuestion?.callId) {
            messages.push({ role: 'assistant', content: pref.question });
          }
        } else {
          const text = questionText(input) ?? (m.content.trim() || null);
          if (text) messages.push({ role: 'assistant', content: text });
        }
        break;
      }

      case 'answer': {
        if (m.data.is_error) {
          messages.push({ role: 'cancel', content: locale.chat.skipLabel });
          break;
        }
        const question = questions.get(m.data.call_id);
        const pref = question?.toolName === 'prompt_preference' ? preferenceOf(question.input ?? {}, locale) : undefined;
        if (pref && (m.content === 'subscribed' || m.content === 'declined')) {
          const yes = m.content === 'subscribed';
          messages.push({ role: 'user', content: yes ? pref.ctaYesLabel : pref.ctaNoLabel });
          messages.push({ role: 'assistant', content: yes ? pref.confirmText : pref.declineText });
        } else {
          messages.push({ role: 'user', content: m.content });
        }
        break;
      }

      case 'approval':
        // Pending approvals are shown as cards with buttons.
        if (!pendingApprovalIds.has(m.data.call_id)) {
          messages.push({
            role: 'approval',
            callId: m.data.call_id,
            name: m.data.name,
            input: m.data.input,
            reason: m.data.reason ?? null,
            decision: null,
          });
        }
        break;

      case 'tool':
        // Tool runs aren't part of the visible conversation.
        break;
    }
  }

  return { messages, pendingQuestion, approvals };
};
