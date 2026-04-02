/**
 * Chat Section Component
 *
 * Renders the chat conversation view with:
 * - User message bubble
 * - Assistant response (with streaming indicator)
 * - OAuth CTAs for sign-in
 * - Newsletter prompt and response flow
 */

import type { LocaleContent } from '../content';
import type { ChatState, AppState } from '../app/state';
import { escapeHtml } from '../utils/html';
import { renderMarkdown } from '../utils/markdown';
import { getOAuthIcon } from './oauthIcons';
import { SEND_ICON_SVG } from './icons';

const renderAuthCtas = (locale: LocaleContent, chat: ChatState | null) => {
  if (
    !chat ||
    !chat.ctaVisible ||
    !chat.cta ||
    chat.cta.type !== 'oauth_providers'
  ) {
    return '';
  }
  const providers = locale.navigation.loginMenu.providers;
  const isLocked = Boolean(chat.isCtaLocked);
  const containerClasses = [
    'chat-cta-stack',
    'flex flex-wrap gap-3 text-sm text-(--text-primary) transition-all duration-300',
  ];
  if (chat.ctaRevealStyle === 'fade') {
    containerClasses.push('chat-cta-stack--fade');
  }
  const buttons = Object.entries(providers)
    .map(([provider, label]) => {
      const icon = getOAuthIcon(provider);
      return `
        <button
          type="button"
          class="chat-cta-button ${isLocked ? 'is-disabled' : ''} ${chat.selectedCta === provider ? 'is-selected' : ''}"
          data-action="chat-oauth"
          data-provider="${provider}"
          ${isLocked ? 'disabled' : ''}
          aria-disabled="${isLocked}"
          aria-pressed="${chat.selectedCta === provider}"
        >
          <span class="chat-cta-button__icon" aria-hidden="true">
            ${icon}
          </span>
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join('');

  return `
    <div class="${containerClasses.join(' ')}">
      ${buttons}
    </div>
  `;
};

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

  // ─── AI Chat Mode ────────────────────────────────────��─────────────────
  const mc = state.chat.aiChat;
  if (mc) {
    const messageBubbles = mc.messages
      .map((msg) => {
        if (msg.role === 'cancel') {
          return `
            <div class="flex justify-end">
              <p class="max-w-[min(100%,640px)] rounded-3xl px-5 py-3 text-sm italic text-(--text-muted)">
                ${escapeHtml(msg.content)}
              </p>
            </div>
          `;
        }
        if (msg.role === 'user') {
          return `
            <div class="flex justify-end">
              <p class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">
                ${escapeHtml(msg.content)}
              </p>
            </div>
          `;
        }
        return `
          <div class="flex justify-start">
            <div class="chat-markdown max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
              ${renderMarkdown(msg.content)}
            </div>
          </div>
        `;
      })
      .join('');

    // ── Phase-based rendering ─────────────────────────────────────────
    const { phase } = mc;

    const streamingBubble = phase === 'streaming' && mc.streamingText
      ? `<div class="flex justify-start">
          <div class="chat-markdown chat-markdown--streaming max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
            ${renderMarkdown(mc.streamingText.visible)}
          </div>
        </div>`
      : '';

    const thinkingIndicator = phase === 'waiting'
      ? `<div class="flex justify-start">
          <div class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-muted)">
            <span class="inline-flex gap-1">
              <span class="inline-block h-2 w-2 rounded-full bg-(--text-muted) animate-bounce" style="animation-delay: 0ms"></span>
              <span class="inline-block h-2 w-2 rounded-full bg-(--text-muted) animate-bounce" style="animation-delay: 150ms"></span>
              <span class="inline-block h-2 w-2 rounded-full bg-(--text-muted) animate-bounce" style="animation-delay: 300ms"></span>
            </span>
          </div>
        </div>`
      : '';

    const modeLocale = locale.chatModes[state.activeChatMode] ?? locale.chatModes.machine_config;
    const hasServerTools = state.activeChatMode === 'machine_config';

    const toolIndicator = phase === 'tool' && hasServerTools
      ? `<div class="flex justify-start">
          <div class="max-w-[min(100%,640px)] flex items-center gap-2 text-xs text-(--text-muted)">
            <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-(--text-muted) border-t-transparent"></span>
            ${escapeHtml(modeLocale.configuringLabel)}
          </div>
        </div>`
      : '';

    const errorMessage = phase === 'error' && mc.error
      ? `<div class="flex justify-start">
          <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-red-500">
            ${escapeHtml(mc.error)}
          </p>
        </div>`
      : '';

    // ── Question UI ───────────────────────────────────────────────────
    const activeQ = phase === 'question' ? mc.activeQuestion : undefined;

    const questionLabel = activeQ
      ? `<div class="flex justify-start">
          <p class="max-w-[min(100%,640px)] text-sm leading-relaxed text-(--text-muted)">
            ${escapeHtml(activeQ.question)}
          </p>
        </div>`
      : '';

    const cancelButton = `<button
              type="button"
              class="chat-cta-button chat-cta-button--cancel"
              data-action="mc-question-cancel"
            >
              ${escapeHtml(modeLocale.cancelLabel)}
            </button>`;

    const questionButtons =
      activeQ?.type === 'multiple_choice' && activeQ.options
        ? `<div class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
            ${activeQ.options
              .map(
                (opt) => `
              <button
                type="button"
                class="chat-cta-button"
                data-action="mc-question-choice"
                data-choice="${escapeHtml(opt)}"
              >
                ${escapeHtml(opt)}
              </button>`,
              )
              .join('')}
            ${cancelButton}
          </div>`
        : '';

    const textQuestionCancel = activeQ?.type === 'text'
      ? `<div class="flex justify-start text-sm">${cancelButton}</div>`
      : '';

    // Show composer in idle, error, or text-type question phases
    const showComposer = phase === 'idle' || phase === 'error'
      || (phase === 'question' && activeQ?.type === 'text');

    const placeholder = escapeHtml(modeLocale.placeholder);
    const inputField = showComposer
      ? `<div class="composer-card" data-form="machine-config-composer">
          <div class="composer-wrapper">
            <div
              class="composer-input"
              role="textbox"
              contenteditable="plaintext-only"
              aria-label="${placeholder}"
              data-empty="true"
              inputmode="text"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="sentences"
              data-action="machine-config-input"></div>
            <button
              type="button"
              class="composer-send-button"
              data-action="machine-config-send"
              aria-label="${escapeHtml(locale.composer.submitLabel)}"
              aria-disabled="true" disabled>
              ${SEND_ICON_SVG}
            </button>
          </div>
        </div>`
      : '';

    // Always show hero header on top of chat
    const isEmptyState = mc.messages.length === 0;
    const heroHeader = `<div class="space-y-3 text-center md:space-y-4">
        <p class="text-[0.65rem] uppercase tracking-[0.35em] text-(--text-muted) md:text-xs md:tracking-[0.4em]">
          ${escapeHtml(modeLocale.heroBadgeLabel)}
        </p>
        <h1 class="${isEmptyState ? 'text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl' : 'text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl'}">
          ${escapeHtml(modeLocale.heading)}
        </h1>
      </div>`;

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
        ${inputField}
        ${textQuestionCancel}
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
