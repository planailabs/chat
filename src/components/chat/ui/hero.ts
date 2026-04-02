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

import type { LocaleContent } from '../content';
import { escapeHtml } from '../utils/html';
import type { AppState } from '../app/state';
import { COMPOSER } from '../constants';
import { SEND_ICON_SVG } from './icons';

// ─────────────────────────────────────────────────────────────────────────────
// Browser Feature Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if browser supports contenteditable="plaintext-only"
 * Firefox only added support in v112 (April 2023)
 */
const supportsPlaintextOnly = (): boolean => {
  if (typeof document === 'undefined') return false;

  const testEl = document.createElement('div');
  testEl.contentEditable = 'plaintext-only';
  // If not supported, browser will coerce to "true" or "inherit"
  return testEl.contentEditable === 'plaintext-only';
};

const SUPPORTS_PLAINTEXT_ONLY = supportsPlaintextOnly();

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

// ─────────────────────────────────────────────────────────────────────────────
// Composer Controller
// ─────────────────────────────────────────────────────────────────────────────

export type PromptSubmitHandler = (value: string) => void;

interface ComposerConfig {
  maxChars: number;
  maxHeight: number;
  placeholder: string;
  limitTemplate: string;
  locale: string;
}

interface ComposerElements {
  container: HTMLElement;
  input: HTMLElement;
  submitButton: HTMLButtonElement;
  limitIndicator: HTMLElement | null;
}

/**
 * ComposerController manages the contenteditable input experience.
 * Uses contenteditable instead of textarea to avoid iOS Safari's input accessory bar.
 * Includes cross-browser compatibility for Firefox, Chrome, Safari, and Edge.
 */
class ComposerController {
  private elements: ComposerElements;
  private config: ComposerConfig;
  private onSubmit: PromptSubmitHandler;
  private numberFormatter: Intl.NumberFormat | null;
  private isComposing = false; // Track IME composition state

  constructor(
    elements: ComposerElements,
    config: ComposerConfig,
    onSubmit: PromptSubmitHandler,
  ) {
    this.elements = elements;
    this.config = config;
    this.onSubmit = onSubmit;
    this.numberFormatter = config.locale
      ? new Intl.NumberFormat(config.locale)
      : null;

    this.bindEvents();
    this.syncUI();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Text Content Helpers (Cross-browser compatible)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get plain text content from the contenteditable.
   * Uses innerText for better line break handling across browsers.
   */
  private getText(): string {
    const { input } = this.elements;
    // innerText respects CSS styling and converts <br> to \n
    // textContent doesn't handle line breaks consistently across browsers
    return input.innerText ?? input.textContent ?? '';
  }

  /**
   * Set plain text content.
   * Clears all HTML and sets pure text.
   */
  private setText(text: string): void {
    const { input } = this.elements;
    // Clear any HTML that might have snuck in
    input.textContent = text;
  }

  /** Check if input has meaningful content */
  private hasContent(): boolean {
    return this.getText().trim().length > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UI State Management
  // ─────────────────────────────────────────────────────────────────────────

  /** Update all UI elements to reflect current state */
  private syncUI(): void {
    this.updateHeight();
    this.updateButtonState();
    this.updateLimitIndicator();
    this.updatePlaceholder();
  }

  /** Toggle placeholder visibility based on content */
  private updatePlaceholder(): void {
    const { input, container } = this.elements;
    const text = this.getText();
    const isEmpty = text.length === 0 || text === '\n';

    // Use data attribute for CSS-based placeholder
    if (isEmpty) {
      input.setAttribute('data-empty', 'true');
      container.setAttribute('data-empty', 'true');
    } else {
      input.removeAttribute('data-empty');
      container.removeAttribute('data-empty');
    }
  }

  /** Update submit button enabled/disabled state */
  private updateButtonState(): void {
    const { submitButton } = this.elements;
    const hasContent = this.hasContent();

    submitButton.disabled = !hasContent;
    submitButton.setAttribute('aria-disabled', String(!hasContent));
  }

  /** Update character limit indicator */
  private updateLimitIndicator(): void {
    const { limitIndicator } = this.elements;
    const { maxChars, limitTemplate } = this.config;

    if (!limitIndicator || !limitTemplate) {
      return;
    }

    const currentLength = this.getText().length;
    const isAtLimit = currentLength >= maxChars;

    if (!isAtLimit) {
      limitIndicator.textContent = '';
      limitIndicator.setAttribute('data-visible', 'false');
      limitIndicator.setAttribute('aria-hidden', 'true');
      return;
    }

    const formattedLimit = this.numberFormatter
      ? this.numberFormatter.format(maxChars)
      : String(maxChars);

    limitIndicator.textContent = limitTemplate.replace(
      '{{max}}',
      formattedLimit,
    );
    limitIndicator.setAttribute('data-visible', 'true');
    limitIndicator.setAttribute('aria-hidden', 'false');
  }

  /** Auto-expand height based on content, with max constraint */
  private updateHeight(): void {
    const { input } = this.elements;
    const { maxHeight } = this.config;

    // Reset height to measure natural content height
    input.style.height = 'auto';

    // Get the scroll height (content height)
    const scrollHeight = input.scrollHeight;
    const constrainedHeight = Math.max(
      COMPOSER.MIN_HEIGHT,
      Math.min(scrollHeight, maxHeight),
    );

    input.style.height = `${constrainedHeight}px`;

    // Toggle overflow based on whether content exceeds max
    const needsScroll = scrollHeight > maxHeight;
    input.classList.toggle('composer-input--scrollable', needsScroll);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Character Limit Enforcement
  // ─────────────────────────────────────────────────────────────────────────

  /** Enforce character limit, truncating if necessary */
  private enforceCharLimit(): void {
    const { maxChars } = this.config;
    const text = this.getText();

    if (text.length > maxChars) {
      // Truncate and restore cursor to end
      this.setText(text.slice(0, maxChars));
      this.moveCursorToEnd();
    }
  }

  /**
   * Move cursor to end of content.
   * Cross-browser compatible with try/catch for edge cases.
   */
  private moveCursorToEnd(): void {
    const { input } = this.elements;

    try {
      const selection = window.getSelection();
      if (!selection) return;

      // Method 1: Modern Range API
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false); // Collapse to end
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Method 2: Fallback - focus the element
      input.focus();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTML Sanitization (for browsers without plaintext-only support)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Strip HTML and keep only plain text.
   * Used for browsers that don't support contenteditable="plaintext-only"
   */
  private sanitizeContent(): void {
    if (SUPPORTS_PLAINTEXT_ONLY) return;

    const { input } = this.elements;
    const text = this.getText();

    // If there's HTML in the content, strip it
    if (input.innerHTML !== input.textContent) {
      const cursorAtEnd = this.isCursorAtEnd();
      this.setText(text);
      if (cursorAtEnd) {
        this.moveCursorToEnd();
      }
    }
  }

  /** Check if cursor is at the end of content */
  private isCursorAtEnd(): boolean {
    try {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return true;

      const range = selection.getRangeAt(0);
      const { input } = this.elements;

      // Create a range that selects from cursor to end
      const testRange = document.createRange();
      testRange.selectNodeContents(input);
      testRange.setStart(range.endContainer, range.endOffset);

      // If the test range is empty, cursor is at end
      return testRange.toString().length === 0;
    } catch {
      return true;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Submit Handling
  // ─────────────────────────────────────────────────────────────────────────

  /** Handle form submission */
  private submit(): void {
    const text = this.getText().trim();

    if (!text) {
      return;
    }

    this.onSubmit(text);
    this.clear();
  }

  /** Clear input and reset state */
  private clear(): void {
    this.setText('');
    this.elements.input.focus();
    this.syncUI();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    const { input, submitButton } = this.elements;

    // Input events
    input.addEventListener('input', this.handleInput);
    input.addEventListener('keydown', this.handleKeydown);
    input.addEventListener('paste', this.handlePaste);
    input.addEventListener('focus', this.handleFocus);
    input.addEventListener('blur', this.handleBlur);

    // IME composition events (for CJK input methods)
    input.addEventListener('compositionstart', this.handleCompositionStart);
    input.addEventListener('compositionend', this.handleCompositionEnd);

    // Submit button
    submitButton.addEventListener('click', this.handleSubmitClick);

    // Prevent drag-and-drop of rich content (cross-browser)
    input.addEventListener('drop', this.handleDrop);
  }

  private handleInput = (): void => {
    // Skip during IME composition
    if (this.isComposing) {
      return;
    }

    // Sanitize HTML for browsers without plaintext-only support
    this.sanitizeContent();
    this.enforceCharLimit();
    this.syncUI();
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    // Skip during IME composition
    if (this.isComposing) {
      return;
    }

    // Enter without Shift = submit
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
      return;
    }

    // Shift+Enter = newline (default behavior, no action needed)
  };

  /**
   * Handle paste events - strip formatting and insert plain text.
   * Cross-browser compatible with multiple fallback methods.
   */
  private handlePaste = (event: ClipboardEvent): void => {
    // Prevent default paste to strip formatting
    event.preventDefault();

    // Get plain text from clipboard
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const text = clipboardData.getData('text/plain') || '';
    if (!text) return;

    // Try modern insertion methods first, then fall back
    this.insertTextAtCursor(text);

    // Sync UI after paste
    this.enforceCharLimit();
    this.syncUI();
  };

  /**
   * Insert plain text at cursor position.
   * Uses multiple methods for cross-browser compatibility.
   */
  private insertTextAtCursor(text: string): void {
    const selection = window.getSelection();

    // Method 1: insertText command (works in most modern browsers)
    // Note: execCommand is deprecated but still widely supported and is the most
    // reliable cross-browser method for inserting text into contenteditable.
    // The Clipboard API (navigator.clipboard) doesn't support insertion at cursor.
    if (document.execCommand('insertText', false, text)) {
      return;
    }

    // Method 2: Range API (fallback for Firefox and older browsers)
    if (selection && selection.rangeCount > 0) {
      try {
        selection.deleteFromDocument();
        const range = selection.getRangeAt(0);
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor to end of inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      } catch {
        // Fall through to Method 3
      }
    }

    // Method 3: Append to content (last resort)
    this.setText(this.getText() + text);
    this.moveCursorToEnd();
  }

  /**
   * Handle drop events - convert to plain text.
   */
  private handleDrop = (event: DragEvent): void => {
    event.preventDefault();

    const text = event.dataTransfer?.getData('text/plain');
    if (text) {
      this.insertTextAtCursor(text);
      this.enforceCharLimit();
      this.syncUI();
    }
  };

  private handleFocus = (): void => {
    this.elements.container.setAttribute('data-focused', 'true');
  };

  private handleBlur = (): void => {
    this.elements.container.removeAttribute('data-focused');
    this.updatePlaceholder();
  };

  private handleCompositionStart = (): void => {
    this.isComposing = true;
  };

  private handleCompositionEnd = (): void => {
    this.isComposing = false;
    // Sync after IME composition completes
    this.sanitizeContent();
    this.enforceCharLimit();
    this.syncUI();
  };

  private handleSubmitClick = (): void => {
    this.submit();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────

  destroy(): void {
    const { input, submitButton } = this.elements;

    input.removeEventListener('input', this.handleInput);
    input.removeEventListener('keydown', this.handleKeydown);
    input.removeEventListener('paste', this.handlePaste);
    input.removeEventListener('focus', this.handleFocus);
    input.removeEventListener('blur', this.handleBlur);
    input.removeEventListener('drop', this.handleDrop);
    input.removeEventListener('compositionstart', this.handleCompositionStart);
    input.removeEventListener('compositionend', this.handleCompositionEnd);
    submitButton.removeEventListener('click', this.handleSubmitClick);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API - Attach Composer Interactions
// ─────────────────────────────────────────────────────────────────────────────

let activeController: ComposerController | null = null;

/**
 * Attaches the composer controller to the DOM.
 * Uses contenteditable to avoid iOS Safari's input accessory bar.
 */
export const attachComposerInteractions = (
  app: HTMLElement | null,
  locale: LocaleContent,
  state: AppState,
  onPromptSubmit: PromptSubmitHandler,
): void => {
  // Skip if already in chat mode
  if (state.heroPhase === 'chat') {
    return;
  }

  // Clean up previous controller
  if (activeController) {
    activeController.destroy();
    activeController = null;
  }

  // Query required elements
  const container = app?.querySelector<HTMLElement>('[data-form="composer"]');
  const input = container?.querySelector<HTMLElement>('[data-composer-input]');
  const submitButton = container?.querySelector<HTMLButtonElement>(
    '[data-role="composer-submit"]',
  );

  if (!container || !input || !submitButton) {
    return;
  }

  const limitIndicator =
    container
      .closest<HTMLElement>('[data-hero]')
      ?.querySelector<HTMLElement>('[data-composer-limit]') ?? null;

  // Read config from data attributes
  const maxChars = Number(container.dataset.maxChars) || COMPOSER.MAX_CHARS;
  const maxHeight = Number(container.dataset.maxHeight) || COMPOSER.MAX_HEIGHT;
  const placeholder = container.dataset.placeholder ?? '';

  const config: ComposerConfig = {
    maxChars,
    maxHeight,
    placeholder,
    limitTemplate: locale.composer.limitReachedLabel ?? '',
    locale: locale.locale,
  };

  const elements: ComposerElements = {
    container,
    input,
    submitButton,
    limitIndicator,
  };

  activeController = new ComposerController(elements, config, onPromptSubmit);
};
