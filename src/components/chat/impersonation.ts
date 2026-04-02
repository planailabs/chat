/**
 * Client-side Admin Impersonation
 *
 * Detects ?impersonate=<userId> in the page URL (set by admin portal).
 * When active, API calls are routed to the impersonated user and
 * all write operations to the user's profile are suppressed.
 */

/** Read ?impersonate= from the page URL (always reads live — no caching) */
export const getImpersonateId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('impersonate');
};

/** True when admin is impersonating another user */
export const isImpersonating = (): boolean => getImpersonateId() !== null;

/** Append impersonate param to a URL if active */
export const withImpersonate = (url: string): string => {
  const id = getImpersonateId();
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}impersonate=${encodeURIComponent(id)}`;
};
