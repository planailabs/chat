/**
 * The plan's hourly token budget as usage bars: "x of y tokens this hour",
 * or "x tokens this hour" with "unlimited" when the limit is 0.
 */

import type { Budget } from '../api';

/** A token count with the language's digit grouping (1,000,000 / 1.000.000). */
export const formatTokens = (n: number, lang: string): string => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(n);

export interface UsageBar {
  /** 0–100 (100 when used up); 0 for unlimited. */
  percent: number;
  unlimited: boolean;
  exhausted: boolean;
  /** "x of y tokens this hour" / "x tokens this hour". */
  label: string;
}

export interface UsageTexts {
  /** `{{used}}`, `{{limit}}` */
  usage: string;
  /** `{{used}}` */
  usageUnlimited: string;
}

export const usageBar = (used: number, limit: number, texts: UsageTexts, lang: string): UsageBar => {
  const usedText = formatTokens(used, lang);
  if (limit <= 0) {
    return { percent: 0, unlimited: true, exhausted: false, label: texts.usageUnlimited.replace('{{used}}', usedText) };
  }
  return {
    percent: Math.min(100, Math.round((used / limit) * 1000) / 10),
    unlimited: false,
    exhausted: used >= limit,
    label: texts.usage.replace('{{used}}', usedText).replace('{{limit}}', formatTokens(limit, lang)),
  };
};

/** Input and output bars of a budget. */
export const budgetBars = (budget: Budget, texts: UsageTexts, lang: string) => ({
  input: usageBar(budget.used_input_tokens, budget.hourly_input_tokens, texts, lang),
  output: usageBar(budget.used_output_tokens, budget.hourly_output_tokens, texts, lang),
});
