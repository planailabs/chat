/**
 * Hero Section Component
 *
 * Renders the main hero section with:
 * - Heading and subheading
 * - Composer input (contenteditable)
 * - Character limit indicator
 *
 * The composer uses a contenteditable div instead of textarea
 * to avoid iOS Safari's input accessory bar.
 */

import type { LocaleContent } from '../../content';
import { escapeHtml } from '../../utils/html';
import type { AppState } from '../../app/state';
import { COMPOSER } from '../../constants';
import { SEND_ICON_SVG } from '../icons';

import { SUPPORTS_PLAINTEXT_ONLY } from './composerController';

export { attachComposerInteractions } from './composerController';
export type { PromptSubmitHandler } from './composerController';

// ─────────────────────────────────────────────────────────────────────────────
// Hero Section Component
// ─────────────────────────────────────────────────────────────────────────────

export const renderHeroSection = (
  locale: LocaleContent,
  state: AppState,
): string => {
  // Don't render hero when in chat mode
  if (state.heroPhase === 'chat') {
    return '';
  }

  // Override labels for AI chat modes
  const isAIChatMode = state.isAuthenticated && (
    state.activeChatMode === 'sales' ||
    (state.activeChatMode === 'machine_config' && Boolean(state.customerToken))
  );
  const modeLocale = isAIChatMode ? locale.chatModes[state.activeChatMode] : null;
  const badgeLabel = modeLocale ? modeLocale.heroBadgeLabel : locale.heroBadgeLabel;
  const heading = modeLocale ? modeLocale.heading : locale.composer.heading;
  const placeholder = modeLocale ? modeLocale.placeholder : locale.composer.placeholder;

  const maxChars =
    typeof locale.composer.maxCharacters === 'number'
      ? locale.composer.maxCharacters
      : COMPOSER.MAX_CHARS;

  const placeholderEscaped = escapeHtml(placeholder);

  // Use plaintext-only if supported, otherwise fall back to true
  // (we'll enforce plain text via JS for browsers without support)
  const contenteditableValue = SUPPORTS_PLAINTEXT_ONLY
    ? 'plaintext-only'
    : 'true';

  // Using contenteditable div instead of textarea to avoid iOS Safari's
  // input accessory bar (the toolbar above keyboard with arrows and Done button)
  return `<section class="flex w-full max-w-3xl flex-col gap-4 text-center md:gap-6" data-hero>
    <div class="space-y-3 md:space-y-4">
      <p class="text-[0.65rem] uppercase tracking-[0.35em] text-(--text-muted) md:text-xs md:tracking-[0.4em]">
        ${escapeHtml(badgeLabel)}
      </p>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
        ${escapeHtml(heading)}
      </h1>
    </div>

    <div
      class="composer-card"
      data-form="composer"
      data-max-chars="${maxChars}"
      data-max-height="${COMPOSER.MAX_HEIGHT}"
      data-placeholder="${placeholderEscaped}">
      <div class="composer-wrapper">
        <div
          class="composer-input"
          role="textbox"
          aria-multiline="true"
          contenteditable="${contenteditableValue}"
          aria-label="${placeholderEscaped}"
          inputmode="text"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="sentences"
          data-composer-input></div>
        <button
          type="button"
          class="composer-send-button"
          data-role="composer-submit"
          aria-label="${locale.composer.submitLabel}"
          aria-disabled="true"
          disabled>
          ${SEND_ICON_SVG}
        </button>
      </div>
    </div>

    <p
      id="composer-limit"
      class="composer-limit"
      data-composer-limit
      data-visible="false"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden="true"></p>
  </section>`;
};
