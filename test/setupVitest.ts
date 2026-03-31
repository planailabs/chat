import { vi, beforeEach } from 'vitest';

const createMockStorage = () => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  } satisfies Storage;
};

beforeEach(() => {
  const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
  const caf = (id: number) => clearTimeout(id);

  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: vi.fn(),
    },
    querySelector: vi.fn(() => null),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    sessionStorage: createMockStorage(),
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
});
