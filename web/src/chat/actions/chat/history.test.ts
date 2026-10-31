import { describe, expect, it } from 'vitest';
import type { History, HistoryMessage } from '../../api';
import { locales } from '../../content';
import { historyToChat } from './history';

const en = locales.en;
const at = '2026-10-01T10:00:00Z';
let nextId = 1;
const msg = (m: Omit<HistoryMessage, 'id' | 'at'>): HistoryMessage => ({ id: nextId++, at, ...m }) as HistoryMessage;

const history = (messages: HistoryMessage[], extra: Partial<History> = {}): History => ({
  id: 'c1',
  title: 'A conversation',
  messages,
  phase: 'idle',
  pending_questions: null,
  pending_approvals: null,
  auto_approve: false,
  ...extra,
});

describe('historyToChat', () => {
  it('handles an empty conversation', () => {
    expect(historyToChat(history([]), en)).toEqual({ messages: [], pendingQuestion: null, approvals: [] });
  });

  it('keeps user and assistant messages and hides tool runs', () => {
    const snapshot = historyToChat(
      history([
        msg({ role: 'user', content: 'Install git', data: null }),
        msg({ role: 'tool', content: 'run_command', data: { call_id: 'c0', is_error: false } }),
        msg({ role: 'assistant', content: 'Done.', data: null }),
      ]),
      en,
    );
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'Install git' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });

  it('shows answered and dismissed questions like the live chat did', () => {
    const snapshot = historyToChat(
      history([
        msg({ role: 'question', content: 'Which editor?', data: { call_id: 'q1', toolName: 'ask_question', input: { type: 'multiple_choice', question: 'Which editor?', options: ['Vim', 'Zed'] } } }),
        msg({ role: 'answer', content: 'Zed', data: { call_id: 'q1', is_error: false } }),
        msg({ role: 'question', content: 'Your name?', data: { call_id: 'q2', toolName: 'ask_question', input: { type: 'text', question: 'Your name?' } } }),
        msg({ role: 'answer', content: 'The user dismissed this question.', data: { call_id: 'q2', is_error: true } }),
      ]),
      en,
    );
    expect(snapshot.messages).toEqual([
      { role: 'assistant', content: 'Which editor?' },
      { role: 'user', content: 'Zed' },
      { role: 'assistant', content: 'Your name?' },
      { role: 'cancel', content: 'Skip' },
    ]);
  });

  it('replays an answered newsletter preference in the UI language', () => {
    const pref = locales.de.preferencePrompts.newsletter;
    const snapshot = historyToChat(
      history([
        msg({ role: 'question', content: '', data: { call_id: 'p1', toolName: 'prompt_preference', input: { preference_id: 'newsletter' } } }),
        msg({ role: 'answer', content: 'subscribed', data: { call_id: 'p1', is_error: false } }),
      ]),
      locales.de,
    );
    expect(snapshot.messages).toEqual([
      { role: 'assistant', content: pref.question },
      { role: 'user', content: pref.ctaYesLabel },
      { role: 'assistant', content: pref.confirmText },
    ]);
  });

  it('returns the pending question and leaves a pending preference to its prompt UI', () => {
    const snapshot = historyToChat(
      history(
        [msg({ role: 'question', content: '', data: { call_id: 'p2', toolName: 'prompt_preference', input: { preference_id: 'newsletter' } } })],
        { pending_questions: [{ call_id: 'p2', name: 'prompt_preference', input: { preference_id: 'newsletter' } }] },
      ),
      en,
    );
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.pendingQuestion).toEqual({ callId: 'p2', toolName: 'prompt_preference', input: { preference_id: 'newsletter' } });
  });

  it('separates pending approvals from past ones', () => {
    const snapshot = historyToChat(
      history(
        [
          msg({ role: 'approval', content: 'install_app', data: { call_id: 'a1', name: 'install_app', input: { app: 'Zed' }, reason: null } }),
          msg({ role: 'approval', content: 'remove_app', data: { call_id: 'a2', name: 'remove_app', input: { app: 'Vim' }, reason: 'Destructive' } }),
        ],
        { pending_approvals: [{ call_id: 'a2', name: 'remove_app', input: { app: 'Vim' }, reason: 'Destructive' }] },
      ),
      en,
    );
    expect(snapshot.messages).toEqual([
      { role: 'approval', callId: 'a1', name: 'install_app', input: { app: 'Zed' }, reason: null, decision: null },
    ]);
    expect(snapshot.approvals).toEqual([{ callId: 'a2', name: 'remove_app', input: { app: 'Vim' }, reason: 'Destructive' }]);
  });
});
