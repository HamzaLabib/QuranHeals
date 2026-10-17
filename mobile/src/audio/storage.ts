import { looksLikeMp3, type AudioFiles, type FileDownload } from './downloads';
import { getReciter, RECITERS } from './reciters';
import type { TimingStore } from './timing';

/**
 * Quran audio on the device, in the app's documents (kept across launches and never purged by the system, unlike the
 * cache directory):
 *   <documents>/quran-audio/timing/<read>/<surah>.json         verified MP3Quran timing (small; kept once fetched)
 *   <documents>/quran-audio/recitations/<reciter>/<surah>.mp3   downloaded surahs (Settings → Download), verified
 * A download writes <surah>.mp3.part and only becomes <surah>.mp3 after its size and header check (commit).
 * expo-file-system is loaded on first use, so screens importing the audio module never load native code before audio
 * is used (and tests run without it), as the offline Mushaf loads expo-sqlite.
 */
type Fs = typeof import('expo-file-system');
let fsModule: Promise<Fs> | null = null;
const fs = () => (fsModule ??= import('expo-file-system'));

const paths = (m: Fs) => {
  const root = new m.Directory(m.Paths.document, 'quran-audio');
  const reciterDir = (reciterId: string) => new m.Directory(root, 'recitations', reciterId);
  return {
    timingDir: (read: number) => new m.Directory(root, 'timing', String(read)),
    reciterDir,
    surahFile: (reciterId: string, surah: number) => new m.File(reciterDir(reciterId), `${surah}.mp3`),
    partFile: (reciterId: string, surah: number) => new m.File(reciterDir(reciterId), `${surah}.mp3.part`),
  };
};

const ensureDir = (dir: { exists: boolean; create(options?: { intermediates?: boolean }): void }) => {
  if (!dir.exists) dir.create({ intermediates: true });
};

export const timingStore: TimingStore = {
  async read(read, surah) {
    const m = await fs();
    const file = new m.File(paths(m).timingDir(read), `${surah}.json`);
    return file.exists ? file.text() : null;
  },
  async write(read, surah, text) {
    const m = await fs();
    const dir = paths(m).timingDir(read);
    ensureDir(dir);
    const file = new m.File(dir, `${surah}.json`);
    if (!file.exists) file.create();
    file.write(text);
  },
};

/** Stored surahs per reciter, read from the directory once and kept in step with every change made here. */
const storedCache = new Map<string, Set<number>>();

async function storedSet(reciterId: string): Promise<Set<number>> {
  const cached = storedCache.get(reciterId);
  if (cached) return cached;
  const set = new Set<number>();
  const reciter = getReciter(reciterId);
  try {
    const m = await fs();
    const dir = paths(m).reciterDir(reciterId);
    if (reciter && dir.exists) {
      for (const entry of dir.list()) {
        if (!(entry instanceof m.File)) continue;
        const match = /^(\d{1,3})\.mp3$/.exec(entry.name);
        if (!match) continue;
        const surah = Number(match[1]);
        // A file counts only if it is still the complete, verified one (its exact size).
        if (reciter.timed[surah] && entry.size === reciter.timed[surah][1]) set.add(surah);
      }
    }
  } catch {
    // Unreadable: nothing stored (playback streams instead).
  }
  storedCache.set(reciterId, set);
  return set;
}

export const audioFiles: AudioFiles = {
  async stored(reciterId) {
    return [...(await storedSet(reciterId))].sort((a, b) => a - b);
  },
  async uri(reciterId, surah) {
    const set = await storedSet(reciterId);
    if (!set.has(surah)) return null;
    const m = await fs();
    const file = paths(m).surahFile(reciterId, surah);
    if (file.exists) return file.uri;
    set.delete(surah);
    return null;
  },
  async bytes(reciterId) {
    const reciter = getReciter(reciterId);
    if (!reciter) return 0;
    return [...(await storedSet(reciterId))].reduce((sum, surah) => sum + (reciter.timed[surah]?.[1] ?? 0), 0);
  },
  async reciters() {
    const ids: string[] = [];
    for (const reciter of RECITERS) if ((await storedSet(reciter.id)).size > 0) ids.push(reciter.id);
    return ids;
  },
  async download(url, reciterId, surah, onProgress): Promise<FileDownload> {
    const m = await fs();
    const p = paths(m);
    ensureDir(p.reciterDir(reciterId));
    const part = p.partFile(reciterId, surah);
    if (part.exists) part.delete();
    const task = m.File.createDownloadTask(url, part, { onProgress: ({ bytesWritten }) => onProgress(bytesWritten) });
    return {
      done: task.downloadAsync().then((file) => file !== null),
      pause: () => task.pause(),
      resume: () => task.resumeAsync().then((file) => file !== null),
      cancel: () => task.cancel(),
    };
  },
  async commit(reciterId, surah, expectedBytes) {
    const m = await fs();
    const p = paths(m);
    const part = p.partFile(reciterId, surah);
    if (!part.exists) return false;
    let ok = part.size === expectedBytes;
    if (ok) {
      try {
        const handle = part.open();
        try {
          ok = looksLikeMp3(handle.readBytes(4));
        } finally {
          handle.close();
        }
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      part.delete();
      return false;
    }
    await part.move(p.surahFile(reciterId, surah), { overwrite: true });
    (await storedSet(reciterId)).add(surah);
    return true;
  },
  async discardPartial(reciterId, surah) {
    const m = await fs();
    const part = paths(m).partFile(reciterId, surah);
    if (part.exists) part.delete();
  },
  async remove(reciterId) {
    const m = await fs();
    const dir = paths(m).reciterDir(reciterId);
    if (dir.exists) dir.delete();
    storedCache.set(reciterId, new Set());
  },
  async freeBytes() {
    try {
      const m = await fs();
      const free = m.Paths.availableDiskSpace;
      return Number.isFinite(free) && free > 0 ? free : null;
    } catch {
      return null;
    }
  },
};
