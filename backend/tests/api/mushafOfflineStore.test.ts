import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const filesystemMock = vi.hoisted(() => ({
  failures: 0,
  errorCode: 'EPERM',
  versionRenameAttempts: 0,
  manifestReadFailures: 0,
  publishWinnerBeforeFailure: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
      if (filesystemMock.manifestReadFailures > 0 && String(path).endsWith('manifest.json')) {
        filesystemMock.manifestReadFailures--;
        throw Object.assign(new Error('simulated manifest file lock'), { code: 'EPERM' });
      }
      return options === undefined ? actual.readFile(path) : actual.readFile(path, options);
    }),
    rename: vi.fn(async (source: Parameters<typeof actual.rename>[0], destination: Parameters<typeof actual.rename>[1]) => {
      const isVersionRename = String(source).endsWith('.tmp') && String(destination).includes('versions');
      if (isVersionRename) {
        filesystemMock.versionRenameAttempts++;
        if (filesystemMock.failures > 0) {
          filesystemMock.failures--;
          if (filesystemMock.publishWinnerBeforeFailure) {
            filesystemMock.publishWinnerBeforeFailure = false;
            await actual.cp(String(source), String(destination), { recursive: true });
          }
          throw Object.assign(new Error('simulated transient filesystem lock'), { code: filesystemMock.errorCode });
        }
      }
      return actual.rename(source, destination);
    }),
  };
});

import { DATASET_SCHEMA, datasetVersion, emptyRecordSet, type DatasetChunk } from '../../src/mushaf/offline/dataset';
import { createMushafSyncStore, type OfflineManifest, type SyncState } from '../../src/mushaf/offline/store';

describe('Mushaf offline store publication', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mushaf-store-'));
    filesystemMock.failures = 0;
    filesystemMock.errorCode = 'EPERM';
    filesystemMock.versionRenameAttempts = 0;
    filesystemMock.manifestReadFailures = 0;
    filesystemMock.publishWinnerBeforeFailure = false;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });

  function makeCommit() {
    const json = JSON.stringify({ schema: DATASET_SCHEMA, index: 0, firstPage: 1, lastPage: 1, pages: [] });
    const chunk: DatasetChunk = {
      index: 0,
      firstPage: 1,
      lastPage: 1,
      sha256: createHash('sha256').update(json).digest('hex'),
      bytes: Buffer.byteLength(json),
      json,
    };
    const version = datasetVersion([chunk]);
    const manifest: OfflineManifest = {
      schema: DATASET_SCHEMA,
      edition: 'qpc-v1',
      version,
      mushaf: { id: 2, name: 'synthetic', description: '', pagesCount: 1, linesPerPage: 15, defaultFontName: 'synthetic' },
      verses: 1,
      words: 0,
      source: { provider: 'Quran Foundation', resource: 'mushafs:2', snapshotSequence: 1, appliedSequence: 1 },
      publishedAt: '2026-10-13T00:00:00.000Z',
      syncedAt: '2026-10-13T00:00:00.000Z',
      attribution: 'synthetic test data',
      chunks: [{ index: chunk.index, firstPage: chunk.firstPage, lastPage: chunk.lastPage, sha256: chunk.sha256, bytes: chunk.bytes }],
      totalBytes: chunk.bytes,
      report: { wordTypes: {} },
    };
    const state: SyncState = {
      schema: 1,
      resource: 'mushafs:2',
      environment: 'production',
      syncToken: 'synthetic-token',
      appliedSequence: 1,
      snapshotSequence: 1,
      snapshotFetchedAt: '2026-10-13T00:00:00.000Z',
      recordsFile: 'records-1.json.gz',
      currentVersion: version,
      lastSuccessAt: '2026-10-13T00:00:00.000Z',
    };
    return { state, records: emptyRecordSet(), published: { manifest, chunks: [chunk] }, chunk };
  }

  it.skipIf(process.platform !== 'win32')('retries a transient EPERM while atomically publishing a complete version', async () => {
    filesystemMock.failures = 1;
    const commit = makeCommit();
    await createMushafSyncStore(dir).commit(commit);

    expect(filesystemMock.versionRenameAttempts).toBe(2);
    expect(await createMushafSyncStore(dir).currentManifest()).toMatchObject({ version: commit.published.manifest.version });
    const storedChunk = await createMushafSyncStore(dir).readChunk(commit.published.manifest.version, 0);
    expect(storedChunk).not.toBeNull();
    expect(gunzipSync(storedChunk!).toString('utf8')).toBe(commit.chunk.json);
    expect((await readdir(join(dir, 'versions'))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('reuses a verified version published by a concurrent writer', async () => {
    filesystemMock.failures = 1;
    filesystemMock.errorCode = 'EEXIST';
    filesystemMock.publishWinnerBeforeFailure = true;
    const commit = makeCommit();

    await createMushafSyncStore(dir).commit(commit);

    expect(filesystemMock.versionRenameAttempts).toBe(1);
    expect(await createMushafSyncStore(dir).currentManifest()).toMatchObject({ version: commit.published.manifest.version });
    const storedChunk = await createMushafSyncStore(dir).readChunk(commit.published.manifest.version, 0);
    expect(storedChunk).not.toBeNull();
    expect(gunzipSync(storedChunk!).toString('utf8')).toBe(commit.chunk.json);
    expect((await readdir(join(dir, 'versions'))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not retry unrelated permission errors and removes its staging directory', async () => {
    filesystemMock.failures = 1;
    filesystemMock.errorCode = 'EACCES';
    const commit = makeCommit();

    await expect(createMushafSyncStore(dir).commit(commit)).rejects.toMatchObject({ code: 'EACCES' });
    expect(filesystemMock.versionRenameAttempts).toBe(1);
    expect((await readdir(join(dir, 'versions'))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    expect(await createMushafSyncStore(dir).readState()).toBeNull();
  });

  it('preserves an existing version when reading its manifest gets a transient permission error', async () => {
    const commit = makeCommit();
    await createMushafSyncStore(dir).commit(commit);
    const store = createMushafSyncStore(dir);
    const versionPath = join(dir, 'versions', commit.published.manifest.version);
    const manifestBefore = await readFile(join(versionPath, 'manifest.json'));

    filesystemMock.manifestReadFailures = 1;
    await expect(createMushafSyncStore(dir).commit(commit)).rejects.toMatchObject({ code: 'EPERM' });

    expect(await readFile(join(versionPath, 'manifest.json'))).toEqual(manifestBefore);
    expect(await store.currentManifest()).toMatchObject({ version: commit.published.manifest.version });
  });

  it('rebuilds an incomplete content-addressed version directory', async () => {
    const commit = makeCommit();
    const versionPath = join(dir, 'versions', commit.published.manifest.version);
    await mkdir(versionPath, { recursive: true });
    await writeFile(join(versionPath, 'orphan.tmp'), 'incomplete staging artifact');

    await createMushafSyncStore(dir).commit(commit);

    expect(await createMushafSyncStore(dir).currentManifest()).toMatchObject({ version: commit.published.manifest.version });
    const storedChunk = await createMushafSyncStore(dir).readChunk(commit.published.manifest.version, 0);
    expect(storedChunk).not.toBeNull();
    expect(gunzipSync(storedChunk!).toString('utf8')).toBe(commit.chunk.json);
  });
});