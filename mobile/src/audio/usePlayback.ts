import { useEffect, useState, useSyncExternalStore } from 'react';

import { audioDownloads, audioEngine, audioFiles } from './index';
import type { DownloadState } from './downloads';
import type { PlaybackState, SurahProgress } from './engine';

/** The playback state, re-rendering on every change (one store for the whole app). */
export function usePlayback(): PlaybackState {
  return useSyncExternalStore(audioEngine.subscribe, audioEngine.getState, audioEngine.getState);
}

/** Whole-surah playback's place in the file. Only the player's position bar uses it (it changes several times a second). */
export function useSurahProgress(): SurahProgress {
  return useSyncExternalStore(audioEngine.subscribeProgress, audioEngine.getProgress, audioEngine.getProgress);
}

export function useAudioDownload(): DownloadState {
  return useSyncExternalStore(audioDownloads.subscribe, audioDownloads.getState, audioDownloads.getState);
}

/** What is stored on the device: per reciter, its surahs and bytes (re-read after every download change). */
export function useStoredAudio(): { reciters: { id: string; surahs: number[]; bytes: number }[]; totalBytes: number } {
  const download = useAudioDownload();
  const version = audioDownloads.getStorageVersion();
  const [stored, setStored] = useState<{ reciters: { id: string; surahs: number[]; bytes: number }[]; totalBytes: number }>({ reciters: [], totalBytes: 0 });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await audioFiles.reciters();
      const reciters = await Promise.all(ids.map(async (id) => ({ id, surahs: await audioFiles.stored(id), bytes: await audioFiles.bytes(id) })));
      if (!cancelled) setStored({ reciters, totalBytes: reciters.reduce((sum, r) => sum + r.bytes, 0) });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [version, download.phase, download.completed.length]);
  return stored;
}
