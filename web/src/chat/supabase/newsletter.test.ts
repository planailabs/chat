import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistNewsletterPreference } from './newsletter';
import { persistProfilePreferences } from './profile';
import { executeWithRetry } from './retry';

vi.mock('./profile', () => ({
  persistProfilePreferences: vi.fn(),
}));
vi.mock('./retry', () => ({
  executeWithRetry: vi.fn(async (operation: () => Promise<unknown>) =>
    operation(),
  ),
}));

const mockedPersistProfilePreferences = vi.mocked(persistProfilePreferences);

describe('newsletter supabase helpers', () => {
  it('persistNewsletterPreference upserts profile and inserts event', async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn().mockReturnValue({ insert });
    mockedPersistProfilePreferences.mockResolvedValue(undefined);

    await persistNewsletterPreference({
      userId: 'user-2',
      localeKey: 'en',
      subscribe: true,
      source: 'chat_flow',
      client: { from } as unknown as SupabaseClient,
    });

    expect(mockedPersistProfilePreferences).toHaveBeenCalledWith({
      userId: 'user-2',
      language: 'en',
      newsletterOptIn: true,
      client: { from } as unknown as SupabaseClient,
    });
    expect(from).toHaveBeenCalledWith('newsletter_events');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-2',
      status: 'subscribed',
      source: 'chat_flow',
    });
    expect(executeWithRetry).toHaveBeenCalled();
  });
});
