/**
 * Tool calls as the chat shows them: the run (name, the assistant's reason,
 * the safety check where one ran) and the check's badge text.
 */

import type { ApprovalData, Purchase, SafetyCheck, ToolData } from '../../api';
import type { PendingApproval, ToolRun } from '../../app/state';
import type { LocaleContent } from '../../content';

const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

/** A check as the server sent it, or null when there is none (or it is malformed). */
export const safetyCheckOf = (check: unknown): SafetyCheck | null => {
  if (!check || typeof check !== 'object') return null;
  const c = check as Partial<SafetyCheck>;
  if (c.decision !== 'allowed' && c.decision !== 'denied' && c.decision !== 'asked') return null;
  const verdict = c.verdict === 'approved' || c.verdict === 'rejected' || c.verdict === 'failed' ? c.verdict : null;
  return { agent_reason: text(c.agent_reason), decision: c.decision, verdict, reasoning: text(c.reasoning) };
};

/** A finished tool run (history row or `tool_end`). */
export const toolRunOf = (name: string, data: Partial<ToolData>): ToolRun => {
  const check = safetyCheckOf(data.check);
  return {
    callId: data.call_id ?? '',
    name,
    isError: data.is_error === true,
    reason: text(data.reason) ?? text(check?.agent_reason),
    target: text(data.target),
    check,
  };
};

const INTERVALS = ['month', 'year', 'once', 'usage'] as const;

/**
 * A purchase as the server sent it. Any object counts (missing fields read
 * as unknown): a call that buys something must never fall back to the plain
 * approval card.
 */
export const purchaseOf = (v: unknown): Purchase | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim() : '');
  const cents = typeof p.price_cents === 'number' && Number.isFinite(p.price_cents) ? p.price_cents : NaN;
  const trial = typeof p.trial_days === 'number' && p.trial_days > 0 ? Math.floor(p.trial_days) : null;
  return {
    tool: s('tool'),
    product: s('product'),
    product_name: s('product_name') || s('product'),
    organization_name: s('organization_name'),
    price_cents: cents,
    currency: s('currency').toUpperCase(),
    interval: (INTERVALS as readonly string[]).includes(s('interval')) ? (s('interval') as Purchase['interval']) : 'once',
    trial_days: trial,
    summary: s('summary'),
  };
};

/** A pending approval (event or history), with the assistant's reason and the check. */
export const pendingApprovalOf = (a: ApprovalData): PendingApproval => {
  const check = safetyCheckOf(a.check);
  return {
    callId: a.call_id,
    name: a.name,
    input: a.input,
    reason: text(a.reason),
    agentReason: text(a.agent_reason) ?? text(check?.agent_reason),
    check,
    purchase: purchaseOf(a.purchase),
  };
};

export interface CheckBadge {
  /** "Safety check: approved", "Safety check: rejected · denied", … */
  label: string;
  tone: 'ok' | 'warn' | 'bad';
}

/** The safety check's badge: its verdict, plus what the hook did when it stopped or asked. */
export const checkBadge = (check: SafetyCheck, locale: LocaleContent): CheckBadge => {
  const t = locale.chat.tool;
  const verdict = check.verdict === 'approved' ? t.verdicts.approved : check.verdict === 'rejected' ? t.verdicts.rejected : t.verdicts.failed;
  const decision = check.decision === 'denied' ? t.decisions.denied : check.decision === 'asked' ? t.decisions.asked : null;
  const tone: CheckBadge['tone'] = check.decision === 'denied' || check.verdict === 'rejected' ? 'bad' : check.verdict === 'approved' && check.decision === 'allowed' ? 'ok' : 'warn';
  return { label: `${t.safetyCheck}: ${verdict}${decision ? ` · ${decision}` : ''}`, tone };
};
