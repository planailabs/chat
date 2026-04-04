/**
 * Token rate limiting — per-user hourly budget enforcement.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const INPUT_TOKEN_BUDGET_PER_HOUR = 100_000;
export const OUTPUT_TOKEN_BUDGET_PER_HOUR = 20_000;

export async function checkTokenBudget(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ allowed: boolean; inputUsed: number; outputUsed: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('chat_token_usage')
    .select('input_tokens, output_tokens')
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);

  const rows = data ?? [];
  const inputUsed = rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0);
  const outputUsed = rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0);

  return {
    allowed: inputUsed < INPUT_TOKEN_BUDGET_PER_HOUR && outputUsed < OUTPUT_TOKEN_BUDGET_PER_HOUR,
    inputUsed,
    outputUsed,
  };
}

export async function recordTokenUsage(
  supabase: SupabaseClient,
  userId: string,
  mode: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number = 0,
  cacheReadInputTokens: number = 0,
): Promise<void> {
  await supabase.from('chat_token_usage').insert({
    user_id: userId,
    mode,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
  });
}
