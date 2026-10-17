import { getReciter, OFFLINE_DOWNLOADS_PERMITTED, surahAudioUrl, timedSurahs, type Reciter } from './reciters';
import type { TimingLoader } from './timing';

/**
 * Offline listening (Settings → Quran → Favorite Reciter → Download): the user downloads their Favorite Reciter's
 * recordings — only the surahs that can play ayah by ayah (verified timing), each verified before it counts — into
 * the app's documents (persistent; never a cache the system may clear). Nothing is ever downloaded automatically, and
 * only one reciter downloads at a time. A download can be paused and resumed while the app is open, cancelled (the
 * surahs already finished stay), retried, and resumed after a restart from the next unfinished surah. Deleting removes
 * a reciter's files. Playback uses a downloaded surah's file without any network request (audio/index.ts).
 */

/** One file being downloaded: its promise settles with true (complete), false (paused) or rejects (failed / cancelled). */
export type FileDownload = {
  done: Promise<boolean>;
  pause(): void;
  resume(): Promise<boolean>;
  cancel(): void;
};

export type AudioFiles = {
  /** The surahs of this reciter stored and verified on the device. */
  stored(reciterId: string): Promise<number[]>;
  /** The verified file's URI, or null. */
  uri(reciterId: string, surah: number): Promise<string | null>;
  /** Bytes stored for a reciter. */
  bytes(reciterId: string): Promise<number>;
  /** Reciters with anything stored. */
  reciters(): Promise<string[]>;
  /** Starts downloading into a partial file. */
  download(url: string, reciterId: string, surah: number, onProgress: (bytes: number) => void): Promise<FileDownload>;
  /** Checks the partial file (size and MP3 header) and makes it the stored file; false (and removed) if it fails. */
  commit(reciterId: string, surah: number, expectedBytes: number): Promise<boolean>;
  discardPartial(reciterId: string, surah: number): Promise<void>;
  remove(reciterId: string): Promise<void>;
  freeBytes(): Promise<number | null>;
};

export type DownloadPhase = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export type DownloadState = {
  reciterId: string | null;
  phase: DownloadPhase;
  /** Surahs this download stores (the reciter's timed surahs). */
  surahs: readonly number[];
  completed: readonly number[];
  current: number | null;
  bytesDone: number;
  bytesTotal: number;
  error: 'network' | 'storage' | 'verify' | 'not-permitted' | null;
};

export const IDLE_DOWNLOAD: DownloadState = { reciterId: null, phase: 'idle', surahs: [], completed: [], current: null, bytesDone: 0, bytesTotal: 0, error: null };

/** Whether a file's first bytes are an MP3's: an ID3 tag or an MPEG audio frame sync. An error page never is. */
export function looksLikeMp3(head: Uint8Array): boolean {
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  return head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
}

/** Kept free beyond the download itself. */
export const FREE_SPACE_MARGIN_BYTES = 200 * 1024 * 1024;

export function createAudioDownloads(deps: { files: AudioFiles; timing: TimingLoader; permitted?: () => boolean }) {
  const { files } = deps;
  /** The licensing gate (reciters.ts OFFLINE_DOWNLOADS_PERMITTED); injectable for tests only. */
  const permitted = deps.permitted ?? (() => OFFLINE_DOWNLOADS_PERMITTED);
  let state: DownloadState = IDLE_DOWNLOAD;
  const listeners = new Set<(state: DownloadState) => void>();
  let active: FileDownload | null = null;
  let runToken = 0;
  /** Bumped whenever stored files change (a surah finished, a reciter deleted): screens re-read the storage. */
  let storageVersion = 0;

  const set = (patch: Partial<DownloadState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const sizeOf = (reciter: Reciter, surahs: readonly number[]) => surahs.reduce((sum, surah) => sum + (reciter.timed[surah]?.[1] ?? 0), 0);

  const run = async (reciter: Reciter) => {
    const mine = ++runToken;
    const surahs = timedSurahs(reciter);
    const completed = new Set(await files.stored(reciter.id));
    const remaining = surahs.filter((surah) => !completed.has(surah));
    const bytesTotal = sizeOf(reciter, surahs);
    set({ reciterId: reciter.id, phase: 'running', surahs, completed: surahs.filter((s) => completed.has(s)), current: null, bytesDone: sizeOf(reciter, [...completed]), bytesTotal, error: null });
    const free = await files.freeBytes();
    if (mine !== runToken) return;
    if (free !== null && free < sizeOf(reciter, remaining) + FREE_SPACE_MARGIN_BYTES) {
      set({ phase: 'error', error: 'storage' });
      return;
    }
    for (const surah of remaining) {
      if (mine !== runToken) return;
      const expected = reciter.timed[surah][1];
      const before = state.bytesDone;
      set({ current: surah });
      // The timing first (small): stored and verified, so the surah plays offline once its audio is in.
      const timing = await deps.timing.load(reciter, surah);
      if (mine !== runToken) return;
      if (!timing.ok) {
        set({ phase: 'error', error: timing.reason === 'network' ? 'network' : 'verify' });
        return;
      }
      let download: FileDownload;
      let finished: boolean;
      try {
        download = await files.download(surahAudioUrl(reciter, surah), reciter.id, surah, (bytes) => {
          if (mine === runToken) set({ bytesDone: before + Math.min(bytes, expected) });
        });
        if (mine !== runToken) {
          download.cancel();
          return;
        }
        active = download;
        finished = await download.done;
        // Paused: wait for resume() (or a cancel), then for the resumed transfer.
        while (!finished) {
          if (!resumed) await new Promise<void>((resolve) => { resumeSignal = resolve; });
          if (mine !== runToken || !resumed) return;
          const next: Promise<boolean> = resumed;
          resumed = null;
          finished = await next;
        }
      } catch {
        active = null;
        if (mine !== runToken) return;
        await files.discardPartial(reciter.id, surah).catch(() => undefined);
        set({ phase: 'error', error: 'network', bytesDone: before });
        return;
      }
      active = null;
      if (mine !== runToken) return;
      if (!(await files.commit(reciter.id, surah, expected))) {
        set({ phase: 'error', error: 'verify', bytesDone: before });
        return;
      }
      storageVersion++;
      set({ completed: [...state.completed, surah].sort((a, b) => a - b), bytesDone: before + expected });
    }
    if (mine === runToken) set({ phase: 'completed', current: null });
  };

  /** The resumed transfer of a paused file (set by resume(), taken by run()). */
  let resumed: Promise<boolean> | null = null;
  /** Wakes run() while it waits for a resume or a cancel. */
  let resumeSignal: (() => void) | null = null;
  const wake = () => {
    const signal = resumeSignal;
    resumeSignal = null;
    signal?.();
  };

  const api = {
    getState: () => state,
    getStorageVersion: () => storageVersion,
    subscribe(listener: (state: DownloadState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Downloads (or continues) a reciter. Only one at a time: another reciter's download is cancelled first. */
    start(reciterId: string) {
      const reciter = getReciter(reciterId);
      if (!reciter) return;
      if (!permitted()) {
        set({ ...IDLE_DOWNLOAD, reciterId, phase: 'error', error: 'not-permitted' });
        return;
      }
      if (state.phase === 'running' && state.reciterId === reciterId) return;
      if (state.phase === 'paused' && state.reciterId === reciterId) {
        api.resume();
        return;
      }
      api.cancel();
      void run(reciter);
    },

    pause() {
      if (state.phase !== 'running' || !active) return;
      active.pause();
      set({ phase: 'paused' });
    },

    resume() {
      if (state.phase !== 'paused' || !active) return;
      set({ phase: 'running' });
      resumed = active.resume();
      // A failure is handled by run() once it takes this promise; never an unhandled rejection meanwhile.
      resumed.catch(() => undefined);
      wake();
    },

    /** Stops the download; the surahs already finished stay stored. */
    cancel() {
      if (state.phase !== 'running' && state.phase !== 'paused') return;
      runToken++;
      const download = active;
      active = null;
      download?.cancel();
      resumed = null;
      wake();
      const { reciterId, current } = state;
      if (reciterId && current !== null) void files.discardPartial(reciterId, current).catch(() => undefined);
      set({ phase: 'cancelled', current: null });
    },

    /** Deletes everything stored for a reciter (and stops its download). */
    async remove(reciterId: string) {
      if (state.reciterId === reciterId) {
        api.cancel();
        set(IDLE_DOWNLOAD);
      }
      await files.remove(reciterId);
      storageVersion++;
      for (const listener of listeners) listener(state);
    },

    /** Bytes the download of `reciterId` stores in all (its timed surahs). */
    totalBytes(reciterId: string) {
      const reciter = getReciter(reciterId);
      return reciter ? sizeOf(reciter, timedSurahs(reciter)) : 0;
    },
  };
  return api;
}

export type AudioDownloads = ReturnType<typeof createAudioDownloads>;
