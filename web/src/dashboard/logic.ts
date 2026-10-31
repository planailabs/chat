import { api, isUnauthorized, signIn, stopImpersonation } from '../chat/api';

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

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(dateStr: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** A message's conversation title, or a dash when it has none. */
export function conversationLabel(conversation: string | null | undefined): string {
  return conversation?.trim() ? conversation : '—';
}

/** Copies text; `true` when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
