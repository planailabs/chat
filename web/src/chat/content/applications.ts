/**
 * plan.ai's applications, linked from the sidebar (new tab). One entry per
 * application: adding one is a one-line change.
 */

import type { LocaleKey } from './locales';

export interface Application {
  url: string;
  icon: 'cloud' | 'agency' | 'machine';
  label: Record<LocaleKey, string>;
}

export const APPLICATIONS: Application[] = [
  { url: 'https://cloud.plan.ai', icon: 'cloud', label: { en: 'Cloud', de: 'Cloud' } },
  { url: 'https://agency.plan.ai', icon: 'agency', label: { en: 'Web Agency', de: 'Webagentur' } },
  { url: 'https://mgmt.plan.ai', icon: 'machine', label: { en: 'Machine management', de: 'Maschinenverwaltung' } },
];
