import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClientOrThrow } from './client';
import { executeWithRetry } from './retry';

interface ExportUserDataParams {
  userId: string;
  client?: SupabaseClient;
}

export interface UserDataExport {
  generatedAt: string;
  profile: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
  newsletterEvents: Record<string, unknown>[];
  dataExportEvents: Record<string, unknown>[];
}

export const exportUserData = async ({
  userId,
  client,
}: ExportUserDataParams): Promise<UserDataExport> => {
  const resolvedClient = getSupabaseClientOrThrow(client ?? null);

  // Log the export before fetching data so the newest event is included
  await executeWithRetry(async () => {
    const { error } = await resolvedClient.from('data_export_events').insert({
      user_id: userId,
      format: 'json',
    });
    if (error) {
      throw error;
    }
  });

  const profilePromise = resolvedClient
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  const messagesPromise = resolvedClient
    .from('messages')
    .select('user_id, role, content, language, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  const newsletterPromise = resolvedClient
    .from('newsletter_events')
    .select('user_id, status, source, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  const exportEventsPromise = resolvedClient
    .from('data_export_events')
    .select('user_id, format, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const [profileRes, messagesRes, newsletterRes, exportEventsRes] =
    await Promise.all([
      profilePromise,
      messagesPromise,
      newsletterPromise,
      exportEventsPromise,
    ]);

  const errors = [
    profileRes.error,
    messagesRes.error,
    newsletterRes.error,
    exportEventsRes.error,
  ].filter(Boolean);
  if (errors.length > 0) {
    throw errors[0]!;
  }

  return {
    generatedAt: new Date().toISOString(),
    profile: profileRes.data ?? null,
    messages: messagesRes.data ?? [],
    newsletterEvents: newsletterRes.data ?? [],
    dataExportEvents: exportEventsRes.data ?? [],
  };
};

export const downloadJson = (
  data: unknown,
  filename: string = 'planai-export.json',
) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
