import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import McpApps from './McpApps.vue';

const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('connected MCP apps', () => {
  it('lists the apps and their calls, and disconnects one', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/mcp_app') return json([{ client_id: 'mcp-1', name: 'Claude', connected_at: '2026-11-03T10:00:00Z', last_used_at: null }]);
      if (url === '/api/v1/mcp_call') return json([{ client: 'Claude', tool: 'mac-mgmt.skill_delete', decision: 'deny', reason: 'declined', created_at: '2026-11-03T10:05:00Z' }]);
      if (url === '/api/v1/mcp_app/remove' && init?.method === 'POST') return json({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    const w = mount(McpApps);
    await flushPromises();
    expect(w.text()).toContain('Claude');
    expect(w.text()).toContain('mac-mgmt.skill_delete');
    await w.find('button').trigger('click');
    await flushPromises();
    const removed = fetchMock.mock.calls.find(([u]) => u === '/api/v1/mcp_app/remove');
    expect(JSON.parse(removed![1].body)).toEqual({ client_id: 'mcp-1' });
    expect(w.findAll('li').filter((li) => li.text().includes('Disconnect'))).toHaveLength(0);
  });
});
