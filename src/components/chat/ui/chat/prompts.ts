/**
 * Prompts — question UI, preference block, and login invite rendering.
 */

import { escapeHtml } from '../../utils/html';
import { getOAuthIcon } from '../oauthIcons';

import type { LocaleContent, ChatModeLocale } from '../../content';
import type { ChatState } from '../../app/state';

type AiChat = NonNullable<ChatState['aiChat']>;

// ── Question UI (ask_question) ──────────────────────────────────────────

export const renderQuestionUI = (
  mc: AiChat,
  modeLocale: ChatModeLocale,
): { questionLabel: string; questionButtons: string } => {
  const prompt = mc.phase === 'question' ? mc.clientPrompt : undefined;
  const skipLabel = escapeHtml(modeLocale.cancelLabel);

  let questionLabel = '';
  let questionButtons = '';
  if (prompt?.toolName === 'ask_question') {
    const aqInput = prompt.input as { type?: string; question?: string; options?: string[] };
    if (aqInput.question) {
      questionLabel = `<div class="flex justify-start">
          <p class="max-w-[min(100%,640px)] text-sm leading-relaxed text-(--text-muted)">
            ${escapeHtml(aqInput.question)}
          </p>
        </div>`;
    }
    if (aqInput.type === 'multiple_choice' && aqInput.options) {
      questionButtons = `<div class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
            ${aqInput.options
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
            <button type="button" class="chat-cta-button chat-cta-button--cancel" data-action="mc-question-cancel">
              ${skipLabel}
            </button>
          </div>`;
    }
  }
  return { questionLabel, questionButtons };
};

// ── Preference Block (prompt_preference) ────────────────────────────────

export const renderPreferenceBlock = (
  mc: AiChat,
  locale: LocaleContent,
): string => {
  const prompt = mc.phase === 'question' ? mc.clientPrompt : undefined;
  let preferenceBlock = '';
  if (prompt?.toolName === 'prompt_preference' && prompt.preference) {
    const pref = prompt.preference;
    const streamingIndicatorPref = pref.subPhase === 'streaming_question'
      ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
      : '';
    preferenceBlock += `<div class="flex justify-start">
        <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
          ${escapeHtml(pref.visibleQuestionText)}${streamingIndicatorPref}
        </p>
      </div>`;

    if (pref.subPhase === 'awaiting_choice' || pref.subPhase === 'persisting' || pref.subPhase === 'streaming_followup' || pref.subPhase === 'done') {
      const prefId = prompt.input.preference_id as string;
      const prefLocale = locale.preferencePrompts[prefId];
      const isLocked = pref.ctaLocked ?? false;
      preferenceBlock += `<div class="flex flex-wrap gap-3 text-sm text-(--text-primary)">
          <button
            type="button"
            class="chat-cta-button ${isLocked ? 'is-disabled' : ''} ${pref.choice === 'yes' ? 'is-selected' : ''}"
            data-action="preference-choice"
            data-choice="yes"
            ${isLocked ? 'disabled' : ''}
            aria-disabled="${isLocked}"
            aria-pressed="${pref.choice === 'yes'}"
          >
            ${escapeHtml(prefLocale?.ctaYesLabel ?? 'Yes')}
          </button>
          <button
            type="button"
            class="chat-cta-button ${isLocked ? 'is-disabled' : ''} ${pref.choice === 'no' ? 'is-selected' : ''}"
            data-action="preference-choice"
            data-choice="no"
            ${isLocked ? 'disabled' : ''}
            aria-disabled="${isLocked}"
            aria-pressed="${pref.choice === 'no'}"
          >
            ${escapeHtml(prefLocale?.ctaNoLabel ?? 'No')}
          </button>
        </div>`;
    }

    // Response bubble (user's choice)
    if (pref.choice) {
      const prefId = prompt.input.preference_id as string;
      const prefLocale = locale.preferencePrompts[prefId];
      const choiceLabel = pref.choice === 'yes' ? prefLocale?.ctaYesLabel : prefLocale?.ctaNoLabel;
      if (choiceLabel) {
        preferenceBlock += `<div class="flex justify-end">
            <p class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">
              ${escapeHtml(choiceLabel)}
            </p>
          </div>`;
      }
    }

    // Follow-up streaming text
    if (pref.visibleFollowupText) {
      const followupStreamIndicator = pref.subPhase === 'streaming_followup'
        ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
        : '';
      preferenceBlock += `<div class="flex justify-start">
          <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
            ${escapeHtml(pref.visibleFollowupText)}${followupStreamIndicator}
          </p>
        </div>`;
    }
  }
  return preferenceBlock;
};

// ── Login Invite (anonymous user sign-in) ───────────────────────────────

export const renderLoginInvite = (
  mc: AiChat,
  locale: LocaleContent,
): string => {
  let loginInviteBlock = '';
  if (mc.phase === 'login' && mc.loginInvite) {
    const invite = mc.loginInvite;
    const inviteStreamIndicator = invite.isStreaming
      ? '<span class="ml-1 inline-block h-4 w-1.5 rounded-full bg-(--text-muted) animate-pulse"></span>'
      : '';
    loginInviteBlock += `<div class="flex justify-start">
        <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
          ${escapeHtml(invite.visibleText)}${inviteStreamIndicator}
        </p>
      </div>`;

    if (invite.ctaVisible) {
      const providers = locale.navigation.loginMenu.providers;
      const isLocked = Boolean(invite.ctaLocked);
      const buttons = Object.entries(providers)
        .map(([provider, label]) => {
          const icon = getOAuthIcon(provider);
          return `
              <button
                type="button"
                class="chat-cta-button ${isLocked ? 'is-disabled' : ''} ${invite.selectedProvider === provider ? 'is-selected' : ''}"
                data-action="login-invite-oauth"
                data-provider="${provider}"
                ${isLocked ? 'disabled' : ''}
                aria-disabled="${isLocked}"
                aria-pressed="${invite.selectedProvider === provider}"
              >
                <span class="chat-cta-button__icon" aria-hidden="true">
                  ${icon}
                </span>
                ${escapeHtml(label)}
              </button>
            `;
        })
        .join('');
      loginInviteBlock += `
          <div class="chat-cta-stack flex flex-wrap gap-3 text-sm text-(--text-primary) transition-all duration-300 chat-cta-stack--fade">
            ${buttons}
          </div>
        `;
    }
  }
  return loginInviteBlock;
};
