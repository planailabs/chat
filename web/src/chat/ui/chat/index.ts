/**
 * Chat Section Component
 *
 * Renders the chat conversation view with:
 * - User message bubble
 * - Assistant response (with streaming indicator)
 * - OAuth CTAs for sign-in
 * - Newsletter prompt and response flow
 */

import type { LocaleContent } from '../../content';
import type { AppState } from '../../app/state';
import { escapeHtml } from '../../utils/html';

import { renderMessageBubbles } from './bubbles';
import { renderStreamingBubble, renderThinkingIndicator, renderToolIndicator, renderErrorMessage } from './indicators';
import { renderQuestionUI, renderPreferenceBlock, renderLoginInvite } from './prompts';
import { renderAuthCtas, renderChatComposer, renderHeroHeader } from './composer';

export const renderChatSection = (
  locale: LocaleContent,
  state: AppState,
): string => {
  if (state.heroPhase !== 'chat' || !state.chat) {
    return '';
  }
  const { userPrompt, assistantVisibleText, isStreaming } = state.chat;
  const userBubbleClasses = [
    'bubble-animate',
    'max-w-[min(100%,640px)]',
    'rounded-3xl',
    'bg-(--surface-elevated)',
    'px-5',
    'py-3',
    'text-base',
    'text-(--text-primary)',
  ];
  if (state.chat.userBubbleJustAppeared) {
    userBubbleClasses.push('just-entered');
  }
  const assistantBubbleClasses = [
    'bubble-animate',
    'max-w-[min(100%,640px)]',
    'text-base',
    'leading-relaxed',
    'text-(--text-primary)',
  ];
  if (state.chat.assistantBubbleJustAppeared) {
    assistantBubbleClasses.push('just-entered');
  }
  const streamingIndicator = isStreaming
    ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
    : '';
  const postLogin = state.chat.postLogin;
  const newsletterState = postLogin?.newsletter;
  const signedInBubbleClasses = [
    'max-w-[min(100%,640px)]',
    'rounded-3xl',
    'bg-(--surface-elevated)',
    'px-5',
    'py-3',
    'text-base',
    'text-(--text-primary)',
    'bubble-animate',
  ];
  if (postLogin?.signedInBubbleJustAppeared) {
    signedInBubbleClasses.push('just-entered');
  }
  const signedInBubble =
    postLogin?.signedInBubbleVisible && state.userEmail
      ? `
      <div class="flex justify-end">
        <p class="${signedInBubbleClasses.join(' ')}">
          ${escapeHtml(
            locale.chat.signedInWith.replace('{{email}}', state.userEmail),
          )}
        </p>
      </div>
    `
      : '';
  const followupIndicator =
    newsletterState?.isStreaming && newsletterState.visibleText.length > 0
      ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
      : '';
  const newsletterQuestion = newsletterState
    ? `
      <div class="flex justify-start">
        <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
          ${escapeHtml(newsletterState.visibleText)}${followupIndicator}
        </p>
      </div>
    `
    : '';
  const newsletterCtas = newsletterState?.ctaVisible
    ? `
      <div class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
        <button
          type="button"
          class="chat-cta-button ${newsletterState.ctaLocked ? 'is-disabled' : ''} ${
            newsletterState.response === 'yes' ? 'is-selected' : ''
          }"
          data-action="newsletter-choice"
          data-choice="yes"
          ${newsletterState.ctaLocked ? 'disabled' : ''}
          aria-disabled="${Boolean(newsletterState.ctaLocked)}"
          aria-pressed="${newsletterState.response === 'yes'}"
        >
          ${escapeHtml(locale.newsletter.ctaYesLabel)}
        </button>
        <button
          type="button"
          class="chat-cta-button ${newsletterState.ctaLocked ? 'is-disabled' : ''} ${
            newsletterState.response === 'no' ? 'is-selected' : ''
          }"
          data-action="newsletter-choice"
          data-choice="no"
          ${newsletterState.ctaLocked ? 'disabled' : ''}
          aria-disabled="${Boolean(newsletterState.ctaLocked)}"
          aria-pressed="${newsletterState.response === 'no'}"
        >
          ${escapeHtml(locale.newsletter.ctaNoLabel)}
        </button>
      </div>
    `
    : '';
  const responseBubble =
    newsletterState?.responseBubble && newsletterState.response
      ? `
      <div class="flex justify-end">
        <p class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">
          ${escapeHtml(newsletterState.responseBubble)}
        </p>
      </div>
    `
      : '';
  const followup = newsletterState?.followup;
  const followupAssistant =
    followup &&
    `
      <div class="flex justify-start">
        <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
          ${escapeHtml(followup.visibleText)}${
            followup.isStreaming
              ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
              : ''
          }
        </p>
      </div>
    `;

  // ─── AI Chat Mode ─────────────────────────────────────────────────────
  const mc = state.chat.aiChat;
  if (mc) {
    const modeLocale = locale.chatModes[state.activeChatMode] ?? locale.chatModes.machine_config;

    const messageBubbles = renderMessageBubbles(mc);
    const streamingBubble = renderStreamingBubble(mc);
    const thinkingIndicator = renderThinkingIndicator(mc);
    const toolIndicator = renderToolIndicator(mc, modeLocale);
    const errorMessage = renderErrorMessage(mc);
    const { questionLabel, questionButtons } = renderQuestionUI(mc, modeLocale);
    const preferenceBlock = renderPreferenceBlock(mc, locale);
    const loginInviteBlock = renderLoginInvite(mc, locale);
    const inputField = renderChatComposer(mc, locale, modeLocale);
    const heroHeader = renderHeroHeader(mc, modeLocale);

    const isEmptyState = mc.messages.length === 0;
    const sectionClasses = isEmptyState
      ? 'flex w-full max-w-3xl flex-col gap-4 text-center md:gap-6'
      : 'flex w-full max-w-3xl flex-col gap-8 text-left';

    return `
      <section class="${sectionClasses}">
        ${heroHeader}
        ${messageBubbles}
        ${streamingBubble}
        ${thinkingIndicator}
        ${toolIndicator}
        ${errorMessage}
        ${questionLabel}
        ${questionButtons}
        ${preferenceBlock}
        ${loginInviteBlock}
        ${inputField}
      </section>
    `;
  }

  return `
    <section class="flex w-full max-w-3xl flex-col gap-8 text-left">
      <div class="flex justify-end">
        <p class="${userBubbleClasses.join(' ')}">
          ${escapeHtml(userPrompt)}
        </p>
      </div>
      <div class="flex justify-start">
        <p class="${assistantBubbleClasses.join(' ')}">
          ${escapeHtml(assistantVisibleText)}${streamingIndicator}
        </p>
      </div>
      ${renderAuthCtas(locale, state.chat)}
      ${signedInBubble}
      ${newsletterQuestion}
      ${newsletterCtas}
      ${responseBubble}
      ${followupAssistant ?? ''}
    </section>
  `;
};
