/**
 * Approvals — tool calls the assistant wants to make: cards with Approve /
 * Deny / Approve all while they wait, a compact line once decided.
 */

import { escapeHtml } from '../../utils/html';

import type { LocaleContent } from '../../content';
import type { ApprovalDecision, ChatSession, PendingApproval } from '../../app/state';

/** The call's arguments as text, cut to `max` characters. */
export const formatToolArgs = (input: unknown, max: number, pretty: boolean): string => {
  if (input === null || input === undefined) return '';
  const text = typeof input === 'string' ? input : JSON.stringify(input, null, pretty ? 2 : undefined) ?? '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const renderCard = (a: PendingApproval, locale: LocaleContent): string => {
  const labels = locale.chat.approval;
  const args = formatToolArgs(a.input, 1200, true);
  const callId = escapeHtml(a.callId);
  return `<div class="flex justify-start">
      <div class="flex w-full max-w-[min(100%,640px)] flex-col gap-3 rounded-3xl bg-(--surface-elevated) px-5 py-4 text-(--text-primary)">
        <p class="text-[0.65rem] uppercase tracking-[0.25em] text-(--text-muted)">${escapeHtml(labels.title)}</p>
        <p class="font-mono text-sm font-semibold">${escapeHtml(a.name)}</p>
        ${args ? `<pre class="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-(--text-muted)">${escapeHtml(args)}</pre>` : ''}
        ${a.reason ? `<p class="text-sm leading-relaxed">${escapeHtml(a.reason)}</p>` : ''}
        <div class="flex flex-wrap gap-3 text-sm">
          <button type="button" class="chat-cta-button" data-action="approval-decision" data-call-id="${callId}" data-decision="approve">
            ${escapeHtml(labels.approve)}
          </button>
          <button type="button" class="chat-cta-button chat-cta-button--cancel" data-action="approval-decision" data-call-id="${callId}" data-decision="deny">
            ${escapeHtml(labels.deny)}
          </button>
          <button type="button" class="chat-cta-button" data-action="approval-decision" data-call-id="${callId}" data-decision="approve_all">
            ${escapeHtml(labels.approveAll)}
          </button>
        </div>
      </div>
    </div>`;
};

/** The approval cards while calls wait for the user. */
export const renderApprovalCards = (mc: ChatSession, locale: LocaleContent): string =>
  mc.phase === 'approval' ? mc.approvals.map((a) => renderCard(a, locale)).join('') : '';

/** A decided (or past) approval request in the conversation. */
export const renderApprovalRecord = (
  a: PendingApproval & { decision: ApprovalDecision | null },
  locale: LocaleContent,
): string => {
  const labels = locale.chat.approval;
  const status = a.decision === 'approved' ? labels.approved : a.decision === 'denied' ? labels.denied : labels.requested;
  const args = formatToolArgs(a.input, 120, false);
  return `<div class="flex justify-start">
      <p class="max-w-[min(100%,640px)] text-xs text-(--text-muted)">
        <span class="font-mono font-semibold">${escapeHtml(a.name)}</span>
        ${args ? `<span class="font-mono break-all opacity-80">${escapeHtml(args)}</span>` : ''}
        <span class="whitespace-nowrap">· ${escapeHtml(status)}</span>
      </p>
    </div>`;
};
