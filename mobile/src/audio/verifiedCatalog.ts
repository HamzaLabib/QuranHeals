import { fetchWithTimeout } from '@/services/fetchWithTimeout';
import { devLog } from '@/utils/devLog';

import { isReciterId } from './reciters';
import { verifiedTimingStore } from './storage';
import { createVerifiedCatalog, type ConditionalFetch, type VerifiedEnvironment } from './verifiedTiming';

/**
 * Phase 4.8.3: the app's one verified-timing catalogue (verifiedTiming.ts).
 *
 * Configuration, per EAS build profile (never a secret: the API is public and read-only):
 *   EXPO_PUBLIC_AUDIO_REGISTRY_URL  the audio review service (https). Unset: the catalogue is off and the app plays
 *                                   exactly its built-in catalogue, as before Phase 4.8.3.
 *   EXPO_PUBLIC_AUDIO_TIMING_ENV    'development' or 'production'; default: development builds read 'development',
 *                                   every other build 'production'.
 * Refresh: at startup, whenever the app returns to the foreground, and when a surah starts loading, at most every
 * 15 minutes; a new version is used from the next surah that loads (never in the middle of the playing one).
 */
const TIMEOUT_MS = 15_000;

function configuredUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_AUDIO_REGISTRY_URL?.trim();
  if (!url) return null;
  if (/^https:\/\/[^\s/]+/.test(url)) return url;
  // A local review service, for development builds only.
  if (__DEV__ && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)(:\d+)?(\/|$)/.test(url)) return url;
  return null;
}

export const VERIFIED_TIMING_ENVIRONMENT: VerifiedEnvironment =
  process.env.EXPO_PUBLIC_AUDIO_TIMING_ENV === 'development' || process.env.EXPO_PUBLIC_AUDIO_TIMING_ENV === 'production'
    ? process.env.EXPO_PUBLIC_AUDIO_TIMING_ENV
    : __DEV__
      ? 'development'
      : 'production';

const conditionalFetch: ConditionalFetch = async (url, etag) => {
  const response = await fetchWithTimeout(url, etag ? { headers: { 'If-None-Match': etag } } : {}, TIMEOUT_MS);
  return { status: response.status, text: response.status === 200 ? await response.text() : '', etag: response.headers.get('etag') };
};

export const verifiedCatalog = createVerifiedCatalog({
  baseUrl: configuredUrl(),
  environment: VERIFIED_TIMING_ENVIRONMENT,
  fetch: conditionalFetch,
  store: verifiedTimingStore,
  knownReciter: isReciterId,
  // Expo inlines the platform at bundle time ('android' | 'ios'); an entry verified only for the other one is not used.
  platform: process.env.EXPO_OS ?? null,
  log: (message, detail) => devLog('verifiedTiming', message, detail),
  // Development builds only: a shorter refresh interval for device tests (EXPO_PUBLIC_AUDIO_TIMING_REFRESH_SECONDS).
  refreshIntervalMs: __DEV__ && Number(process.env.EXPO_PUBLIC_AUDIO_TIMING_REFRESH_SECONDS) > 0 ? Number(process.env.EXPO_PUBLIC_AUDIO_TIMING_REFRESH_SECONDS) * 1000 : undefined,
});

let started = false;
/** Starts the catalogue once (root layout): the stored manifest at once, then a refresh, and on every foreground. */
export function startVerifiedTiming() {
  if (started || !verifiedCatalog.enabled) return;
  started = true;
  void verifiedCatalog.ready().then(() => verifiedCatalog.refresh({ force: true })).catch(() => undefined);
  // Loaded here, not at the top: modules that only ask what can play (format.ts, availability.ts) stay free of native code.
  void import('react-native').then(({ AppState }) => {
    AppState.addEventListener('change', (next) => {
      if (next === 'active') void verifiedCatalog.refresh().catch(() => undefined);
    });
  }).catch(() => undefined);
}
