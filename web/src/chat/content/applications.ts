/**
 * plan.ai's applications, linked from the sidebar (new tab). The server sends
 * the ones this user may see (`[[apps]]` in its config, gated by email).
 */

import type { AppLink } from '../api';
import type { IconName } from '../ui/icons';
import { ICONS } from '../ui/icons';
import type { LocaleKey } from './locales';

/** The configured icon if the web has it, else a globe. */
export const appIcon = (app: AppLink): IconName =>
  app.icon && app.icon in ICONS ? (app.icon as IconName) : 'globe';

/** The label in `lang`, else English, else the app's name. */
export const appLabel = (app: AppLink, lang: LocaleKey): string => app.label[lang] ?? app.label.en ?? app.name;
