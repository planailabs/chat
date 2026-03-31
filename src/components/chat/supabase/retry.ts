import { RETRY } from '../constants';

const RETRYABLE_STATUS_CODES: Set<number> = new Set(
  RETRY.RETRYABLE_STATUS_CODES,
);
const RETRYABLE_POSTGREST_CODES: Set<string> = new Set(
  RETRY.RETRYABLE_POSTGREST_CODES,
);
const NETWORK_ERROR_HINTS = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
  'fetch failed',
];

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = (error as { status?: number; code?: number }).status;
  if (typeof candidate === 'number') {
    return candidate;
  }
  const code = (error as { code?: number }).code;
  return typeof code === 'number' ? code : null;
};

const getErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = (error as { code?: string }).code;
  return typeof candidate === 'string' ? candidate : null;
};

export const isRetryableSupabaseError = (error: unknown): boolean => {
  if (!error) {
    return false;
  }
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return false;
  }
  const status = getStatusCode(error);
  if (typeof status === 'number' && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }
  const code = getErrorCode(error);
  if (code && RETRYABLE_POSTGREST_CODES.has(code)) {
    return true;
  }
  const message =
    typeof (error as { message?: string }).message === 'string'
      ? (error as { message?: string }).message
      : '';
  if (
    message &&
    NETWORK_ERROR_HINTS.some((hint) =>
      message.toLowerCase().includes(hint.toLowerCase()),
    )
  ) {
    return true;
  }
  if (error instanceof TypeError && !message) {
    return true;
  }
  return false;
};

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (details: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

export const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> => {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? RETRY.MAX_ATTEMPTS);
  const baseDelay = options?.baseDelayMs ?? RETRY.BASE_DELAY_MS;
  const shouldRetry = options?.isRetryable ?? isRetryableSupabaseError;

  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && shouldRetry(error);
      if (!canRetry) {
        throw error;
      }
      const backoff = baseDelay * 2 ** (attempt - 1);
      const jitter = backoff * 0.25 * Math.random();
      const delayMs = backoff + jitter;
      options?.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
};
