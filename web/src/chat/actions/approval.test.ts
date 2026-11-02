import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// theme.ts reads the colour scheme when it loads; jsdom has no matchMedia.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

import { startSession } from './auth';
import { store } from '../app/store';

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const profile = (approved: boolean) => ({
  user_id: 'u1',
  email: 'new@example.org',
  name: 'New',
  is_admin: false,
  language: 'en',
  theme: 'system',
  newsletter_opt_in: false,
  deletion_requested_at: null,
  approved,
  impersonating: false,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  store.state.awaitingApproval = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an account waiting for approval', () => {
  it('is shown as waiting and loads nothing else', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, profile(false)));

    await startSession();

    expect(store.state.awaitingApproval).toBe(true);
    expect(store.state.isAuthenticated).toBe(true);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(['/api/v1/profile/me']);
  });

  it('is not waiting once approved', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      jsonResponse(200, String(url) === '/api/v1/profile/me' ? profile(true) : []),
    );
    vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });

    await startSession();

    expect(store.state.awaitingApproval).toBe(false);
  });
});
