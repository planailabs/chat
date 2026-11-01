/**
 * Chat History — turns the server's conversation record into what the chat
 * shows: the same bubbles the live conversation produced, plus whatever the
 * conversation waits on (a question, approvals).
 */

import type { ApprovalData, History, HistoryMessage, QuestionData } from '../../api';
import type { ChatMessage, ClientPrompt, PendingApproval } from '../../app/state';
import type { LocaleContent } from '../../content';
import { pendingApprovalOf, toolRunOf } from './toolRuns';

/** The agent's phase in the history: thinking or running tools is working (no composer). */
export const isWorkingPhase = (phase: string | null | undefined): boolean => phase === 'thinking' || phase === 'tools';

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

// ─── Defensive reading: the server's record must never break the chat ──────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A list, a single object (as one item), or nothing. */
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObject(v) ? [v] : []);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Pending questions: well-formed ones only (call id and tool name). */
export const pendingQuestionsOf = (v: unknown): { call_id: string; name: string; input: Record<string, unknown> }[] =>
  asList(v)
    .filter(isObject)
    .filter((q) => str(q.call_id) && str(q.name))
    .map((q) => ({ call_id: str(q.call_id), name: str(q.name), input: isObject(q.input) ? q.input : {} }));

/** Pending approvals in the approval event's shape; malformed entries are dropped. */
export const pendingApprovalsOf = (v: unknown): PendingApproval[] =>
  asList(v)
    .filter(isObject)
    .filter((a) => str(a.call_id) && str(a.name))
    .map((a) => pendingApprovalOf(a as unknown as ApprovalData));

/** A dismissed question shows as the Skip label; an answered one as "question → answer". */
export const historyToChat = (history: History, locale: LocaleContent): ChatSnapshot => {
  const pending = pendingQuestionsOf(history.pending_questions)[0];
  const pendingQuestion: ClientPrompt | null = pending ? { callId: pending.call_id, toolName: pending.name, input: pending.input } : null;
  const approvals = pendingApprovalsOf(history.pending_approvals);
  const pendingApprovalIds = new Set(approvals.map((a) => a.callId));

  const questions = new Map<string, QuestionData>();
  /** Answered-or-not ask_question entries, by call id (filled by their answer). */
  const asked = new Map<string, Extract<ChatMessage, { role: 'qa' }>>();
  const messages: ChatMessage[] = [];

  for (const raw of asList(history.messages)) {
    if (!isObject(raw)) continue;
    // Rows missing their data (or with odd fields) are read as empty, never thrown on.
    const m = { ...raw, content: str(raw.content), data: isObject(raw.data) ? raw.data : {} } as unknown as HistoryMessage;
    if ((m.role === 'question' || m.role === 'answer' || m.role === 'tool' || m.role === 'approval') && !str(m.data.call_id)) continue;
    if (m.role === 'approval' && !str(m.data.name)) continue;
    switch (m.role) {
      case 'user':
      case 'assistant':
        messages.push({ role: m.role, content: m.content, id: typeof m.id === 'number' ? m.id : undefined });
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
        } else if (m.data.call_id !== pendingQuestion?.callId) {
          // A pending question is shown by its prompt; a past one as one
          // compact "question → answer" entry (the answer fills it in).
          const text = questionText(input) ?? (m.content.trim() || null);
          if (text) {
            const entry = { role: 'qa' as const, question: text, answer: null };
            asked.set(m.data.call_id, entry);
            messages.push(entry);
          }
        }
        break;
      }

      case 'answer': {
        const entry = asked.get(m.data.call_id);
        if (entry) {
          entry.answer = m.data.is_error ? null : m.content;
          break;
        }
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
          messages.push({ role: 'approval', ...pendingApprovalOf(m.data), decision: null });
        }
        break;

      case 'tool':
        // A compact row: the tool, why the assistant ran it, the safety check.
        messages.push({ role: 'tool', ...toolRunOf(m.content, m.data ?? {}) });
        break;
    }
  }

  return { messages, pendingQuestion, approvals };
};
