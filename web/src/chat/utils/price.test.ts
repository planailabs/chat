import { describe, expect, it } from 'vitest';
import { locales } from '../content';
import { formatMoney, priceLabel } from './price';
import { purchaseOf } from '../actions/chat/toolRuns';

const de = locales.de.chat.purchase.prices;
const en = locales.en.chat.purchase.prices;
const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('prices', () => {
  it('format per language and interval', () => {
    expect(nbsp(priceLabel({ price_cents: 4900, currency: 'EUR', interval: 'month' }, de, 'de'))).toBe('49,00 € / Monat');
    expect(priceLabel({ price_cents: 4900, currency: 'EUR', interval: 'month' }, en, 'en')).toBe('€49.00 / month');
    expect(nbsp(priceLabel({ price_cents: 52_800, currency: 'EUR', interval: 'year' }, de, 'de'))).toBe('528,00 € / Jahr');
    expect(priceLabel({ price_cents: 1999, currency: 'USD', interval: 'once' }, en, 'en')).toBe('$19.99 once');
    expect(priceLabel({ price_cents: 10, currency: 'EUR', interval: 'usage' }, en, 'en')).toBe('€0.10, billed by usage');
  });

  it('say so when the price is unknown', () => {
    expect(formatMoney(NaN, 'EUR', 'en')).toBeNull();
    expect(formatMoney(100, 'euro', 'en')).toBeNull();
    expect(priceLabel({ price_cents: NaN, currency: 'EUR', interval: 'month' }, en, 'en')).toBe('Price unknown');
  });
});

describe('purchaseOf', () => {
  it('keeps a purchase a purchase, whatever is missing', () => {
    expect(purchaseOf(null)).toBeNull();
    expect(purchaseOf('x')).toBeNull();
    expect(purchaseOf({})).toMatchObject({ product_name: '', price_cents: NaN, interval: 'once', trial_days: null });
    expect(
      purchaseOf({ tool: 'subscription_create', product: 'cloud-pro', product_name: 'Cloud Pro', organization_name: 'clover-inc', price_cents: 4900, currency: 'eur', interval: 'month', trial_days: 14, summary: 'Pro plan' }),
    ).toEqual({ tool: 'subscription_create', product: 'cloud-pro', product_name: 'Cloud Pro', organization_name: 'clover-inc', price_cents: 4900, currency: 'EUR', interval: 'month', trial_days: 14, summary: 'Pro plan' });
  });
});
