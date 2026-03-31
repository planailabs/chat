import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { downloadJson, exportUserData } from './export';

type MutableGlobal = typeof globalThis & {
  document: Document | undefined;
  URL: typeof URL | undefined;
};

describe('exportUserData', () => {
  it('fetches data from all tables and logs export event', async () => {
    const profileMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { user_id: 'user-1' }, error: null });
    const messagesOrder = vi
      .fn()
      .mockResolvedValue({ data: [{ user_id: 'user-1' }], error: null });
    const newsletterOrder = vi
      .fn()
      .mockResolvedValue({ data: [{ status: 'subscribed' }], error: null });
    const exportEventsOrder = vi.fn().mockResolvedValue({
      data: [{ user_id: 'user-1', format: 'json', created_at: 'now' }],
      error: null,
    });
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });

    const messagesSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: messagesOrder,
      }),
    });
    const newsletterSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: newsletterOrder,
      }),
    });
    const exportSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: exportEventsOrder,
      }),
    });

    let exportCallCount = 0;
    const from = vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: profileMaybeSingle,
            }),
          }),
        };
      }
      if (table === 'messages') {
        return { select: messagesSelect };
      }
      if (table === 'newsletter_events') {
        return { select: newsletterSelect };
      }
      if (table === 'data_export_events') {
        exportCallCount += 1;
        if (exportCallCount === 1) {
          return { insert };
        }
        return { select: exportSelect };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await exportUserData({
      userId: 'user-1',
      client: { from } as unknown as SupabaseClient,
    });

    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      format: 'json',
    });
    expect(result.dataExportEvents).toEqual([
      { user_id: 'user-1', format: 'json', created_at: 'now' },
    ]);
    expect(messagesOrder).toHaveBeenCalled();
    expect(newsletterOrder).toHaveBeenCalled();
    expect(exportEventsOrder).toHaveBeenCalled();
    expect(messagesSelect).toHaveBeenCalledWith(
      'user_id, role, content, language, created_at',
    );
    expect(newsletterSelect).toHaveBeenCalledWith(
      'user_id, status, source, created_at',
    );
    expect(exportSelect).toHaveBeenCalledWith('user_id, format, created_at');
  });
});

describe('downloadJson', () => {
  it('creates a download link for JSON data', () => {
    const mutableGlobal = globalThis as MutableGlobal;
    const originalDocument = mutableGlobal.document;
    const originalURL = mutableGlobal.URL;
    const link = {
      click: vi.fn(),
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement;
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(link),
      body: {
        appendChild,
        removeChild,
      },
    } as unknown as Document;
    const mockURL = {
      createObjectURL: vi.fn().mockReturnValue('blob:url'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL;

    mutableGlobal.document = mockDocument;
    mutableGlobal.URL = mockURL;

    downloadJson({ test: true }, 'example.json');

    expect(mutableGlobal.document?.createElement).toHaveBeenCalledWith('a');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalled();
    expect(removeChild).toHaveBeenCalledWith(link);
    expect(mutableGlobal.URL?.createObjectURL).toHaveBeenCalled();
    expect(mutableGlobal.URL?.revokeObjectURL).toHaveBeenCalledWith('blob:url');

    mutableGlobal.document = originalDocument;
    mutableGlobal.URL = originalURL;
  });
});
