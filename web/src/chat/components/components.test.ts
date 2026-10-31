import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { store } from '../app/store';
import { APPLICATIONS } from '../content/applications';
import type { ConversationItem } from '../actions/chat/conversationList';

const actions = vi.hoisted(() => ({
  answerChatQuestion: vi.fn(),
  cancelChatQuestion: vi.fn(),
  sendChatMessage: vi.fn(),
  renameConversation: vi.fn(),
  openConversation: vi.fn(),
  deleteConversation: vi.fn(),
}));

vi.mock('../actions/chat', async (importOriginal) => ({ ...(await importOriginal<object>()), ...actions }));

import AppSidebar from './AppSidebar.vue';
import ChatMessages from './chat/ChatMessages.vue';
import QuestionPrompt from './chat/QuestionPrompt.vue';
import ChatComposer from './chat/ChatComposer.vue';

const now = new Date().toISOString();
const conv = (id: string, extra: Partial<ConversationItem> = {}): ConversationItem => ({ id, title: `Title ${id}`, created_at: now, updated_at: now, ...extra });

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset());
  Object.assign(store.state, {
    isAuthenticated: true,
    impersonating: false,
    localeKey: 'en',
    conversations: [conv('a'), conv('b', { unread: true }), conv('c', { busy: true })],
    activeConversationId: 'a',
    renamingConversationId: null,
  });
});

afterEach(() => vi.useRealTimers());

describe('AppSidebar', () => {
  it('lists the conversations, highlights the open one and marks the others with news', () => {
    const w = mount(AppSidebar);
    const items = w.findAll('.sidebar-item');
    expect(items.map((i) => i.find('.sidebar-item__title').text())).toEqual(['Title a', 'Title b', 'Title c']);
    expect(items[0].classes()).toContain('is-active');
    expect(items[0].find('.sidebar-dot').exists()).toBe(false);
    expect(items[1].find('.sidebar-dot').exists()).toBe(true);
    expect(items[2].find('.sidebar-dot').classes()).toContain('is-busy');
    expect(w.find('.sidebar-heading').text()).toBe('Today');
  });

  it('shows the applications from the one list', () => {
    const w = mount(AppSidebar);
    const links = w.findAll('.sidebar-app');
    expect(links.map((l) => l.attributes('href'))).toEqual(APPLICATIONS.map((a) => a.url));
    expect(links[0].attributes('target')).toBe('_blank');
  });

  it('is empty when signed out', () => {
    store.state.isAuthenticated = false;
    const w = mount(AppSidebar);
    expect(w.find('.sidebar-panel').exists()).toBe(false);
    expect(w.classes()).toContain('is-hidden');
  });

  it('keeps what is typed in a rename while the list changes, and saves on Enter', async () => {
    const w = mount(AppSidebar, { attachTo: document.body });
    store.state.renamingConversationId = 'b';
    await nextTick();
    await nextTick();
    const input = w.find<HTMLInputElement>('.sidebar-rename-input');
    expect(input.element.value).toBe('Title b');
    await input.setValue('New name');

    // Another conversation's activity re-renders the list.
    store.state.conversations[2].busy = false;
    store.state.conversations.unshift(conv('d'));
    await nextTick();
    expect(w.find<HTMLInputElement>('.sidebar-rename-input').element.value).toBe('New name');

    await w.find('.sidebar-rename-input').trigger('keydown', { key: 'Enter' });
    expect(actions.renameConversation).toHaveBeenCalledWith('b', 'New name');
    w.unmount();
  });

  it('opens a conversation through the actions (plain clicks only)', async () => {
    const w = mount(AppSidebar);
    const link = w.findAll('.sidebar-item__link')[1];
    await link.trigger('click', { button: 0 });
    expect(actions.openConversation).toHaveBeenCalledWith('b', 'push');
    actions.openConversation.mockReset();
    link.element.addEventListener('click', (e) => e.preventDefault()); // jsdom can't navigate
    await link.trigger('click', { button: 0, ctrlKey: true });
    expect(actions.openConversation).not.toHaveBeenCalled();
  });
});

describe('ChatMessages', () => {
  it('escapes user text and sanitizes the assistant\'s markdown', () => {
    const w = mount(ChatMessages, {
      props: {
        messages: [
          { role: 'user', content: '<b>not bold</b>' },
          { role: 'assistant', content: '**bold**<script>alert(1)</script><img src="x" onerror="alert(2)">' },
        ],
      },
    });
    expect(w.html()).toContain('&lt;b&gt;not bold&lt;/b&gt;');
    const assistant = w.find('.chat-markdown');
    expect(assistant.html()).toContain('<strong>bold</strong>');
    expect(assistant.html()).not.toContain('<script');
    expect(assistant.html()).not.toContain('onerror');
  });
});

describe('QuestionPrompt', () => {
  const prompt = { callId: 'q1', toolName: 'ask_question', input: { type: 'multiple_choice', question: 'Which one?', options: ['A', 'B'] } };

  it('marks the choice, disables the options, then answers', async () => {
    vi.useFakeTimers();
    const w = mount(QuestionPrompt, { props: { prompt } });
    expect(w.text()).toContain('Which one?');
    const [a, b, skip] = w.findAll('button');
    await b.trigger('click');
    expect(b.classes()).toContain('is-selected');
    expect(a.attributes('disabled')).toBeDefined();
    expect(skip.attributes('disabled')).toBeDefined();
    expect(actions.answerChatQuestion).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(actions.answerChatQuestion).toHaveBeenCalledWith('B');
  });

  it('skips', async () => {
    const w = mount(QuestionPrompt, { props: { prompt } });
    await w.findAll('button')[2].trigger('click');
    expect(actions.cancelChatQuestion).toHaveBeenCalled();
  });
});

describe('ChatComposer', () => {
  it('sends on Enter (not Shift+Enter) and clears the input', async () => {
    const w = mount(ChatComposer, { props: { chat: { messages: [], phase: 'idle', approvals: [] } } });
    const input = w.find('.composer-input');
    input.element.textContent = '  hello  ';
    await input.trigger('input');
    expect(w.find('.composer-send-button').attributes('disabled')).toBeUndefined();

    await input.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(actions.sendChatMessage).not.toHaveBeenCalled();

    await input.trigger('keydown', { key: 'Enter' });
    expect(actions.sendChatMessage).toHaveBeenCalledWith('hello');
    expect(input.element.textContent).toBe('');
    expect(w.find('.composer-send-button').attributes('disabled')).toBeDefined();
  });

  it('is hidden while the assistant works and shows Skip for text questions', () => {
    expect(mount(ChatComposer, { props: { chat: { messages: [], phase: 'waiting', approvals: [] } } }).find('.composer-card').exists()).toBe(false);
    const w = mount(ChatComposer, {
      props: {
        chat: { messages: [], phase: 'question', approvals: [], clientPrompt: { callId: 'q', toolName: 'ask_question', input: { type: 'text', question: 'Your name?' } } },
      },
    });
    expect(w.find('.composer-skip-button').exists()).toBe(true);
    expect(w.find('.composer-input').attributes('aria-label')).toBe('Your name?');
  });
});
