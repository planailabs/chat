import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertUserMessages } from './messages';
import { executeWithRetry } from './retry';
import type { CachedPrompt } from '../auth/preAuthCache';

vi.mock('./retry', () => ({
  executeWithRetry: vi.fn(async (operation: () => Promise<unknown>) =>
    operation(),
  ),
}));

const createMockClient = () => {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ insert });
  return { from, insert };
};

describe('insertUserMessages', () => {
  it('inserts prompts into messages table', async () => {
    const mockClient = createMockClient();
    const prompts: CachedPrompt[] = [
      { id: '1', content: 'Hello', createdAt: 1, localeKey: 'en' },
    ];

    await insertUserMessages({
      userId: 'user-123',
      prompts,
      client: mockClient as unknown as SupabaseClient,
    });

    expect(mockClient.from).toHaveBeenCalledWith('messages');
    expect(mockClient.insert).toHaveBeenCalledWith([
      {
        user_id: 'user-123',
        role: 'user',
        content: 'Hello',
        language: 'en',
        created_at: new Date(1).toISOString(),
      },
    ]);
    expect(executeWithRetry).toHaveBeenCalledTimes(1);
  });

  it('throws when Supabase insert fails', async () => {
    const error = new Error('insert failed');
    const insert = vi.fn().mockResolvedValue({ data: null, error });
    const from = vi.fn().mockReturnValue({ insert });
    const failingPrompts: CachedPrompt[] = [
      { id: '2', content: 'Test', createdAt: 2, localeKey: 'de' },
    ];
    await expect(
      insertUserMessages({
        userId: 'user-456',
        prompts: failingPrompts,
        client: { from } as unknown as SupabaseClient,
      }),
    ).rejects.toThrow('insert failed');
  });
});
