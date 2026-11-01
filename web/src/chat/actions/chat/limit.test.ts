import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { store } from '../../app/store';
import { ApiError } from '../../api';
import { showChatError } from './stateMachine';

const budget = (plan_name: string) => ({ plan_id: plan_name.toLowerCase(), plan_name, hourly_input_tokens: 10, hourly_output_tokens: 10, used_input_tokens: 10, used_output_tokens: 3 });

afterEach(() => vi.unstubAllGlobals());

describe('the hourly limit (402)', () => {
  it('names the plan and reloads its numbers', async () => {
    const fresh = budget('Pro');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user_id: 'u1', budget: fresh }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(store.state, { isAuthenticated: true, localeKey: 'en', budget: budget('Standard'), chat: { messages: [], phase: 'waiting', approvals: [] } });

    showChatError(new ApiError(402, 'insufficient_quota', 'limit'));
    expect(store.state.chat?.error).toBe('You’ve reached the hourly limit of your plan “Standard”. Please try again later.');

    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/profile/me', expect.anything());
    expect(store.state.budget).toEqual(fresh);
    expect(store.state.chat?.error).toContain('“Pro”');
  });

  it('says "your plan" while the plan is unknown', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.assign(store.state, { isAuthenticated: true, localeKey: 'en', budget: null, chat: { messages: [], phase: 'waiting', approvals: [] } });
    showChatError(new ApiError(402, 'insufficient_quota', 'limit'));
    expect(store.state.chat?.error).toBe('You’ve reached the hourly limit of your plan. Please try again later.');
  });
});
