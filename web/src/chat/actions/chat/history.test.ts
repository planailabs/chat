import { describe, expect, it } from 'vitest';
import type { History, HistoryMessage, SafetyCheck } from '../../api';
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

  it('keeps user and assistant messages (with their ids) and tool runs as compact rows', () => {
    const [user, tool, assistant] = [
      msg({ role: 'user', content: 'Install git', data: null }),
      msg({ role: 'tool', content: 'run_command', data: { call_id: 'c0', is_error: false } }),
      msg({ role: 'assistant', content: 'Done.', data: null }),
    ];
    const snapshot = historyToChat(history([user, tool, assistant]), en);
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'Install git', id: user.id },
      { role: 'tool', callId: 'c0', name: 'run_command', isError: false, reason: null, target: null, check: null },
      { role: 'assistant', content: 'Done.', id: assistant.id },
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
      { role: 'qa', question: 'Which editor?', answer: 'Zed' },
      { role: 'qa', question: 'Your name?', answer: null },
    ]);
  });

  it('shows a pending question only as its prompt', () => {
    const input = { type: 'multiple_choice', question: 'Demo or callback?', options: ['Demo', 'Callback'] };
    const snapshot = historyToChat(
      history(
        [
          msg({ role: 'assistant', content: 'Want a demo?', data: null }),
          msg({ role: 'question', content: 'Demo or callback?', data: { call_id: 'q9', toolName: 'ask_question', input } }),
        ],
        { pending_questions: [{ call_id: 'q9', name: 'ask_question', input }] },
      ),
      en,
    );
    expect(snapshot.messages.map((m) => m.role)).toEqual(['assistant']);
    expect(snapshot.pendingQuestion).toEqual({ callId: 'q9', toolName: 'ask_question', input });
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
      { role: 'approval', callId: 'a1', name: 'install_app', input: { app: 'Zed' }, reason: null, agentReason: null, check: null, purchase: null, decision: null },
    ]);
    expect(snapshot.approvals).toEqual([{ callId: 'a2', name: 'remove_app', input: { app: 'Vim' }, reason: 'Destructive', agentReason: null, check: null, purchase: null }]);
  });

  it('carries each tool call\'s reason and safety check', () => {
    const check: SafetyCheck = { agent_reason: 'Free disk space', decision: 'allowed', verdict: 'approved', reasoning: 'Matches the reason.' };
    const snapshot = historyToChat(
      history(
        [
          msg({ role: 'tool', content: 'run_command', data: { call_id: 't1', is_error: false, reason: 'List big files', check } }),
          msg({ role: 'tool', content: 'read_file', data: { call_id: 't2', is_error: true, check: { ...check, decision: 'denied', verdict: 'rejected' } } }),
        ],
        { pending_approvals: [{ call_id: 'a3', name: 'delete_files', input: {}, reason: 'Needs your OK', agent_reason: 'Free disk space', check: { ...check, decision: 'asked', verdict: 'failed', reasoning: null } }] },
      ),
      en,
    );
    expect(snapshot.messages).toEqual([
      { role: 'tool', callId: 't1', name: 'run_command', isError: false, reason: 'List big files', target: null, check },
      // No reason on the row: the check's copy of the agent's reason.
      { role: 'tool', callId: 't2', name: 'read_file', isError: true, reason: 'Free disk space', target: null, check: { ...check, decision: 'denied', verdict: 'rejected' } },
    ]);
    expect(snapshot.approvals[0]).toMatchObject({ reason: 'Needs your OK', agentReason: 'Free disk space', check: { decision: 'asked', verdict: 'failed', reasoning: null } });
  });
});
