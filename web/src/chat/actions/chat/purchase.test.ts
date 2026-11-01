import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { store } from '../../app/store';
import { decideApproval } from './stateMachine';
import { pendingApprovalOf } from './toolRuns';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const purchase = { tool: 't', product: 'p', product_name: 'P', organization_name: 'o', price_cents: 100, currency: 'EUR', interval: 'month', summary: 's' };

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

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
const approveBodies = () => fetchMock.mock.calls.filter(([url]) => url === '/api/v1/chat/approve').map(([, init]) => JSON.parse(init?.body as string));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
  Object.assign(store.state, {
    isAuthenticated: true,
    activeConversationId: ID,
    chat: {
      messages: [],
      phase: 'approval',
      approvals: [
        pendingApprovalOf({ call_id: 'a1', name: 'install_app', input: {} }),
        pendingApprovalOf({ call_id: 'b1', name: 'connector.call_tool', input: {}, purchase: purchase as never }),
      ],
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('purchases', () => {
  it('are confirmed explicitly', async () => {
    await decideApproval('b1', 'approve');
    await flushPromises();
    expect(approveBodies()).toEqual([{ id: ID, call_id: 'b1', approved: true, confirm_purchase: true }]);
    expect(store.state.chat?.messages.at(-1)).toMatchObject({ role: 'approval', callId: 'b1', decision: 'approved' });
  });

  it('are declined without the confirmation', async () => {
    await decideApproval('b1', 'deny');
    await flushPromises();
    expect(approveBodies()).toEqual([{ id: ID, call_id: 'b1', approved: false }]);
  });

  it('are never covered by "approve all" on another card', async () => {
    await decideApproval('a1', 'approve_all');
    await flushPromises();
    expect(approveBodies()).toEqual([{ id: ID, call_id: 'a1', approved: true, all: true }]);
    // The purchase still waits, with its card.
    expect(store.state.chat?.approvals.map((a) => a.callId)).toEqual(['b1']);
    expect(store.state.chat?.phase).toBe('approval');
  });
});
