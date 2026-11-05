import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import ErrorBoundary from './ErrorBoundary.vue';
import { store } from '../app/store';
import type { ConversationItem } from '../actions/chat/conversationList';

const actions = vi.hoisted(() => ({
  answerChatQuestion: vi.fn(),
  cancelChatQuestion: vi.fn(),
  sendChatMessage: vi.fn(),
  renameConversation: vi.fn(),
  openConversation: vi.fn(),
  deleteConversation: vi.fn(),
  decideApproval: vi.fn(),
}));

vi.mock('../actions/chat', async (importOriginal) => ({ ...(await importOriginal<object>()), ...actions }));

const openSearchHit = vi.hoisted(() => vi.fn());
vi.mock('../actions/chat/search', async (importOriginal) => ({ ...(await importOriginal<object>()), openSearchHit }));

import AppSidebar from './AppSidebar.vue';
import ChatMessages from './chat/ChatMessages.vue';
import QuestionPrompt from './chat/QuestionPrompt.vue';
import ChatComposer from './chat/ChatComposer.vue';
import PurchaseCard from './chat/PurchaseCard.vue';

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

  it('shows the applications the server lists for this user', () => {
    store.state.profile.apps = [
      { name: 'mac-mgmt', url: 'https://mgmt.plan.ai', icon: 'machine', description: 'm', label: { en: 'Machines', de: 'Maschinen' } },
      { name: 'odd', url: 'https://odd.plan.ai', icon: 'no-such-icon', description: 'o', label: {} },
    ];
    const w = mount(AppSidebar);
    const links = w.findAll('.sidebar-app');
    expect(links.map((l) => l.attributes('href'))).toEqual(['https://mgmt.plan.ai', 'https://odd.plan.ai']);
    expect(links[0].attributes('target')).toBe('_blank');
    expect(links.map((l) => l.find('.sidebar-item__title').text())).toEqual(['Machines', 'odd']);
  });

  it('has no applications section when the user may see none', () => {
    store.state.profile.apps = [];
    expect(mount(AppSidebar).find('.sidebar-apps').exists()).toBe(false);
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

describe('answered questions', () => {
  it('show as one compact "question → answer" line, dismissed ones with Skip', () => {
    const w = mount(ChatMessages, {
      props: {
        messages: [
          { role: 'qa', question: 'Which editor?', answer: 'Zed' },
          { role: 'qa', question: 'Your name?', answer: null },
        ],
      },
    });
    const lines = w.findAll('.chat-qa');
    expect(lines.map((l) => l.text())).toEqual(['Which editor?→Zed', 'Your name?→Skip']);
    expect(w.find('.chat-markdown').exists()).toBe(false);
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

  it('takes an own answer to a multiple-choice question (Skip stays with the options)', async () => {
    const w = mount(ChatComposer, {
      props: {
        chat: { messages: [], phase: 'question', approvals: [], clientPrompt: { callId: 'q', toolName: 'ask_question', input: { type: 'multiple_choice', question: 'A or B?', options: ['A', 'B'] } } },
      },
    });
    const input = w.find('.composer-input');
    expect(input.attributes('aria-label')).toBe('Or type your own answer…');
    expect(w.find('.composer-skip-button').exists()).toBe(false);
    input.element.textContent = 'Neither, C';
    await input.trigger('input');
    await input.trigger('keydown', { key: 'Enter' });
    expect(actions.sendChatMessage).toHaveBeenCalledWith('Neither, C');
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

describe('sidebar search', () => {
  const hits = [
    { conversation: 'b', title: 'Law firm', message_id: null, role: null, snippet: '\uE000Law\uE001 firm', at: now },
    { conversation: 'b', title: 'Law firm', message_id: 7, role: 'assistant', snippet: 'a small \uE000law\uE001 firm <script>alert(1)</script>', at: now },
    { conversation: 'a', title: 'Title a', message_id: 3, role: 'user', snippet: 'my \uE000law\uE001yer', at: now },
  ];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    openSearchHit.mockReset();
    fetchMock = vi.fn(async () => new Response(JSON.stringify(hits), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const type = async (w: ReturnType<typeof mount>, q: string) => {
    await w.find('.sidebar-search__input').setValue(q);
  };

  it('searches after a pause and groups the hits by conversation, matches marked, markup kept as text', async () => {
    const w = mount(AppSidebar);
    await type(w, 'la');
    await type(w, 'law');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ q: 'law' });

    // The conversation list is replaced by the results.
    expect(w.find('.sidebar-group').exists()).toBe(false);
    const groups = w.findAll('.search-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].find('.search-hit--title').html()).toContain('<mark>Law</mark> firm');
    const snippet = groups[0].findAll('.search-hit')[1];
    expect(snippet.find('mark').text()).toBe('law');
    expect(snippet.find('script').exists()).toBe(false);
    expect(snippet.text()).toContain('<script>alert(1)</script>');

    await snippet.trigger('click');
    expect(openSearchHit).toHaveBeenCalledWith('b', 7);
    await groups[1].find('.search-hit--title').trigger('click');
    expect(openSearchHit).toHaveBeenCalledWith('a', null);
  });

  it('says so when nothing matches, and Escape clears the search', async () => {
    fetchMock.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const w = mount(AppSidebar);
    await type(w, 'zzz');
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    expect(w.find('.sidebar-search-results').text()).toBe('No results');

    await w.find('.sidebar-search__input').trigger('keydown', { key: 'Escape' });
    expect(w.find<HTMLInputElement>('.sidebar-search__input').element.value).toBe('');
    expect(w.find('.sidebar-group').exists()).toBe(true);
  });

  it('does not search punctuation', async () => {
    const w = mount(AppSidebar);
    await type(w, '?!');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('focuses the search on Ctrl+K', async () => {
    const w = mount(AppSidebar, { attachTo: document.body });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await flushPromises();
    expect(document.activeElement).toBe(w.find('.sidebar-search__input').element);
    w.unmount();
  });
});

describe('ErrorBoundary', () => {
  it('shows an error line instead of a part that fails to render, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = defineComponent({ render: () => { throw new Error('bad data'); } });
    const w = mount(ErrorBoundary, { props: { resetKey: 'a' }, slots: { default: () => h(Broken) } });
    await nextTick();
    expect(w.find('[role="alert"]').text()).toBe('This part couldn’t be shown. Reload the page to try again.');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('PurchaseCard', () => {
  const approval = {
    callId: 'buy1',
    name: 'connector.call_tool',
    input: {},
    reason: null,
    purchase: {
      tool: 'subscription_create',
      product: 'cloud-pro',
      product_name: 'Cloud Pro',
      organization_name: 'clover-inc',
      price_cents: 4900,
      currency: 'EUR',
      interval: 'month' as const,
      trial_days: 14,
      summary: 'Upgrades clover-inc to Cloud Pro.',
    },
  };

  it('shows what is bought and buys only after the explicit confirmation', async () => {
    store.state.localeKey = 'en';
    const w = mount(PurchaseCard, { props: { approval } });
    expect(w.text()).toContain('Confirm purchase');
    expect(w.text()).toContain('Cloud Pro');
    expect(w.text()).toContain('clover-inc');
    expect(w.text()).toContain('€49.00 / month');
    expect(w.text()).toContain('Free for the first 14 days');
    expect(w.text()).toContain('I understand this costs €49.00 / month and want to buy it.');
    // No "approve all" for purchases.
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Buy', 'Don’t buy']);

    const buy = w.find('.purchase-card__buy');
    expect(buy.attributes('disabled')).toBeDefined();
    await buy.trigger('click');
    expect(actions.decideApproval).not.toHaveBeenCalled();

    await w.find('input[type="checkbox"]').setValue(true);
    expect(buy.attributes('disabled')).toBeUndefined();
    await buy.trigger('click');
    expect(actions.decideApproval).toHaveBeenCalledWith('buy1', 'approve');
  });

  it('can be declined without confirming', async () => {
    const w = mount(PurchaseCard, { props: { approval } });
    await w.findAll('button')[1].trigger('click');
    expect(actions.decideApproval).toHaveBeenCalledWith('buy1', 'deny');
  });
});
