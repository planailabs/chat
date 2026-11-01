/** Prices of purchases: "49,00 € / Monat", "€49.00 / month". */
import type { Purchase } from '../api';

/** An amount in the language's format; null when unknown. */
export const formatMoney = (cents: number, currency: string, lang: string): string | null => {
  if (!Number.isFinite(cents) || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return null;
  }
};

export interface PriceTexts {
  /** `{{price}}` per interval */
  month: string;
  year: string;
  once: string;
  usage: string;
  unknown: string;
}

/** The price with its interval, or the "unknown price" text. */
export const priceLabel = (p: Pick<Purchase, 'price_cents' | 'currency' | 'interval'>, texts: PriceTexts, lang: string): string => {
  const money = formatMoney(p.price_cents, p.currency, lang);
  if (money === null) return texts.unknown;
  return texts[p.interval].replace('{{price}}', money);
};
