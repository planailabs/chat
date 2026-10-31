/**
 * Chat Bubbles — renders the conversation: user, assistant (markdown),
 * dismissed questions and approval records.
 */

import { escapeHtml } from '../../utils/html';
import { renderMarkdown } from '../../utils/markdown';
import { renderApprovalRecord } from './approvals';

import type { LocaleContent } from '../../content';
import type { ChatSession } from '../../app/state';

export const renderMessageBubbles = (mc: ChatSession, locale: LocaleContent): string =>
  mc.messages
    .map((msg) => {
      switch (msg.role) {
        case 'approval':
          return renderApprovalRecord(msg, locale);
        case 'cancel':
          return `
            <div class="flex justify-end">
              <p class="max-w-[min(100%,640px)] rounded-3xl px-5 py-3 text-sm italic text-(--text-muted)">
                ${escapeHtml(msg.content)}
              </p>
            </div>
          `;
        case 'user':
          return `
            <div class="flex justify-end">
              <p class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">
                ${escapeHtml(msg.content)}
              </p>
            </div>
          `;
        case 'assistant':
          return `
            <div class="flex justify-start">
              <div class="chat-markdown max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
                ${renderMarkdown(msg.content)}
              </div>
            </div>
          `;
      }
    })
    .join('');
