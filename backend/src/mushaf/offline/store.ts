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
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
};

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
    try {
      await readFile(join(final, 'manifest.json'));
      return; // Already published (same content): versions are immutable.
    } catch { /* not yet */ }
    const temporary = `${final}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(join(temporary, 'chunks'), { recursive: true });
    for (const chunk of chunks) await writeFile(join(temporary, 'chunks', `${chunk.index}.json.gz`), gzipSync(chunk.json, { level: 9 }));
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest));
    await rm(final, { recursive: true, force: true });
    await rename(temporary, final);
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
