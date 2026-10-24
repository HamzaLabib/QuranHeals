import { fetchWithTimeout } from '@/services/fetchWithTimeout';
import { getSurahName } from '@/services/surahNames';
import { devLog } from '@/utils/devLog';

import { audioMode } from './availability';
import { createAudioDownloads } from './downloads';
import { createPlaybackEngine } from './engine';
import { createExpoOutput } from './expoOutput';
import { INDEX_SEEK_URLS } from './reciters';
import { SOURCE_REGISTRY } from './sourceRegistry';
import { localFirstSource } from './sources';
import { audioFiles, timingStore } from './storage';
import { createStreamCheck } from './streamCheck';
import { createTimingLoader } from './timing';
import { verifiedCatalog } from './verifiedCatalog';

const TIMING_TIMEOUT_MS = 15_000;
/**
 * The whole-surah stream check (audio/streamCheck.ts): a HEAD request, else two bytes by range where the host is audited
 * for byte ranges. It fails closed: a check that times out refuses the stream (retried like a network failure).
 */
const STREAM_CHECK_TIMEOUT_MS = 5000;
const streamCheck = createStreamCheck((url, method) =>
  fetchWithTimeout(url, method === 'HEAD' ? { method: 'HEAD' } : { headers: { Range: 'bytes=0-1' } }, STREAM_CHECK_TIMEOUT_MS));

/** Lock-screen text follows the App Language (set by AudioLocaleSync in the root layout). */
let lockScreenRtl = false;
export function setAudioLocale(rtl: boolean) {
  lockScreenRtl = rtl;
}

const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export const timingLoader = createTimingLoader({
  async fetchText(url) {
    const response = await fetchWithTimeout(url, {}, TIMING_TIMEOUT_MS);
    if (!response.ok) throw new Error(`timing ${response.status}`);
    return response.text();
  },
  store: timingStore,
  // Phase 4.8.3: published human-verified timing first (off unless EXPO_PUBLIC_AUDIO_REGISTRY_URL is set).
  verified: verifiedCatalog,
});

/** The app's one Quran audio engine (audio/engine.ts) over its one native player. */
export const audioEngine = createPlaybackEngine({
  output: createExpoOutput(undefined, INDEX_SEEK_URLS),
  timing: timingLoader,
  // A downloaded, verified surah plays from the device (no network); anything else streams from the source registry
  // (MP3Quran first), only where the registry says the surah may play for this reciter, and how (by ayah, or whole).
  resolveSource: localFirstSource(audioFiles),
  capability: (reciter, surah) => audioMode(reciter.id, surah),
  // Before a stream that needs it plays: still the verified file (no redirect to another Sheikh, the verified size)?
  // A published recording's host answered byte ranges when the review service checked it (Phase 4.8.3).
  checkStream: (uri, bytes) => {
    const source = SOURCE_REGISTRY.sourceByUrl(uri);
    const published = verifiedCatalog.byUrl(uri);
    return streamCheck(uri, bytes ?? source?.bytes ?? published?.audio.bytes ?? null, { rangeRequests: source?.format.rangeRequests === true || published !== null });
  },
  describe(position, reciter) {
    const name = getSurahName(position.surah);
    // Whole-surah playback: the ayah is unknown, so only the surah is named.
    if (position.ayah < 1) return lockScreenRtl ? { title: name.nameArabic, artist: reciter.nameAr } : { title: name.nameEnglish, artist: reciter.nameEn };
    return lockScreenRtl
      ? { title: `${name.nameArabic} ${toArabicDigits(position.ayah)}`, artist: reciter.nameAr }
      : { title: `${name.nameEnglish} ${position.surah}:${position.ayah}`, artist: reciter.nameEn };
  },
});

// Phase 4.8.3: a new published version never replaces the timing of the surah being played: it waits until playback
// leaves that surah (or stops), and the manifest is refreshed (at most every 15 minutes) whenever a surah starts loading.
verifiedCatalog.setInUse(() => {
  const s = audioEngine.getState();
  return s.position && s.reciterId && (s.phase === 'loading' || s.phase === 'playing' || s.phase === 'paused') ? `${s.reciterId}:${s.position.surah}` : null;
});
let lastPhase: string | null = null;
audioEngine.subscribe((s) => {
  if (s.phase !== lastPhase) devLog('audio', `phase ${s.phase}`, { position: s.position, reciterId: s.reciterId, error: s.error });
  verifiedCatalog.settle();
  if (s.phase === 'loading' && lastPhase !== 'loading') void verifiedCatalog.refresh().catch(() => undefined);
  lastPhase = s.phase;
});

export const audioDownloads = createAudioDownloads({ files: audioFiles, timing: timingLoader });
export { audioFiles };
