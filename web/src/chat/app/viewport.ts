/**
 * Desktop or mobile width: from Tailwind's `md` the sidebar is a column,
 * below it a drawer. `isDesktop` follows the window.
 */

import { ref } from 'vue';

export const DESKTOP_QUERY = '(min-width: 768px)';

const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;

export const isDesktop = ref(query?.matches ?? false);

query?.addEventListener?.('change', (event) => {
  isDesktop.value = event.matches;
});
