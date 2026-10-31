/** Send button arrow icon (shared between hero composer and chat input) */
export const SEND_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 4.5v15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M7.5 9l4.5-4.5L16.5 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const icon = (body: string, cls = 'sidebar-icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Sidebar toggle (a panel with its left column). */
export const SIDEBAR_ICON_SVG = icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>', 'icon-size');

/** New chat (a pen on a square). */
export const NEW_CHAT_ICON_SVG = icon('<path d="M11 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4"/><path d="M17.5 3.8a1.8 1.8 0 0 1 2.6 2.6L13 13.5l-3.4.9.9-3.4z"/>');

export const RENAME_ICON_SVG = icon('<path d="M15.5 5.5l3 3"/><path d="M4.5 19.5l1-4 10.6-10.6a2.1 2.1 0 0 1 3 3L8.5 18.5z"/>');

export const DELETE_ICON_SVG = icon('<path d="M4.5 7h15"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12.5h9l1-12.5"/><path d="M10.5 11v5M13.5 11v5"/>');

/** Opens elsewhere (an arrow out of a corner). */
export const EXTERNAL_ICON_SVG = icon('<path d="M13.5 4.5h6v6"/><path d="M19.5 4.5l-8 8"/><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4"/>', 'sidebar-icon sidebar-icon--small');

/** Icons of plan.ai's applications (sidebar). */
export const APP_ICONS = {
  cloud: icon('<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z"/>'),
  agency: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/><path d="M6.5 6.8h.01M9 6.8h.01"/><path d="M9.5 13l-2 2 2 2M14.5 13l2 2-2 2"/>'),
  machine: icon('<rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 18.5h19"/><path d="M10 15v3.5M14 15v3.5"/>'),
} as const;

export type AppIcon = keyof typeof APP_ICONS;
