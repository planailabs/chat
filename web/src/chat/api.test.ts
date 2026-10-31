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

    const error = await api.chat.list().catch((e: unknown) => e);
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

  it('lists conversations and reads one by id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, []));

    await api.chat.list();
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat', init: { method: 'GET' } });

    await api.chat.history('c1');
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/history', init: { method: 'POST' }, body: { id: 'c1' } });
  });

  it('starts a new conversation when sending without an id', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { id: 'new-1' }));

    await expect(api.chat.send(null, 'Hello', 'de')).resolves.toEqual({ id: 'new-1' });
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/send', init: { method: 'POST' } });
    expect(lastCall().body).toEqual({ text: 'Hello', lang: 'de' });

    await api.chat.send('c1', 'More', 'en');
    expect(lastCall().body).toEqual({ id: 'c1', text: 'More', lang: 'en' });
  });

  it('maps the hourly limit to a 402 error with the server message', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(402, { error: 'insufficient_quota', message: 'limit reached' }));

    await expect(api.chat.send('c1', 'Hi', 'en')).rejects.toMatchObject({ status: 402, message: 'limit reached' });
  });

  it('omits the answer content when a question is dismissed', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.answer('c1', 'call-1', 'Option A');
    expect(lastCall().body).toEqual({ id: 'c1', call_id: 'call-1', content: 'Option A' });

    await api.chat.answer('c1', 'call-2');
    expect(lastCall().body).toEqual({ id: 'c1', call_id: 'call-2' });
  });

  it('approves tool calls, optionally for the whole conversation', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.approve('c1', 'call-3', true, { all: true });
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/approve', body: { id: 'c1', call_id: 'call-3', approved: true, all: true } });

    await api.chat.approve('c1', 'call-4', false);
    expect(lastCall().body).toEqual({ id: 'c1', call_id: 'call-4', approved: false });
  });

  it('renames and removes conversations', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.chat.rename('c1', 'Fleet setup');
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/rename', init: { method: 'POST' }, body: { id: 'c1', title: 'Fleet setup' } });

    await api.chat.remove('c1');
    expect(lastCall()).toMatchObject({ url: '/api/v1/chat/remove', init: { method: 'POST' }, body: { id: 'c1' } });
  });

  it('has one event stream URL for all conversations, without credentials in it', () => {
    expect(api.chat.eventsUrl).toBe('/api/v1/chat/events');
  });

  it('passes admin filters as query parameters', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, []));

    await api.admin.users('ann@example.com');
    expect(lastCall().url).toBe('/api/v1/user?q=ann%40example.com');

    await api.admin.messages(200);
    expect(lastCall().url).toBe('/api/v1/message?limit=200');

    await api.admin.staffPings(true);
    expect(lastCall().url).toBe('/api/v1/staff_ping?include_resolved=true');

    await api.admin.promptExtension('u1');
    expect(lastCall().url).toBe('/api/v1/prompt_extension?user_id=u1');
  });

  it('sets and removes a user\'s prompt extension', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { ok: true }));

    await api.admin.setPromptExtension('u1', 'Be brief.');
    expect(lastCall()).toMatchObject({ url: '/api/v1/prompt_extension/set', init: { method: 'POST' }, body: { user_id: 'u1', content: 'Be brief.' } });

    await api.admin.removePromptExtension('u1');
    expect(lastCall()).toMatchObject({ url: '/api/v1/prompt_extension/remove', init: { method: 'POST' }, body: { user_id: 'u1' } });
  });
});
