/**
 * The open conversation's state machine, as a table: every state × every
 * event, then resync and reload (history) in every phase. "Settled" is the
 * state once the tool spinner's short delay has passed. The composer shows
 * exactly in idle and error (a text question uses it too).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../app/store';
import type { ChatEventName, ConversationEvent } from '../../api';
import type { ChatPhase, ChatSession } from '../../app/state';
import type { ConversationItem } from './conversationList';
import { routeServerEvent } from './events';
import { showsComposer } from './stateMachine';
import { openConversation } from './session';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const conv = (id: string): ConversationItem => ({ id, title: id, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' });

type State = 'idle' | 'thinking' | 'streaming' | 'tools' | 'question' | 'approval' | 'error';

const approval = { callId: 'p1', name: 'delete_files', input: {}, reason: null, agentReason: 'Free space', check: null };

/** A chat in each state, as the live events leave it. */
const chatIn = (state: State): ChatSession => {
  const base: ChatSession = { messages: [], phase: 'idle', approvals: [] };
  switch (state) {
    case 'idle':
      return base;
    case 'thinking':
      return { ...base, phase: 'waiting' };
    case 'streaming':
      return { ...base, phase: 'streaming', streamingText: 'Hel' };
    case 'tools':
      return { ...base, phase: 'tool', toolName: 'run_command' };
    case 'question':
      return { ...base, phase: 'question', clientPrompt: { callId: 'q1', toolName: 'ask_question', input: { type: 'multiple_choice', question: 'A or B?', options: ['A', 'B'] } } };
    case 'approval':
      return { ...base, phase: 'approval', approvals: [{ ...approval }] };
    case 'error':
      return { ...base, phase: 'error', error: 'Boom' };
  }
};

const EVENTS: Record<string, [ChatEventName, object]> = {
  thinking: ['thinking', {}],
  text_delta: ['text_delta', { content: 'lo' }],
  text_done: ['text_done', { content: 'Hello' }],
  tool_start: ['tool_start', { name: 'read_file', call_id: 'c1', reason: 'Look' }],
  tool_end: ['tool_end', { name: 'read_file', call_id: 'c1', is_error: false, reason: 'Look' }],
  question: ['question', { call_id: 'q2', toolName: 'ask_question', input: { type: 'text', question: 'Name?' } }],
  approval: ['approval', { call_id: 'p2', name: 'install_app', input: { app: 'Zed' }, reason: null, agent_reason: 'Needs an editor', check: null }],
  done: ['done', {}],
  error: ['error', { message: 'Failed' }],
};

type Ev = keyof typeof EVENTS;
const ORDER: Ev[] = ['thinking', 'text_delta', 'text_done', 'tool_start', 'tool_end', 'question', 'approval', 'done', 'error'];

/** Settled phase after each event, per state (columns in ORDER). */
const TABLE: Record<State, ChatPhase[]> = {
  //          thinking   text_delta   text_done  tool_start tool_end   question    approval    done        error
  idle:      ['waiting', 'streaming', 'waiting', 'tool', 'waiting', 'question', 'approval', 'idle', 'error'],
  thinking:  ['waiting', 'streaming', 'waiting', 'tool', 'waiting', 'question', 'approval', 'idle', 'error'],
  streaming: ['waiting', 'streaming', 'waiting', 'tool', 'waiting', 'question', 'approval', 'idle', 'error'],
  tools:     ['waiting', 'streaming', 'waiting', 'tool', 'waiting', 'question', 'approval', 'idle', 'error'],
  // Waiting on the user: work events don't replace the question or the cards.
  question:  ['question', 'question', 'question', 'question', 'question', 'question', 'approval', 'question', 'error'],
  approval:  ['approval', 'approval', 'approval', 'approval', 'approval', 'question', 'approval', 'approval', 'error'],
  error:     ['waiting', 'streaming', 'waiting', 'tool', 'waiting', 'question', 'approval', 'idle', 'error'],
};

const rows = (Object.keys(TABLE) as State[]).flatMap((state) => ORDER.map((ev, i) => ({ state, ev, expected: TABLE[state][i] })));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  Object.assign(store.state, { isAuthenticated: true, userId: 'u1', conversations: [conv(ID)], activeConversationId: ID });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live events', () => {
  it.each(rows)('$state + $ev → $expected', ({ state, ev, expected }) => {
    store.state.chat = chatIn(state);
    const [name, data] = EVENTS[ev];
    routeServerEvent(name, { conversation: ID, ...data } as ConversationEvent);
    vi.advanceTimersByTime(1000);
    const mc = store.state.chat!;
    expect(mc.phase).toBe(expected);
    const textQuestion = expected === 'question' && (mc.clientPrompt?.input as { type?: string }).type === 'text';
    expect(showsComposer(mc)).toBe(expected === 'idle' || expected === 'error' || textQuestion);
    // What the user must act on never disappears.
    if (state === 'approval' && expected !== 'error') expect(mc.approvals.some((a) => a.callId === 'p1')).toBe(true);
    if (expected === 'approval') expect(mc.approvals.length).toBeGreaterThan(0);
  });

  it('tool_end leaves the spinner a moment, then works on (not idle)', () => {
    store.state.chat = chatIn('tools');
    routeServerEvent('tool_end', { conversation: ID, name: 'read_file', call_id: 'c1', is_error: false } as ConversationEvent);
    expect(store.state.chat!.phase).toBe('tool');
    vi.advanceTimersByTime(1000);
    expect(store.state.chat!.phase).toBe('waiting');
    expect(store.state.chat!.messages.at(-1)).toMatchObject({ role: 'tool', name: 'read_file' });
  });
});

// ─── Reload / resync: the history lands in the state the live events would ──

class FakeEventSource {
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  addEventListener() {}
  close() {}
}

const history = (extra: object) => ({
  id: ID,
  title: 't',
  messages: [{ id: 1, role: 'user', content: 'Hi', data: null, at: '2026-11-01T00:00:00Z' }],
  phase: 'idle',
  pending_questions: [],
  pending_approvals: [],
  auto_approve: false,
  ...extra,
});

const serve = (body: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === '/api/v1/chat/history' ? body : []), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );

const pendingApproval = { call_id: 'p1', name: 'organization_create', input: { name: 'clover-inc' }, reason: 'Creates an organization', agent_reason: 'The user asked for it', check: null };
const pendingQuestion = { call_id: 'q1', name: 'ask_question', input: { type: 'multiple_choice', question: 'A or B?', options: ['A', 'B'] } };

const RELOAD: { name: string; body: object; phase: ChatPhase; composer: boolean }[] = [
  { name: 'idle', body: { phase: 'idle' }, phase: 'idle', composer: true },
  { name: 'thinking', body: { phase: 'thinking' }, phase: 'waiting', composer: false },
  { name: 'tools', body: { phase: 'tools' }, phase: 'tool', composer: false },
  { name: 'a pending question', body: { phase: 'idle', pending_questions: [pendingQuestion] }, phase: 'question', composer: false },
  { name: 'a pending approval', body: { phase: 'idle', pending_approvals: [pendingApproval] }, phase: 'approval', composer: false },
  // Older servers: one raw object instead of a list (must not break the chat).
  { name: 'a pending approval (single object)', body: { phase: 'tools', pending_approvals: pendingApproval }, phase: 'approval', composer: false },
  { name: 'a pending question (single object)', body: { pending_questions: pendingQuestion }, phase: 'question', composer: false },
  { name: 'malformed pending entries', body: { phase: 'idle', pending_approvals: [{ tool: 'x' }], pending_questions: 'nope' }, phase: 'idle', composer: true },
];

describe('reload from history', () => {
  beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));

  it.each(RELOAD)('$name → $phase', async ({ body, phase, composer }) => {
    serve(history(body));
    store.state.chat = chatIn('idle');
    await openConversation(ID, 'none');
    const mc = store.state.chat!;
    expect(mc.phase).toBe(phase);
    expect(showsComposer(mc)).toBe(composer);
    if (phase === 'approval') expect(mc.approvals[0]).toMatchObject({ callId: 'p1', name: 'organization_create', agentReason: 'The user asked for it' });
    if (phase === 'question') expect(mc.clientPrompt).toMatchObject({ callId: 'q1', toolName: 'ask_question' });
  });

  it('a history it can\'t read shows an error, not a blank chat', async () => {
    serve(history({ messages: 'garbage', pending_approvals: [null, 3, pendingApproval] }));
    await openConversation(ID, 'none');
    expect(store.state.chat!.phase).toBe('approval');
    expect(store.state.chat!.approvals).toHaveLength(1);
  });
});

describe('resync', () => {
  beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));

  it.each(RELOAD.slice(0, 5))('mid-turn, the history with $name → $phase', async ({ body, phase }) => {
    serve(history(body));
    store.state.chat = chatIn('thinking');
    routeServerEvent('resync', {} as ConversationEvent);
    await vi.advanceTimersByTimeAsync(10);
    // A turn already live here stays live when the server hasn't caught up (idle).
    const expected = phase === 'idle' ? 'waiting' : phase;
    expect(store.state.chat!.phase).toBe(expected);
  });
});
