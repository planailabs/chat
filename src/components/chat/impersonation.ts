/**
 * Client-side Admin Impersonation
 *
 * Detects ?impersonate=<userId> in the page URL (set by admin portal).
 * When active, API calls are routed to the impersonated user and
 * all write operations to the user's profile are suppressed.
 */

/** Cached value — URL doesn't change during a session */
let cachedImpersonateId: string | null | undefined;

/** Read ?impersonate= from the page URL */
export const getImpersonateId = (): string | null => {
  if (cachedImpersonateId !== undefined) return cachedImpersonateId;
  if (typeof window === 'undefined') {
    cachedImpersonateId = null;
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  cachedImpersonateId = params.get('impersonate');
  return cachedImpersonateId;
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
