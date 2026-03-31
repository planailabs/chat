import type { SupabaseClient } from '@supabase/supabase-js';
import type { CachedPrompt } from '../auth/preAuthCache';
import type { LocaleKey } from '../content';
import { getSupabaseClientOrThrow } from './client';
import { executeWithRetry } from './retry';

interface MessagesClientDeps {
  client?: SupabaseClient;
}

interface InsertUserMessagesParams extends MessagesClientDeps {
  userId: string;
  prompts: CachedPrompt[];
}

export const insertUserMessages = async ({
  userId,
  prompts,
  client,
}: InsertUserMessagesParams) => {
  if (prompts.length === 0) {
    return;
  }
  const resolvedClient = getSupabaseClientOrThrow(client ?? null);
  const rows = prompts.map((prompt) => ({
    user_id: userId,
    role: 'user' as const,
    content: prompt.content,
    language: (prompt.localeKey ?? 'en') as LocaleKey,
    created_at: new Date(prompt.createdAt).toISOString(),
  }));
  await executeWithRetry(async () => {
    const { error } = await resolvedClient.from('messages').insert(rows);
    if (error) {
      throw error;
    }
  });
};
