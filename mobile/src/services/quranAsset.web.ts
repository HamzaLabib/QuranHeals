import { Asset } from 'expo-asset';

import manifest from '@/assets/quran/quran-manifest.json';
import { QuranDataError } from './quranReference';
import { bundledQuranAssets } from './quranAssets';

export async function openBundledQuran() {
  if (typeof window === 'undefined' || !window.crossOriginIsolated) {
    throw new QuranDataError('The local Quran could not be opened in this browser. Please reload the app.');
  }
  const asset = Asset.fromModule(bundledQuranAssets.database);
  const url = new URL(asset.uri, window.location.href);
  if (url.origin !== window.location.origin) throw new QuranDataError('The bundled Quran asset must be served with this app.', 'integrity');
  // Cache the shipped asset for offline reads after its first successful load.
  // This is an app asset request, never a Quran API or a backend Arabic lookup.
  let cache: Cache | undefined;
  try { cache = await caches.open(`quran-heals:sqlite:${manifest.database.sha256}`); } catch { /* Cache storage may be disabled. */ }
  let response = await cache?.match(url.href);
  if (!response) {
    response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) throw new QuranDataError('The bundled Quran could not be loaded. Please try again.');
  }
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  // Browser asset/cache authentication is performed once per lazy initialization,
  // not per verse or per render; only 1.7 MB is hashed using the browser's native API.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.database.sha256) {
    await cache?.delete(url.href);
    throw new QuranDataError('The local Quran asset could not be verified.', 'integrity');
  }
  try { await cache?.put(url.href, response); } catch { /* Reads can work without persistent caching. */ }
  const { deserializeDatabaseAsync } = await import('expo-sqlite');
  return deserializeDatabaseAsync(bytes, { useNewConnection: true });
}
