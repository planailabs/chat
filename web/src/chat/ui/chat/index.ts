/**
 * Chat Section Component
 *
 * The conversation on screen. Empty (a new chat), it is the hero: the
 * heading above the composer.
 */

import type { LocaleContent } from '../../content';
import type { AppState } from '../../app/state';

import { renderMessageBubbles } from './bubbles';
import { renderStreamingBubble, renderThinkingIndicator, renderToolIndicator, renderErrorMessage } from './indicators';
import { renderQuestionUI, renderPreferenceBlock, renderLoginInvite } from './prompts';
import { renderApprovalCards } from './approvals';
import { renderChatComposer, renderHeroHeader } from './composer';

export const renderChatSection = (locale: LocaleContent, state: AppState): string => {
  const mc = state.chat;
  if (!mc) {
    return '';
  }
  const { questionLabel, questionButtons } = renderQuestionUI(mc, locale);

  const sectionClasses =
    mc.messages.length === 0
      ? 'flex w-full max-w-3xl flex-col gap-4 text-center md:gap-6'
      : 'flex w-full max-w-3xl flex-col gap-8 text-left';

  return `
    <section class="${sectionClasses}">
      ${renderHeroHeader(mc, locale)}
      ${renderMessageBubbles(mc, locale)}
      ${renderStreamingBubble(mc)}
      ${renderThinkingIndicator(mc)}
      ${renderToolIndicator(mc, locale)}
      ${renderErrorMessage(mc)}
      ${questionLabel}
      ${questionButtons}
      ${renderPreferenceBlock(mc, locale)}
      ${renderApprovalCards(mc, locale)}
      ${renderLoginInvite(mc, locale)}
      ${renderChatComposer(mc, locale)}
    </section>
  `;
};
