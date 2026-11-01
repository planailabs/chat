import { describe, expect, it } from 'vitest';
import { locales } from '../content';
import { budgetBars, formatTokens, usageBar } from './budget';

const en = locales.en.settings.sections.plan;
const de = locales.de.settings.sections.plan;

describe('formatTokens', () => {
  it('groups digits by language', () => {
    expect(formatTokens(1_000_000, 'en')).toBe('1,000,000');
    expect(formatTokens(1_000_000, 'de')).toBe('1.000.000');
    expect(formatTokens(0, 'en')).toBe('0');
  });
});

describe('usageBar', () => {
  it('shows use of a limit', () => {
    expect(usageBar(250_000, 1_000_000, en, 'en')).toEqual({ percent: 25, unlimited: false, exhausted: false, label: '250,000 of 1,000,000 tokens this hour' });
    expect(usageBar(1234, 100_000, de, 'de').label).toBe('1.234 von 100.000 Tokens in dieser Stunde');
  });

  it('caps at 100% and says when used up', () => {
    expect(usageBar(1_200, 1_000, en, 'en')).toMatchObject({ percent: 100, exhausted: true });
    expect(usageBar(1_000, 1_000, en, 'en')).toMatchObject({ percent: 100, exhausted: true });
  });

  it('treats 0 as unlimited', () => {
    expect(usageBar(42_000, 0, en, 'en')).toEqual({ percent: 0, unlimited: true, exhausted: false, label: '42,000 tokens this hour' });
  });

  it('builds both bars of a budget', () => {
    const bars = budgetBars(
      { plan_id: 'standard', plan_name: 'Standard', hourly_input_tokens: 2_000, hourly_output_tokens: 0, used_input_tokens: 500, used_output_tokens: 10 },
      en,
      'en',
    );
    expect(bars.input.percent).toBe(25);
    expect(bars.output.unlimited).toBe(true);
  });
});
