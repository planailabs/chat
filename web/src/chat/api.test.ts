import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, isUnauthorized } from './api';

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: init.body === undefined ? undefined : JSON.parse(init.body as string) };
};

describe('api', () => {
  it('reads the profile with the session cookie', async () => {
    const profile = { user_id: 'u1', email: 'a@b.c', name: 'A', is_admin: false, language: 'de', theme: 'dark', newsletter_opt_in: true, deletion_requested_at: null, impersonating: false };
    fetchMock.mockImplementation(async () => jsonResponse(200, profile));

    await expect(api.profile.me()).resolves.toEqual(profile);
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/v1/profile/me');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(body).toBeUndefined();
  });

  it('turns a 401 into an ApiError recognised as signed out', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: 'unauthorized', message: 'sign in first' }));

    const error = await api.profile.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized', message: 'sign in first' });
    expect(isUnauthorized(error)).toBe(true);
  });

  it('keeps the status of errors without a JSON body', async () => {
    fetchMock.mockImplementation(async () => new Response('bad gateway', { status: 502 }));

    const error = await api.chat.modes().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'http_error' });
    expect(isUnauthorized(error)).toBe(false);
  });

  it('patches profile settings with the newsletter source', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));

    await api.profile.update({ newsletter_opt_in: true, newsletter_source: 'chat_flow' });
    const { url, init, body } = lastCall();
    expect(url).toBe('/api/v1/profile/me');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(body).toEqual({ newsletter_opt_in: true, newsletter_source: 'chat_flow' });
  });

  it('sends chat messages with mode and language', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.send('sales', 'Hello', 'de');
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/send', init: { method: 'POST' }, body: { mode: 'sales', text: 'Hello', lang: 'de' } });
  });

  it('maps the hourly limit to a 402 error with the server message', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(402, { error: 'insufficient_quota', message: 'limit reached' }));

    await expect(api.chat.send('sales', 'Hi', 'en')).rejects.toMatchObject({ status: 402, message: 'limit reached' });
  });

  it('omits the answer content when a question is dismissed', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.answer('machine_config', 'call-1', 'Option A');
    expect(lastCall().body).toEqual({ mode: 'machine_config', call_id: 'call-1', content: 'Option A' });

    await api.chat.answer('machine_config', 'call-2');
    expect(lastCall().body).toEqual({ mode: 'machine_config', call_id: 'call-2' });
  });

  it('approves tool calls, optionally for the whole conversation', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.approve('machine_config', 'call-3', true, { all: true });
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/approve', body: { mode: 'machine_config', call_id: 'call-3', approved: true, all: true } });

    await api.chat.approve('machine_config', 'call-4', false);
    expect(lastCall().body).toEqual({ mode: 'machine_config', call_id: 'call-4', approved: false });
  });

  it('builds the event stream URL without credentials in it', () => {
    expect(api.chat.eventsUrl('machine_config')).toBe('/api/v1/chat/events?mode=machine_config');
  });

  it('passes admin filters as query parameters', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, []));

    await api.admin.users('ann@example.com');
    expect(lastCall().url).toBe('/api/v1/user?q=ann%40example.com');

    await api.admin.messages(200);
    expect(lastCall().url).toBe('/api/v1/message?limit=200');

    await api.admin.staffPings(true);
    expect(lastCall().url).toBe('/api/v1/staff_ping?include_resolved=true');

    await api.admin.promptExtensions('u1');
    expect(lastCall().url).toBe('/api/v1/prompt_extension?user_id=u1');

    await api.admin.promptExtensions('u1', 'sales');
    expect(lastCall().url).toBe('/api/v1/prompt_extension?user_id=u1&mode=sales');
  });

  it('writes and removes prompt extensions', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.admin.setPromptExtension('u1', 'sales', 'Be brief.');
    expect(lastCall()).toMatchObject({ url: '/api/v1/prompt_extension/x', init: { method: 'PATCH' }, body: { user_id: 'u1', mode: 'sales', content: 'Be brief.' } });

    await api.admin.removePromptExtension('u1', 'sales');
    expect(lastCall()).toMatchObject({ url: '/api/v1/prompt_extension/remove', init: { method: 'POST' }, body: { user_id: 'u1', mode: 'sales' } });
  });
});
