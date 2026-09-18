import type { ApiResponse, Ayah, Emotion } from '@/types/domain';
import { apiBaseUrl } from './apiBase';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from './fetchWithTimeout';
import { resolveAyahArabic } from './quran';
import { QuranDataError } from './quranReference';

export type ApiErrorKind =
  | 'backend_unavailable'
  | 'invalid_request'
  | 'network'
  | 'no_ayah'
  | 'rate_limited'
  | 'server'
  | 'timeout'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isApiResponse<T>(payload: unknown): payload is ApiResponse<T> {
  return Boolean(payload && typeof payload === 'object' && 'success' in payload);
}

function isSafeUserMessage(message: unknown) {
  if (typeof message !== 'string') {
    return false;
  }

  const trimmed = message.trim();

  if (trimmed.length === 0 || trimmed.length > 180) {
    return false;
  }

  return !/(mongodb|mongoose|stack trace|at\s+\S+\s+\(|[A-Z]:\\|\/Users\/|\.env|MONGODB_URI|password|secret|token|connection string)/i.test(
    trimmed,
  );
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) {
    return 'invalid_request';
  }

  if (status === 404) {
    return 'no_ayah';
  }

  if (status === 408) {
    return 'timeout';
  }

  if (status === 429) {
    return 'rate_limited';
  }

  if (status === 502 || status === 503 || status === 504) {
    return 'backend_unavailable';
  }

  if (status >= 500) {
    return 'server';
  }

  return 'unknown';
}

function fallbackMessageForKind(kind: ApiErrorKind) {
  switch (kind) {
    case 'backend_unavailable':
      return 'The backend is unavailable right now. Please try again soon.';
    case 'invalid_request':
      return 'This request could not be completed. Please go back and choose an emotion again.';
    case 'network':
      return "We couldn't reach the backend. Check your connection and try again.";
    case 'no_ayah':
      return 'No ayahs are available for this emotion yet.';
    case 'rate_limited':
      return "We're getting a lot of requests right now. Please wait a moment and try again.";
    case 'server':
      return 'The server had trouble responding. Please try again.';
    case 'timeout':
      return 'The request timed out. Please try again.';
    case 'unknown':
      return 'Request failed. Please try again.';
  }
}

function safeMessageFromPayload<T>(payload: ApiResponse<T> | null, fallback: string) {
  if (payload && !payload.success && isSafeUserMessage(payload.message)) {
    return payload.message.trim();
  }

  return fallback;
}

async function parseApiResponse<T>(response: Response) {
  try {
    const payload = (await response.json()) as unknown;
    return isApiResponse<T>(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function requestApi<T>(path: string, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): Promise<T> {
  try {
    const response = await fetchWithTimeout(
      `${apiBaseUrl}${path}`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
      timeoutMs,
    );
    const payload = await parseApiResponse<T>(response);

    if (!response.ok) {
      const kind = kindForStatus(response.status);
      throw new ApiError(
        safeMessageFromPayload(payload, fallbackMessageForKind(kind)),
        kind,
        response.status,
      );
    }

    if (!payload) {
      throw new ApiError(
        'The backend returned an unexpected response. Please try again.',
        'backend_unavailable',
        response.status,
      );
    }

    if (!payload.success) {
      throw new ApiError(
        safeMessageFromPayload(payload, fallbackMessageForKind('unknown')),
        'unknown',
        response.status,
      );
    }

    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(fallbackMessageForKind('timeout'), 'timeout');
    }

    throw new ApiError(fallbackMessageForKind('network'), 'network');
  }
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof QuranDataError ? error.message : fallback;
}

export function getEmotions() {
  return requestApi<Emotion[]>('/api/emotions');
}

export async function getRandomAyah(emotion: string, excludedAyahIds: string[] = []) {
  const params = new URLSearchParams({ emotion });

  if (excludedAyahIds.length > 0) {
    params.set('exclude', excludedAyahIds.join(','));
  }

  return resolveAyahArabic(await requestApi<Ayah>(`/api/ayahs/random?${params.toString()}`));
}

export async function getAyah(id: string) {
  return resolveAyahArabic(await requestApi<Ayah>(`/api/ayahs/${encodeURIComponent(id)}`));
}
