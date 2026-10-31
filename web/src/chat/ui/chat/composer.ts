/**
 * Composer — chat input field and hero header.
 */

import { escapeHtml } from '../../utils/html';
import { SEND_ICON_SVG } from '../icons';

import type { LocaleContent } from '../../content';
import type { ChatSession } from '../../app/state';

// ── Chat Composer (input field) ─────────────────────────────────────────

export const renderChatComposer = (
  mc: ChatSession,
  locale: LocaleContent,
): string => {
  const prompt = mc.phase === 'question' ? mc.clientPrompt : undefined;
  const skipLabel = escapeHtml(locale.chat.skipLabel);

  const aqInput = prompt?.toolName === 'ask_question' ? prompt.input as { type?: string; question?: string } : undefined;
  const isTextQuestion = mc.phase === 'question' && aqInput?.type === 'text';
  const showComposer = mc.phase === 'idle' || mc.phase === 'error' || isTextQuestion;

  const placeholder = escapeHtml(
    isTextQuestion ? (aqInput!.question ?? locale.chat.placeholder) : locale.chat.placeholder,
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

/** A new chat's heading (a conversation shows its title in the sidebar). */
export const renderHeroHeader = (mc: ChatSession, locale: LocaleContent): string =>
  mc.messages.length === 0
    ? `<div class="text-center">
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
          ${escapeHtml(locale.chat.heading)}
        </h1>
      </div>`
    : '';
