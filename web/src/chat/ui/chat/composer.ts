/**
 * Composer — chat input field, hero header, and auth CTAs.
 */

import { escapeHtml } from '../../utils/html';
import { getOAuthIcon } from '../oauthIcons';
import { SEND_ICON_SVG } from '../icons';

import type { LocaleContent, ChatModeLocale } from '../../content';
import type { ChatState } from '../../app/state';

type AiChat = NonNullable<ChatState['aiChat']>;

// ── Auth CTAs (OAuth sign-in buttons for sales chat) ────────────────────

export const renderAuthCtas = (locale: LocaleContent, chat: ChatState | null): string => {
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

// ── Chat Composer (input field) ─────────────────────────────────────────

export const renderChatComposer = (
  mc: AiChat,
  locale: LocaleContent,
  modeLocale: ChatModeLocale,
): string => {
  const prompt = mc.phase === 'question' ? mc.clientPrompt : undefined;
  const skipLabel = escapeHtml(modeLocale.cancelLabel);

  const aqInput = prompt?.toolName === 'ask_question' ? prompt.input as { type?: string; question?: string } : undefined;
  const isTextQuestion = mc.phase === 'question' && aqInput?.type === 'text';
  const showComposer = mc.phase === 'idle' || mc.phase === 'error' || isTextQuestion;

  const placeholder = escapeHtml(
    isTextQuestion ? (aqInput!.question ?? modeLocale.placeholder) : modeLocale.placeholder,
  );

  return showComposer
    ? `<div class="composer-card" data-form="machine-config-composer">
          <div class="composer-wrapper">
            ${isTextQuestion
              ? `<button
                  type="button"
                  class="composer-skip-button"
                  data-action="mc-question-cancel"
                >${skipLabel}</button>`
              : ''}
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
};

// ── Hero Header ─────────────────────────────────────────────────────────

export const renderHeroHeader = (
  mc: AiChat,
  modeLocale: ChatModeLocale,
): string => {
  const isEmptyState = mc.messages.length === 0;
  return `<div class="space-y-3 text-center md:space-y-4">
        <p class="text-[0.65rem] uppercase tracking-[0.35em] text-(--text-muted) md:text-xs md:tracking-[0.4em]">
          ${escapeHtml(modeLocale.heroBadgeLabel)}
        </p>
        <h1 class="${isEmptyState ? 'text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl' : 'text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl'}">
          ${escapeHtml(modeLocale.heading)}
        </h1>
      </div>`;
};
