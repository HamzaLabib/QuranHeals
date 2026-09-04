import { Platform } from 'react-native';

import type { ApiResponse, Ayah, Emotion } from '@/types/domain';

const fallbackApiUrl = Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? fallbackApiUrl).replace(/\/$/, '');

class ApiError extends Error {}

async function requestApi<T>(path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const payload = (await response.json()) as ApiResponse<T>;

    if (!response.ok || !payload.success) {
      throw new ApiError(payload.success ? 'Request failed.' : payload.message);
    }

    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('Network request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export function getEmotions() {
  return requestApi<Emotion[]>('/api/emotions');
}

export function getRandomAyah(emotion: string, excludedAyahIds: string[] = []) {
  const params = new URLSearchParams({ emotion });

  if (excludedAyahIds.length > 0) {
    params.set('exclude', excludedAyahIds.join(','));
  }

  return requestApi<Ayah>(`/api/ayahs/random?${params.toString()}`);
}

export function getAyah(id: string) {
  return requestApi<Ayah>(`/api/ayahs/${encodeURIComponent(id)}`);
}
