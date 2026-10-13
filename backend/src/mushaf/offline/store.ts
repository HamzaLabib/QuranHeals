import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { QfEnvironment } from '../../quranFoundation/qfContentClient';
import { DATASET_SCHEMA, MUSHAF_RESOURCE, type DatasetChunk, type DatasetReport, type RawRecord, type RecordSet } from './dataset';

/**
 * File store for the backend's Content Sync copy of mushafs:2 (no database).
 *
 *   <dir>/state.json                 the only pointer: sync cursor, current version
 *   <dir>/records-<sequence>.json.gz the raw rows at that sync sequence (to apply later changes)
 *   <dir>/versions/<version>/        immutable, published only when complete:
 *       manifest.json, chunks/<index>.json.gz
 *
 * Every write goes to a temporary name and is renamed into place; state.json
 * is replaced last. An interrupted sync therefore never exposes a partial
 * dataset: readers keep the previous version until the new one is whole.
 */

export type SyncState = {
  schema: 1;
  resource: string;
  environment: QfEnvironment;
  /** Content Sync cursor from the final page of the last completed sync (a cursor, not a credential). */
  syncToken: string | null;
  /** Highest change sequence applied to the records. */
  appliedSequence: number;
  /** sync_sequence of the snapshot the records started from, and when it was fetched. */
  snapshotSequence: number;
  snapshotFetchedAt: string;
  recordsFile: string;
  /** The published version devices download; null until a state of the records passes validation. */
  currentVersion: string | null;
  /** Why the records' current state is not published (validation), if it isn't. The last valid version stays. */
  validationError?: string;
  /** Last time a sync completed (changes applied, or none were pending). */
  lastSuccessAt: string;
  /** The resource was deleted upstream: nothing is offered for download. */
  deleted?: boolean;
};

export type ManifestChunk = { index: number; firstPage: number; lastPage: number; sha256: string; bytes: number };

export type OfflineManifest = {
  schema: typeof DATASET_SCHEMA;
  edition: 'qpc-v1';
  version: string;
  mushaf: { id: number; name: string; description: string; pagesCount: number; linesPerPage: number; defaultFontName: string };
  verses: number;
  words: number;
  source: { provider: 'Quran Foundation'; resource: string; snapshotSequence: number; appliedSequence: number };
  /** When this version was published, and when the backend last synced with Quran Foundation. */
  publishedAt: string;
  syncedAt: string;
  attribution: string;
  chunks: ManifestChunk[];
  totalBytes: number;
  report: Pick<DatasetReport, 'wordTypes'>;
};

const writeAtomically = async (path: string, data: string | Buffer) => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
};

const VERSION_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

class InvalidPublishedVersionError extends Error {}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isDestinationConflict(error: unknown): boolean {
  return hasErrorCode(error, 'EEXIST') || hasErrorCode(error, 'ENOTEMPTY') || (process.platform === 'win32' && hasErrorCode(error, 'EPERM'));
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createMushafSyncStore(dir: string) {
  const versionsDir = join(dir, 'versions');
  let manifestCache: { version: string; manifest: OfflineManifest } | null = null;

  async function readState(): Promise<SyncState | null> {
    try {
      const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as SyncState;
      return state.schema === 1 && state.resource === `${MUSHAF_RESOURCE.group}:${MUSHAF_RESOURCE.id}` ? state : null;
    } catch {
      return null;
    }
  }

  async function readRecords(state: SyncState): Promise<RecordSet | null> {
    try {
      const rows = JSON.parse(gunzipSync(await readFile(join(dir, state.recordsFile))).toString('utf8')) as RawRecord[];
      const set: RecordSet = { mushaf: null, pages: new Map(), words: new Map() };
      for (const row of rows) {
        if (row.record_type === 'mushaf') set.mushaf = row;
        else if (row.record_type === 'mushaf_page') set.pages.set(row.id as number, row);
        else if (row.record_type === 'mushaf_word') set.words.set(row.id as number, row);
      }
      return set;
    } catch {
      return null;
    }
  }

  async function writeVersion(version: string, manifest: OfflineManifest, chunks: readonly DatasetChunk[]) {
    const final = join(versionsDir, version);

    async function existingVersionIsComplete(): Promise<boolean> {
      let existing: OfflineManifest;
      try {
        existing = JSON.parse(await readFile(join(final, 'manifest.json'), 'utf8')) as OfflineManifest;
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) {
          try {
            await readdir(final);
          } catch (directoryError) {
            if (hasErrorCode(directoryError, 'ENOENT')) return false;
            throw directoryError;
          }
          throw new InvalidPublishedVersionError(`Existing Mushaf version ${version} has no manifest`);
        }
        if (error instanceof SyntaxError) throw new InvalidPublishedVersionError(`Existing Mushaf version ${version} has an invalid manifest`);
        throw error;
      }

      const invalidVersion = () => new InvalidPublishedVersionError(`Existing Mushaf version ${version} is incomplete or does not match its content address`);
      const expectedChunks = manifest.chunks;
      if (existing.version !== version || !Array.isArray(existing.chunks) || existing.chunks.length !== chunks.length) throw invalidVersion();

      for (const [position, chunk] of chunks.entries()) {
        const metadata = existing.chunks[position];
        if (
          metadata?.index !== chunk.index ||
          metadata.firstPage !== chunk.firstPage ||
          metadata.lastPage !== chunk.lastPage ||
          metadata.sha256 !== chunk.sha256 ||
          metadata.bytes !== chunk.bytes ||
          expectedChunks[position]?.sha256 !== chunk.sha256
        ) throw invalidVersion();

        let content: Buffer;
        try {
          content = gunzipSync(await readFile(join(final, 'chunks', `${chunk.index}.json.gz`)));
        } catch (error) {
          if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'Z_DATA_ERROR') || hasErrorCode(error, 'Z_BUF_ERROR')) throw invalidVersion();
          throw error;
        }
        const digest = createHash('sha256').update(content).digest('hex');
        if (content.toString('utf8') !== chunk.json || content.byteLength !== chunk.bytes || digest !== chunk.sha256) throw invalidVersion();
      }
      return true;
    }

    async function reuseOrRemoveInvalidVersion(): Promise<boolean> {
      try {
        return await existingVersionIsComplete();
      } catch (error) {
        if (!(error instanceof InvalidPublishedVersionError)) throw error;
        await rm(final, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        return false;
      }
    }

    if (await reuseOrRemoveInvalidVersion()) return; // Already published (same content): versions are immutable.

    const temporary = `${final}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(join(temporary, 'chunks'), { recursive: true });
      for (const chunk of chunks) await writeFile(join(temporary, 'chunks', `${chunk.index}.json.gz`), gzipSync(chunk.json, { level: 9 }));
      await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest));

      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, final);
          return;
        } catch (error) {
          if (!isDestinationConflict(error)) throw error;
          if (await reuseOrRemoveInvalidVersion()) {
            await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
            return; // Another publisher won the same immutable version.
          }
          if (process.platform !== 'win32' || !hasErrorCode(error, 'EPERM') || attempt >= VERSION_RENAME_RETRY_DELAYS_MS.length) throw error;
          await pause(VERSION_RENAME_RETRY_DELAYS_MS[attempt]);
        }
      }
    } catch (error) {
      try {
        await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Mushaf version ${version} publication failed and its staging directory could not be removed`);
      }
      throw error;
    }
  }

  return {
    dir,
    readState,
    readRecords,

    /**
     * Writes the records (the Content Sync copy) and, when it validated, a
     * complete new version; then points state.json at them.
     */
    async commit(next: { state: SyncState; records: RecordSet; published?: { manifest: OfflineManifest; chunks: readonly DatasetChunk[] } }) {
      await mkdir(versionsDir, { recursive: true });
      if (next.published) await writeVersion(next.published.manifest.version, next.published.manifest, next.published.chunks);
      const rows = [next.records.mushaf, ...next.records.pages.values(), ...next.records.words.values()].filter(Boolean);
      await writeAtomically(join(dir, next.state.recordsFile), gzipSync(JSON.stringify(rows)));
      const previous = await readState();
      await writeAtomically(join(dir, 'state.json'), JSON.stringify(next.state, null, 1));
      manifestCache = null;
      // Old records are no longer needed; keep the last three versions for downloads in progress.
      if (previous && previous.recordsFile !== next.state.recordsFile) await rm(join(dir, previous.recordsFile), { force: true });
      await this.prune(3);
    },

    /** A sync that found nothing new: only the time of the last success (and cursor) changes. */
    async touch(state: SyncState) {
      await writeAtomically(join(dir, 'state.json'), JSON.stringify(state, null, 1));
      manifestCache = null;
    },

    async prune(keep: number) {
      const state = await readState();
      let entries: string[] = [];
      try {
        entries = await readdir(versionsDir);
      } catch {
        return;
      }
      for (const entry of entries.filter((name) => name.endsWith('.tmp'))) await rm(join(versionsDir, entry), { recursive: true, force: true });
      const versions: { name: string; at: number }[] = [];
      for (const name of entries.filter((entry) => !entry.endsWith('.tmp'))) {
        try {
          const manifest = JSON.parse(await readFile(join(versionsDir, name, 'manifest.json'), 'utf8')) as OfflineManifest;
          versions.push({ name, at: Date.parse(manifest.publishedAt) });
        } catch {
          await rm(join(versionsDir, name), { recursive: true, force: true });
        }
      }
      versions.sort((a, b) => b.at - a.at);
      for (const { name } of versions.slice(keep)) if (name !== state?.currentVersion) await rm(join(versionsDir, name), { recursive: true, force: true });
    },

    /** The manifest of the current version, with the latest sync time; null when nothing is published. */
    async currentManifest(): Promise<OfflineManifest | null> {
      const state = await readState();
      if (!state || state.deleted || !state.currentVersion) return null;
      if (manifestCache?.version !== state.currentVersion) {
        try {
          manifestCache = { version: state.currentVersion, manifest: JSON.parse(await readFile(join(versionsDir, state.currentVersion, 'manifest.json'), 'utf8')) as OfflineManifest };
        } catch {
          return null;
        }
      }
      return { ...manifestCache!.manifest, syncedAt: state.lastSuccessAt };
    },

    /** A chunk of a published version, gzip-compressed, or null. Versions are hex; indexes are small integers. */
    async readChunk(version: string, index: number): Promise<Buffer | null> {
      if (!/^[0-9a-f]{24}$/.test(version) || !Number.isInteger(index) || index < 0 || index > 99) return null;
      try {
        return await readFile(join(versionsDir, version, 'chunks', `${index}.json.gz`));
      } catch {
        return null;
      }
    },
  };
}

export type MushafSyncStore = ReturnType<typeof createMushafSyncStore>;
