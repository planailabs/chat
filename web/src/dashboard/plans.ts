/** Plans (admin): readable numbers and the create/edit form's validation. */
import type { Plan, PlanInput } from '../chat/api';

/** 1000000 → "1,000,000". */
export const formatNumber = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** A limit for display: 0 is unlimited. */
export const limitText = (n: number | undefined): string => (!n ? 'unlimited' : formatNumber(n));

/** The form's fields as typed (numbers may carry separators: "1,000,000"). */
export interface PlanForm {
  id: string;
  name: string;
  input: string;
  output: string;
}

export const emptyPlanForm = (): PlanForm => ({ id: '', name: '', input: '0', output: '0' });

export const planToForm = (plan: Plan): PlanForm => ({
  id: plan.id,
  name: plan.name,
  input: formatNumber(plan.limits.hourly_input_tokens ?? 0),
  output: formatNumber(plan.limits.hourly_output_tokens ?? 0),
});

/** "1,000,000", "1 000 000", "1.000.000", "1_000_000" → 1000000; null when not a whole number ≥ 0. */
export const parseTokens = (text: string): number | null => {
  const digits = text.trim().replace(/[\s,._'’]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
};

export type PlanFormErrors = Partial<Record<keyof PlanForm, string>>;

/**
 * Checks the form. `editing`: the id is fixed; otherwise it must be a new
 * lowercase id (letters, digits, - and _).
 */
export const validatePlanForm = (
  form: PlanForm,
  opts: { editing: boolean; existingIds: string[] },
): { input: PlanInput; errors: null } | { input: null; errors: PlanFormErrors } => {
  const errors: PlanFormErrors = {};
  const id = form.id.trim();
  if (!opts.editing) {
    if (!id) errors.id = 'Required';
    else if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) errors.id = 'Lowercase letters, digits, - and _';
    else if (opts.existingIds.includes(id)) errors.id = 'A plan with this id exists';
  }
  const name = form.name.trim();
  if (!name) errors.name = 'Required';
  const input = parseTokens(form.input);
  if (input === null) errors.input = 'A whole number (0 = unlimited)';
  const output = parseTokens(form.output);
  if (output === null) errors.output = 'A whole number (0 = unlimited)';
  if (Object.keys(errors).length > 0) return { input: null, errors };
  return { input: { id, name, hourly_input_tokens: input!, hourly_output_tokens: output! }, errors: null };
};
