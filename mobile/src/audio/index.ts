import { fetchWithTimeout } from '@/services/fetchWithTimeout';
import { getSurahName } from '@/services/surahNames';

import { createAudioDownloads } from './downloads';
import { createPlaybackEngine } from './engine';
import { createExpoOutput } from './expoOutput';
import { localFirstSource } from './sources';
import { audioFiles, timingStore } from './storage';
import { createTimingLoader } from './timing';

const TIMING_TIMEOUT_MS = 15_000;

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
});

/** The app's one Quran audio engine (audio/engine.ts) over its one native player. */
export const audioEngine = createPlaybackEngine({
  output: createExpoOutput(),
  timing: timingLoader,
  // A downloaded, verified surah plays from the device (no network); anything else streams from MP3Quran.
  resolveSource: localFirstSource(audioFiles),
  describe(position, reciter) {
    const name = getSurahName(position.surah);
    return lockScreenRtl
      ? { title: `${name.nameArabic} ${toArabicDigits(position.ayah)}`, artist: reciter.nameAr }
      : { title: `${name.nameEnglish} ${position.surah}:${position.ayah}`, artist: reciter.nameEn };
  },
});

export const audioDownloads = createAudioDownloads({ files: audioFiles, timing: timingLoader });
export { audioFiles };
