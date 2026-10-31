import { api, isUnauthorized, signIn, stopImpersonation } from '../chat/api';

/** Escapes text for element content and quoted attribute values. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lets admins in. Signed-out visitors go through sign-in and come back here;
 * everyone else is sent to the chat. An admin still impersonating someone is
 * that user to the server, so impersonation ends first.
 * @returns true if admin, false (and navigating away) otherwise.
 */
export async function enforceAdminAccess(): Promise<boolean> {
  try {
    const profile = await api.profile.me();
    if (profile.impersonating) {
      stopImpersonation();
      window.location.reload();
      return false;
    }
    if (!profile.is_admin) {
      console.warn('Dashboard: Not an admin, redirecting');
      window.location.href = '/';
      return false;
    }
    return true;
  } catch (error) {
    if (isUnauthorized(error)) {
      signIn();
    } else {
      console.error('Dashboard: profile check failed', error);
      window.location.href = '/';
    }
    return false;
  }
}
