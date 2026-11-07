import type { TafsirEditionId } from './editions';

/**
 * Downloaded tafsir editions on the device, in the app's documents (kept across launches, never purged by the system):
 *   <documents>/tafsir/<edition>/<sha256>.json        the verified edition (its name IS its pinned SHA-256)
 *   <documents>/tafsir/<edition>/<sha256>.json.part   a download in progress, never read
 * A download only becomes <sha256>.json after its size and SHA-256 matched the app's pin (commit); an interrupted or
 * altered download is deleted and never read, and any other file in the folder (an older version) is ignored.
 * expo-file-system and expo-crypto are loaded on first use, as audio/storage.ts does.
 */
export type TafsirFileDownload = {
  done: Promise<boolean>;
  cancel: () => void;
};

export interface TafsirFileStore {
  /** Whether the verified file is on the device (exact name and size). */
  has(edition: TafsirEditionId, sha256: string, bytes: number): Promise<boolean>;
  /** The verified file's text, or null. */
  read(edition: TafsirEditionId, sha256: string): Promise<string | null>;
  /** Starts downloading into the .part file (any old .part is deleted first). */
  download(url: string, edition: TafsirEditionId, sha256: string, onProgress: (bytesWritten: number) => void): Promise<TafsirFileDownload>;
  /** Checks the .part file's size and SHA-256 and, only if both match, makes it the edition's file. Deletes it otherwise. */
  commit(edition: TafsirEditionId, sha256: string, bytes: number): Promise<boolean>;
  /** Deletes a .part file left by an interrupted download. */
  discardPartial(edition: TafsirEditionId, sha256: string): Promise<void>;
  /** Deletes the edition's file (after it failed to parse, or on removal). */
  remove(edition: TafsirEditionId): Promise<void>;
}

type Fs = typeof import('expo-file-system');
let fsModule: Promise<Fs> | null = null;
const fs = () => (fsModule ??= import('expo-file-system'));

const SHA256 = /^[0-9a-f]{64}$/;

const paths = (m: Fs, edition: TafsirEditionId, sha256: string) => {
  if (!SHA256.test(sha256)) throw new Error('bad pin');
  const dir = new m.Directory(m.Paths.document, 'tafsir', edition);
  return { dir, file: new m.File(dir, `${sha256}.json`), part: new m.File(dir, `${sha256}.json.part`) };
};

export function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const tafsirFileStore: TafsirFileStore = {
  async has(edition, sha256, bytes) {
    try {
      const m = await fs();
      const { file } = paths(m, edition, sha256);
      return file.exists && file.size === bytes;
    } catch {
      return false;
    }
  },
  async read(edition, sha256) {
    const m = await fs();
    const { file } = paths(m, edition, sha256);
    return file.exists ? file.text() : null;
  },
  async download(url, edition, sha256, onProgress) {
    const m = await fs();
    const { dir, part } = paths(m, edition, sha256);
    if (!dir.exists) dir.create({ intermediates: true });
    // iOS: <documents>/tafsir stays out of iCloud backups (re-downloadable content).
    void import('@/services/backupExclusion').then(({ excludeDownloadDirectoriesFromBackup }) => excludeDownloadDirectoriesFromBackup()).catch(() => undefined);
    if (part.exists) part.delete();
    const task = m.File.createDownloadTask(url, part, { onProgress: ({ bytesWritten }) => onProgress(bytesWritten) });
    return {
      done: task.downloadAsync().then((file) => file !== null),
      cancel: () => task.cancel(),
    };
  },
  async commit(edition, sha256, bytes) {
    const m = await fs();
    const { file, part } = paths(m, edition, sha256);
    if (!part.exists) return false;
    let ok = part.size === bytes;
    if (ok) {
      try {
        const Crypto = await import('expo-crypto');
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await part.arrayBuffer());
        ok = hex(digest) === sha256;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      part.delete();
      return false;
    }
    await part.move(file, { overwrite: true });
    return true;
  },
  async discardPartial(edition, sha256) {
    const m = await fs();
    const { part } = paths(m, edition, sha256);
    if (part.exists) part.delete();
  },
  async remove(edition) {
    const m = await fs();
    const dir = new m.Directory(m.Paths.document, 'tafsir', edition);
    if (dir.exists) dir.delete();
  },
};
