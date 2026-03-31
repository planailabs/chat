import { describe, expect, it, beforeEach } from 'vitest';
import { ctaController } from './ctaController';
import { createInitialState } from '../app/state';
import { locales } from '../content';
import { store } from '../app/store';

const locale = locales.en;

describe('CTA controller', () => {
  beforeEach(() => {
    store.state = createInitialState();
  });

  it('highlights auth provider without locking (to allow back navigation)', () => {
    const state = store.state;
    state.heroPhase = 'chat';
    state.chat = {
      userPrompt: 'hi',
      assistantVisibleText: '',
      assistantFullText: 'assistant',
      stream:
        locale.conversationScenarios.anonymousInvite.steps['invite-intro']
          .stream,
      isStreaming: false,
      ctaVisible: true,
      selectedCta: null,
      isCtaLocked: false,
    } as typeof state.chat;

    ctaController.selectAuthProvider('google');

    expect(state.chat?.selectedCta).toBe('google');
    expect(state.chat?.isCtaLocked).toBe(false);
  });

  it('locks newsletter choice', () => {
    const state = store.state;
    state.heroPhase = 'chat';
    state.userEmail = 'test@example.com';
    state.chat = {
      userPrompt: 'prompt',
      assistantVisibleText: '',
      assistantFullText: 'assistant',
      stream:
        locale.conversationScenarios.anonymousInvite.steps['invite-intro']
          .stream,
      isStreaming: false,
      ctaVisible: false,
      postLogin: {
        signedInBubbleVisible: true,
        newsletter: {
          visibleText: '',
          fullText: '',
          stream:
            locale.conversationScenarios.postLoginNewsletter.steps[
              'newsletter-question'
            ].stream,
          isStreaming: false,
          ctaVisible: true,
        },
      },
    } as typeof state.chat;

    ctaController.handleNewsletterChoice('yes', locale);

    const newsletter = state.chat?.postLogin?.newsletter;
    expect(newsletter?.response).toBe('yes');
    expect(newsletter?.ctaLocked).toBe(true);
    expect(newsletter?.responseBubble).toContain('Yes');
  });
});
