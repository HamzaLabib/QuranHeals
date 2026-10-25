import type { DownloadState } from './downloads';
import { timedSurahs, type Reciter } from './reciters';

export type ReciterDownloadStatus = 'none' | 'partial' | 'downloading' | 'paused' | 'complete' | 'error' | 'not-permitted' | 'unavailable';

/**
 * The Favorite Reciter's offline state, for its compact icon:
 *  - 'complete' only when every surah the reciter can play is stored as a verified file (audio/storage.ts counts a file
 *    only at its exact audited size, and a download only becomes that file after its size and MP3 header check);
 *  - 'downloading' / 'paused' / 'error' for this reciter's download;
 *  - 'unavailable': nothing to download (no surah with verified timing);
 *  - 'not-permitted': downloads are off for this reciter (the app's switch or its provider), unless verified files are
 *    already stored;
 *  - 'partial' / 'none' otherwise.
 */
export function reciterDownloadStatus(args: { permitted: boolean; reciter: Reciter; stored: readonly number[]; download: DownloadState }): ReciterDownloadStatus {
  const { permitted, reciter, stored, download } = args;
  const timed = timedSurahs(reciter);
  const mine = download.reciterId === reciter.id ? download : null;
  if (mine?.phase === 'running') return 'downloading';
  if (mine?.phase === 'paused') return 'paused';
  if (timed.length === 0) return 'unavailable';
  const storedTimed = stored.filter((surah) => reciter.timed[surah] !== undefined).length;
  if (storedTimed >= timed.length) return 'complete';
  if (!permitted || mine?.error === 'not-permitted') return 'not-permitted';
  if (mine?.phase === 'error') return 'error';
  return storedTimed > 0 ? 'partial' : 'none';
}
