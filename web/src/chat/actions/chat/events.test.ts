import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../app/store';
import type { ConversationItem } from './conversationList';
import { beginNewConversation, endNewConversation, routeServerEvent } from './events';

const conv = (id: string, updated_at = '2026-10-01T10:00:00Z'): ConversationItem => ({ id, title: id, created_at: updated_at, updated_at });
const fetchMock = vi.fn();
const listRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/v1/chat').length;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(store.state, {
    isAuthenticated: true,
    userId: 'u1',
    conversations: [conv('a'), conv('b')],
    activeConversationId: 'a',
    chat: { messages: [], phase: 'waiting', approvals: [] },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('routeServerEvent', () => {
  it('applies the open conversation\'s events to the chat', () => {
    routeServerEvent('text_done', { conversation: 'a', content: 'Hello' });
    routeServerEvent('done', { conversation: 'a' });

    expect(store.state.chat?.messages).toEqual([{ role: 'assistant', content: 'Hello' }]);
    expect(store.state.chat?.phase).toBe('idle');
    // Not "news" for the conversation on screen.
    expect(store.state.conversations.find((c) => c.id === 'a')).toMatchObject({ busy: false });
    expect(store.state.conversations.find((c) => c.id === 'a')?.unread).toBeUndefined();
  });

  it('marks another conversation in the sidebar and moves it to the top, leaving the chat alone', () => {
    routeServerEvent('thinking', { conversation: 'b' });
    expect(store.state.conversations.map((c) => c.id)).toEqual(['b', 'a']);
    expect(store.state.conversations[0]).toMatchObject({ busy: true });

    routeServerEvent('text_done', { conversation: 'b', content: 'Not for this chat' });
    routeServerEvent('done', { conversation: 'b' });
    expect(store.state.conversations[0]).toMatchObject({ id: 'b', busy: false, unread: true });
    expect(store.state.chat?.messages).toEqual([]);
    expect(store.state.chat?.phase).toBe('waiting');
  });

  it('refetches the list once for events of unknown conversations', async () => {
    routeServerEvent('thinking', { conversation: 'from-another-tab' });
    routeServerEvent('text_delta', { conversation: 'from-another-tab', content: 'x' });
    expect(listRequests()).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(listRequests()).toBe(1);
  });

  it('holds a new conversation\'s first events until its id is known', async () => {
    store.state.activeConversationId = null;
    beginNewConversation();

    routeServerEvent('thinking', { conversation: 'new' });
    routeServerEvent('text_done', { conversation: 'new', content: 'Hi there' });
    routeServerEvent('thinking', { conversation: 'elsewhere' });
    expect(store.state.chat?.messages).toEqual([]);

    // The send returned: the chat became conversation "new".
    store.state.conversations = [conv('new'), ...store.state.conversations];
    store.state.activeConversationId = 'new';
    endNewConversation('new');

    expect(store.state.chat?.messages).toEqual([{ role: 'assistant', content: 'Hi there' }]);
    // The other held event belongs to a conversation from elsewhere.
    await vi.advanceTimersByTimeAsync(300);
    expect(listRequests()).toBe(1);
  });

  it('drops held events into a refetch when starting the conversation failed', async () => {
    store.state.activeConversationId = null;
    beginNewConversation();
    routeServerEvent('thinking', { conversation: 'x' });
    endNewConversation(null);

    expect(store.state.chat?.phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(300);
    expect(listRequests()).toBe(1);
  });
});
