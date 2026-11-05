import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Connectors from './Connectors.vue';
import { store } from '../app/store';
import type { Connector, ConnectorList } from '../api';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const connector = (over: Partial<Connector>): Connector => ({
  id: 'c1',
  team_id: 'team-me',
  name: 'docs',
  service: 'docs',
  description: '',
  url: 'https://docs.example.com/mcp',
  auth: 'bearer',
  oauth_mode: null,
  token: '…abcd',
  status: 'ready',
  status_detail: null,
  can_manage: true,
  can_connect: false,
  source: 'team',
  ...over,
});

const list = (): ConnectorList => ({
  enabled: true,
  teams: [
    { id: 'team-me', name: 'Ada', personal: true, role: 'admin', can_manage: true },
    { id: 'team-acme', name: 'ACME', personal: false, role: 'read', can_manage: false },
  ],
  connectors: [
    connector({}),
    connector({
      id: 'c2',
      team_id: 'team-acme',
      name: 'crm',
      service: 'acme/crm',
      auth: 'oauth',
      oauth_mode: 'per_member',
      token: null,
      status: 'needs_reconnect',
      status_detail: 'the service refused the token',
      can_manage: false,
      can_connect: true,
    }),
    connector({
      id: 'c3',
      team_id: 'team-acme',
      name: 'wiki',
      service: 'acme/wiki',
      auth: 'oauth',
      oauth_mode: 'shared',
      token: null,
      status: 'connect_first',
      can_manage: false,
      can_connect: false,
    }),
    connector({ id: 'app:notes', team_id: null, name: 'notes', service: 'notes', auth: 'oauth', oauth_mode: 'per_member', token: null, status: 'connected', can_manage: false, can_connect: true, source: 'config' }),
  ],
});

const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => u === path);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  store.state.impersonating = false;
});
afterEach(() => vi.unstubAllGlobals());

describe('connectors settings', () => {
  it('shows each team with its connectors, statuses and what the user may do', async () => {
    fetchMock.mockImplementation(async () => json(list()));
    const w = mount(Connectors);
    await flushPromises();
    const mine = w.get('[data-testid="connector-group-team-me"]');
    expect(mine.text()).toContain('Yours');
    expect(mine.text()).toContain('token …abcd');
    expect(mine.text()).toContain('Edit');
    expect(mine.text()).toContain('Add connector');

    const acme = w.get('[data-testid="connector-group-team-acme"]');
    expect(acme.text()).toContain('Team ACME');
    expect(acme.text()).not.toContain('Add connector');
    const crm = w.get('[data-testid="connector-c2"]');
    expect(crm.text()).toContain('needs reconnecting');
    expect(crm.text()).toContain('acme/crm');
    expect(crm.text()).toContain('the service refused the token');
    expect(crm.text()).toContain('Reconnect');
    expect(crm.text()).not.toContain('Edit');
    const wiki = w.get('[data-testid="connector-c3"]');
    expect(wiki.text()).toContain('connect first');
    expect(wiki.text()).toContain('A team admin connects it.');
    expect(wiki.findAll('button')).toHaveLength(0);

    const configured = w.get('[data-testid="connector-group-config"]');
    expect(configured.text()).toContain('From plan.ai');
    expect(configured.text()).toContain('Disconnect');
  });

  it('adds a bearer connector to the personal team', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/connector' && init?.method === 'POST') return json(connector({ id: 'c9', name: 'prom' }));
      return json(list());
    });
    const w = mount(Connectors);
    await flushPromises();
    const mine = w.get('[data-testid="connector-group-team-me"]');
    await mine.findAll('button').find((b) => b.text() === 'Add connector')!.trigger('click');
    const form = w.get('[data-testid="connector-add-form"]');
    await form.get('input[aria-label="Name"]').setValue('prom');
    await form.get('input[aria-label="MCP server URL (https)"]').setValue('https://prom.example.com/mcp');
    await form.get('input[aria-label="Token"]').setValue('s3cret');
    // A personal team has no shared OAuth mode.
    expect(form.findAll('option').map((o) => o.attributes('value'))).toEqual(['bearer', 'oauth_per_member', 'none']);
    await form.trigger('submit');
    await flushPromises();
    const created = calls('/api/v1/connector').find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(created[1].body)).toEqual({
      team_id: 'team-me',
      name: 'prom',
      description: '',
      url: 'https://prom.example.com/mcp',
      auth: { type: 'bearer', token: 's3cret' },
    });
    expect(w.find('[data-testid="connector-add-form"]').exists()).toBe(false);
  });

  it('shows why the server refused a connector', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/connector' && init?.method === 'POST')
        return json({ error: 'bad_request', message: 'https://127.0.0.1/mcp: 127.0.0.1 is a private or reserved address' }, 400);
      return json(list());
    });
    const w = mount(Connectors);
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === 'Add connector')!.trigger('click');
    const form = w.get('[data-testid="connector-add-form"]');
    await form.get('input[aria-label="Name"]').setValue('x');
    await form.get('input[aria-label="MCP server URL (https)"]').setValue('https://127.0.0.1/mcp');
    await form.get('select').setValue('none');
    await form.trigger('submit');
    await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain('private or reserved address');
    expect(w.find('[data-testid="connector-add-form"]').exists()).toBe(true);
  });

  it('reconnects through the server-given link, disconnects, removes', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/connector/c2/connect') return json({ url: 'https://chat.test/connectors/oauth/start?connector=c2' });
      if (url === '/api/v1/connector/app%3Anotes/disconnect') return json({ ok: true });
      if (url === '/api/v1/connector/c1' && init?.method === 'DELETE') return json({ ok: true });
      return json(list());
    });
    const w = mount(Connectors);
    await flushPromises();
    await w.get('[data-testid="connector-c2"]').findAll('button').find((b) => b.text() === 'Reconnect')!.trigger('click');
    await flushPromises();
    expect(assign).toHaveBeenCalledWith('https://chat.test/connectors/oauth/start?connector=c2');
    await w.get('[data-testid="connector-app:notes"]').findAll('button').find((b) => b.text() === 'Disconnect')!.trigger('click');
    await flushPromises();
    expect(calls('/api/v1/connector/app%3Anotes/disconnect')).toHaveLength(1);
    await w.get('[data-testid="connector-c1"]').findAll('button').find((b) => b.text() === 'Remove')!.trigger('click');
    await flushPromises();
    expect(calls('/api/v1/connector/c1')).toHaveLength(1);
  });

  it('changes nothing while impersonating', async () => {
    store.state.impersonating = true;
    fetchMock.mockImplementation(async () => json(list()));
    const w = mount(Connectors);
    await flushPromises();
    for (const b of w.findAll('button')) expect(b.attributes('disabled')).toBeDefined();
  });
});
