import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageDoc } from '../api';

const call = vi.fn();
const backflow = vi.fn();
vi.mock('../api', () => ({ api: { pages: { call: (...a: unknown[]) => call(...a), backflow: (...a: unknown[]) => backflow(...a), kv: vi.fn(), message: vi.fn(), context: vi.fn() } } }));

const { PageHost, linkAllowed, styleVariables } = await import('./pageHost');

const doc = (over: Partial<PageDoc> = {}): PageDoc => ({
  id: 'p1', kind: 'artifact', title: 'T', name: 'n', service: null, conversation: 'c', version: 2, latest: 2, html: '', tool: null, prefers_border: null, ...over,
});

/** A page window: what the host posts to it. */
const frame = () => {
  const posted: Record<string, unknown>[] = [];
  return { posted, win: { postMessage: (m: Record<string, unknown>) => posted.push(m) } as unknown as Window };
};

const opts = (confirm = vi.fn(async () => true), gesture = true) => ({
  openLinkText: (url: string) => `open ${url}?`,
  gesture: () => gesture,
  theme: () => 'dark' as const,
  lang: () => 'de',
  confirm,
  displayMode: (m: string) => (m === 'fullscreen' ? ('fullscreen' as const) : ('inline' as const)),
  currentDisplayMode: () => 'inline' as const,
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const send = (host: InstanceType<typeof PageHost>, source: Window, data: unknown) => host.handle({ source, data } as MessageEvent);

describe('PageHost', () => {
  beforeEach(() => {
    call.mockReset();
    backflow.mockReset();
  });

  it('answers ui/initialize with the chat theme and only talks after initialized', async () => {
    const f = frame();
    const host = new PageHost(() => f.win, doc(), opts());
    host.kvChanged({ a: 1 });
    expect(f.posted).toEqual([]);
    send(host, f.win, { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} });
    await settle();
    const init = f.posted[0] as { id: number; result: { protocolVersion: string; hostContext: { theme: string; locale: string } } };
    expect(init.id).toBe(1);
    expect(init.result.protocolVersion).toBe('2026-01-26');
    expect(init.result.hostContext.theme).toBe('dark');
    expect(init.result.hostContext.locale).toBe('de');
    send(host, f.win, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    host.kvChanged({ a: 1 });
    expect(f.posted.at(-1)).toEqual({ jsonrpc: '2.0', method: 'gui/notifications/kv-changed', params: { kv: { a: 1 } } });
  });

  it('ignores messages from other windows', async () => {
    const f = frame();
    const host = new PageHost(() => f.win, doc(), opts());
    send(host, {} as Window, { jsonrpc: '2.0', id: 1, method: 'ping' });
    await settle();
    expect(f.posted).toEqual([]);
  });

  it('asks the user when the server wants confirmation, then calls again confirmed', async () => {
    const f = frame();
    const confirm = vi.fn(async () => true);
    call.mockResolvedValueOnce({ confirm: { message: 'The page wants to run svc.page_delete', tool: 'svc.page_delete', token: 'tok' } }).mockResolvedValueOnce({ content: [], structuredContent: { ok: true } });
    const host = new PageHost(() => f.win, doc(), opts(confirm));
    send(host, f.win, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'call_tool', arguments: { service: 'svc', tool: 'page_delete' } } });
    await settle();
    await settle();
    expect(confirm).toHaveBeenCalledWith('The page wants to run svc.page_delete');
    expect(call.mock.calls[1]).toEqual(['p1', { name: 'call_tool', arguments: { service: 'svc', tool: 'page_delete' }, confirmed: 'tok' }]);
    expect(f.posted[0]).toEqual({ jsonrpc: '2.0', id: 7, result: { content: [], structuredContent: { ok: true } } });
  });

  it('a declined call is an error result, not a call', async () => {
    const f = frame();
    call.mockResolvedValueOnce({ confirm: { message: 'm', tool: 't', token: 'x' } });
    const host = new PageHost(() => f.win, doc(), opts(vi.fn(async () => false)));
    send(host, f.win, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'call_tool', arguments: {} } });
    await settle();
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
    expect((f.posted[0] as { result: { isError: boolean } }).result.isError).toBe(true);
  });

  it('sends backflow with the page version and language; refuses it for views', async () => {
    const f = frame();
    backflow.mockResolvedValue({ response: 1, kv: {} });
    const host = new PageHost(() => f.win, doc(), opts());
    send(host, f.win, { jsonrpc: '2.0', id: 1, method: 'gui/backflow', params: { action: 'bump', value: { by: 1 } } });
    await settle();
    expect(backflow).toHaveBeenCalledWith('p1', { action: 'bump', component: null, value: { by: 1 }, version: '2', lang: 'de', gesture: true });
    const view = new PageHost(() => f.win, doc({ kind: 'mcp_app' }), opts());
    send(view, f.win, { jsonrpc: '2.0', id: 2, method: 'gui/backflow', params: { action: 'x' } });
    await settle();
    expect((f.posted.at(-1) as { error: { code: number } }).error.code).toBe(-32601);
  });

  it('gives a view its tool input and result once it is initialized', () => {
    const f = frame();
    const host = new PageHost(() => f.win, doc({ kind: 'mcp_app', tool: { name: 'show', arguments: { q: 1 }, result: { content: [] }, definition: { name: 'show' } } }), opts());
    send(host, f.win, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    expect(f.posted.map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
    expect(f.posted[0].params).toEqual({ arguments: { q: 1 } });
  });

  it('without a user action a page cannot speak, go full screen or open links unasked', async () => {
    const f = frame();
    const confirm = vi.fn(async () => false);
    const host = new PageHost(() => f.win, doc(), opts(confirm, false));
    send(host, f.win, { jsonrpc: '2.0', id: 1, method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'hi' } } });
    send(host, f.win, { jsonrpc: '2.0', id: 2, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } });
    send(host, f.win, { jsonrpc: '2.0', id: 3, method: 'ui/open-link', params: { url: 'https://evil.example/?d=secret' } });
    await settle();
    await settle();
    const byId = (id: number) => f.posted.find((m) => m.id === id) as { result?: { mode: string }; error?: { message: string } };
    expect(byId(1).error?.message).toMatch(/only right after the user acts/);
    expect(byId(2).result).toEqual({ mode: 'inline' });
    expect(confirm).toHaveBeenCalledWith('open https://evil.example/?d=secret?');
    expect(byId(3).error?.message).toBe('Link opening denied by user');
  });

  it('unknown methods are "method not found"', async () => {
    const f = frame();
    const host = new PageHost(() => f.win, doc(), opts());
    send(host, f.win, { jsonrpc: '2.0', id: 9, method: 'resources/read', params: {} });
    await settle();
    expect((f.posted[0] as { error: { code: number } }).error.code).toBe(-32601);
  });
});

describe('helpers', () => {
  it('maps the chat tokens onto MCP Apps names', () => {
    const vars = styleVariables((n) => ({ '--surface-base': ' #1e1e1e', '--accent': '#a882ff' })[n] ?? '', 'Inter, sans-serif');
    expect(vars['--color-background-primary']).toBe('#1e1e1e');
    expect(vars['--color-accent']).toBe('#a882ff');
    expect(vars['--color-ring-primary']).toBe('#a882ff');
    expect(vars['--font-sans']).toBe('Inter, sans-serif');
    expect(vars['--color-text-primary']).toBeUndefined();
  });

  it('opens only http(s) links', () => {
    expect(linkAllowed('https://plan.ai')).toBe(true);
    expect(linkAllowed('javascript:alert(1)')).toBe(false);
    expect(linkAllowed('data:text/html,x')).toBe(false);
    expect(linkAllowed(3)).toBe(false);
  });
});
