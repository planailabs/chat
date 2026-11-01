import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../app/store';
import type { ChatEventName, ConversationEvent } from '../../api';
import type { ConversationItem } from './conversationList';
import { routeServerEvent } from './events';
import { showsComposer } from './stateMachine';
import { isWorkingPhase } from './history';
import { openConversation } from './session';

const conv = (id: string): ConversationItem => ({ id, title: id, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' });

const ev = (name: ChatEventName, data: object = {}, conversation = 'a') => routeServerEvent(name, { conversation, ...data } as ConversationEvent);
const composer = () => showsComposer(store.state.chat!);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  Object.assign(store.state, {
    isAuthenticated: true,
    userId: 'u1',
    conversations: [conv('a'), conv('b')],
    activeConversationId: 'a',
    chat: { messages: [], phase: 'idle', approvals: [] },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the composer while the assistant works', () => {
  it('stays hidden from thinking to done, through streaming, a step\'s text and tools', () => {
    expect(composer()).toBe(true);
    const seen: boolean[] = [];
    const step = (name: ChatEventName, data: object = {}) => {
      ev(name, data);
      seen.push(composer());
      vi.advanceTimersByTime(100);
      seen.push(composer());
    };
    step('thinking');
    step('text_delta', { content: 'Let me ' });
    step('text_delta', { content: 'look.' });
    step('text_done', { content: 'Let me look.' });
    step('tool_start', { name: 'run_command', call_id: 'c1', reason: 'List files' });
    expect(store.state.chat).toMatchObject({ phase: 'tool', toolName: 'run_command', toolReason: 'List files' });
    step('tool_end', { name: 'run_command', call_id: 'c1', is_error: false, reason: 'List files' });
    vi.advanceTimersByTime(1000);
    seen.push(composer());
    step('text_done', { content: 'Found it.' });
    expect(seen.every((shown) => !shown)).toBe(true);

    ev('done');
    expect(composer()).toBe(true);
    expect(store.state.chat?.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('stays hidden when a step\'s text is followed by a tool (no flicker)', () => {
    ev('thinking');
    ev('text_done', { content: 'Checking…' });
    expect(composer()).toBe(false);
    ev('tool_start', { name: 'read_file', call_id: 'c2' });
    expect(composer()).toBe(false);
  });

  it('a text_done without streaming (e.g. after a reload) still means working', () => {
    ev('text_done', { content: 'Partial' });
    expect(composer()).toBe(false);
  });

  it('shows again for an error; questions and approvals replace it', () => {
    ev('thinking');
    ev('error', { message: 'Boom' });
    expect(composer()).toBe(true);

    ev('thinking');
    ev('approval', { call_id: 'p1', name: 'delete_files', input: {}, reason: null, agent_reason: 'Free space', check: { decision: 'asked', verdict: 'failed', reasoning: null } });
    expect(store.state.chat?.phase).toBe('approval');
    // Another call's tool events don't hide the approval cards.
    ev('tool_start', { name: 'read_file', call_id: 'c3' });
    ev('tool_end', { name: 'read_file', call_id: 'c3', is_error: false });
    expect(store.state.chat?.phase).toBe('approval');
    expect(store.state.chat?.approvals[0]).toMatchObject({ agentReason: 'Free space' });
  });

  it('another conversation working leaves this one\'s composer alone', () => {
    ev('thinking', {}, 'b');
    ev('tool_start', { name: 'x', call_id: 'c9' }, 'b');
    expect(composer()).toBe(true);
    expect(store.state.conversations.find((c) => c.id === 'b')?.busy).toBe(true);
  });
});

describe('the history phase', () => {
  it('thinking and tools are working', () => {
    expect(isWorkingPhase('thinking')).toBe(true);
    expect(isWorkingPhase('tools')).toBe(true);
    expect(isWorkingPhase('idle')).toBe(false);
    expect(isWorkingPhase(null)).toBe(false);
  });
});

describe('opening a conversation', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const respond = (phase: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/v1/chat/history'
          ? new Response(JSON.stringify({ id: ID, title: 't', messages: [], phase, pending_questions: null, pending_approvals: null, auto_approve: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );

  beforeEach(() => {
    // The event stream: opened, never delivers anything here.
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
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('hides the composer while the history says the agent works', async () => {
    store.state.conversations = [conv(ID)];
    respond('tools');
    await openConversation(ID, 'none');
    expect(composer()).toBe(false);
    expect(store.state.conversations[0].busy).toBe(true);
  });

  it('shows it when the agent is idle, even if the list thought it busy', async () => {
    store.state.conversations = [{ ...conv(ID), busy: true }];
    respond('idle');
    const opening = openConversation(ID, 'none');
    // Until the history is back: working, as the list says (no composer flash).
    expect(composer()).toBe(false);
    await opening;
    expect(composer()).toBe(true);
    expect(store.state.conversations[0].busy).toBe(false);
  });
});
