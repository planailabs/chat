/**
 * Icon shapes (SVG bodies, trusted constants) rendered by `AppIcon.vue`.
 * Stroke icons are 24×24 outlines; `fill` icons are drawn filled.
 */

export const ICONS = {
  send: '<path d="M12 4.5v15" stroke-width="2.4"/><path d="M7.5 9l4.5-4.5L16.5 9" stroke-width="2.4"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  newChat: '<path d="M11 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4"/><path d="M17.5 3.8a1.8 1.8 0 0 1 2.6 2.6L13 13.5l-3.4.9.9-3.4z"/>',
  rename: '<path d="M15.5 5.5l3 3"/><path d="M4.5 19.5l1-4 10.6-10.6a2.1 2.1 0 0 1 3 3L8.5 18.5z"/>',
  delete: '<path d="M4.5 7h15"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12.5h9l1-12.5"/><path d="M10.5 11v5M13.5 11v5"/>',
  external: '<path d="M13.5 4.5h6v6"/><path d="M19.5 4.5l-8 8"/><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z"/>',
  agency: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/><path d="M6.5 6.8h.01M9 6.8h.01"/><path d="M9.5 13l-2 2 2 2M14.5 13l2 2-2 2"/>',
  machine: '<rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 18.5h19"/><path d="M10 15v3.5M14 15v3.5"/>',
  check: '<path d="M6 12.5l3.5 3.5 8-8" stroke-width="2"/>',
  user: '<circle cx="12" cy="8" r="3.5" fill="currentColor" stroke="none"/><path d="M5 19c0-3.032 2.686-5 7-5s7 1.968 7 5"/>',
  /** Theme: system (half filled), the first manual mode (empty), the second (filled). */
  themeSystem: '<circle cx="12" cy="12" r="8" stroke-width="1.5"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  themeEmpty: '<circle cx="12" cy="12" r="8" stroke-width="1.5"/>',
  themeFilled: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke-width="1.5"/>',
} as const;

export type IconName = keyof typeof ICONS | 'globe';
