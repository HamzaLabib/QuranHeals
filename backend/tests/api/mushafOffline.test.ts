import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import {
  chunkDataset,
  compileDataset,
  datasetVersion,
  DatasetError,
  emptyRecordSet,
  JOINED_WORDS,
  mushafWordCount,
  upsertRecord,
  type RawRecord,
} from '../../src/mushaf/offline/dataset';
import { canonicalQuran } from '../../src/mushaf/offline/setup';
import { readSnapshotStream, SnapshotFormatError } from '../../src/mushaf/offline/snapshotStream';
import { createMushafSyncStore } from '../../src/mushaf/offline/store';
import { createMushafSyncService } from '../../src/mushaf/offline/syncService';
import { QfUnavailableError, type QfContentClient } from '../../src/quranFoundation/qfContentClient';
import type { QuranRepository } from '../../src/services/QuranRepository';
import { snapshotStream, syntheticMushafs2Records } from '../helpers/syntheticMushafs2';

/**
 * Offline QPC V1 Mushaf: Content Sync of mushafs:2 on the backend, its
 * validation against the verified Tanzil text, and the relay to the app.
 * All Quran Foundation data here is SYNTHETIC (helpers/syntheticMushafs2.ts).
 */

let base: RawRecord[];
beforeAll(() => {
  base = syntheticMushafs2Records();
});
const clone = (records: RawRecord[]) => records.map((record) => ({ ...record }));
const toSet = (records: RawRecord[]) => {
  const set = emptyRecordSet();
  for (const record of records) upsertRecord(set, record);
  return set;
};
const words = (records: RawRecord[]) => records.filter((record) => record.record_type === 'mushaf_word');

describe('dataset validation (against the verified Tanzil text)', () => {
  it('compiles a complete resource: 604 pages, 6,236 ayahs, words in position_in_page order', () => {
    const dataset = compileDataset(toSet(base), canonicalQuran());
    expect(dataset.report).toMatchObject({ pages: 604, verses: 6236, basmalaPrefixes: 112, joinedWords: 4 });
    expect(dataset.pages[0].words[0]).toEqual([1, 1, 1, 'word', expect.any(String)]);
    // Order is position_in_page even though position_in_line starts each line with its last number.
    const page61 = dataset.pages[60];
    expect(page61.words.map((w) => w[1])).toEqual([...page61.words.map((w) => w[1])].sort((a, b) => a - b));
    expect(dataset.report.wordTypes).toEqual({ word: expect.any(Number), end: 6236 });
  });

  /** Replaces one word record (found once, by id) — keeps the mutators linear. */
  const replaceWord = (records: RawRecord[], pick: (word: RawRecord) => boolean, change: Partial<RawRecord> | null) => {
    const id = words(records).find(pick)!.id;
    return change === null ? records.filter((x) => !(x.record_type === 'mushaf_word' && x.id === id)) : records.map((x) => (x.record_type === 'mushaf_word' && x.id === id ? { ...x, ...change } : x));
  };
  it.each([
    ['a missing page', (r: RawRecord[]) => r.filter((x) => !(x.record_type === 'mushaf_page' && x.page_number === 300)), /603 pages/],
    ['a missing ayah', (r: RawRecord[]) => r.filter((x) => !(x.record_type === 'mushaf_word' && x.verse_id === 4000)), /3:\d+ \(verse 4000\) is missing|ayah .* is missing/],
    ['a duplicated ayah marker', (r: RawRecord[]) => [...r, { ...words(r).find((w) => w.verse_id === 10 && w.char_type_name === 'end')!, id: 9_999_999, position_in_page: 999 }], /position_in_page|markers/],
    ['a word dropped from an ayah', (r: RawRecord[]) => replaceWord(r, (w) => w.verse_id === 4321 && w.position_in_verse === 2, null), /position_in_verse 3 where 2 was expected/],
    ['lines going backwards', (r: RawRecord[]) => replaceWord(r, (w) => w.page_number === 61 && w.position_in_page === 5, { line_number: 15 }), /lines go backwards/],
    ['an unknown word type', (r: RawRecord[]) => replaceWord(r, (w) => w.verse_id === 77, { char_type_name: 'banner' }), /type "banner"/],
    ['a line outside 1–15', (r: RawRecord[]) => replaceWord(r, (w) => w.verse_id === 900, { line_number: 16 }), /line 16/],
    ['the wrong page count', (r: RawRecord[]) => r.map((x) => (x.record_type === 'mushaf' ? { ...x, pages_count: 600 } : x)), /pages_count 600/],
  ])('refuses %s, naming the problem', (_name, mutate, message) => {
    const broken = mutate(clone(base));
    expect(() => compileDataset(toSet(broken), canonicalQuran())).toThrow(DatasetError);
    expect(() => compileDataset(toSet(broken), canonicalQuran())).toThrow(message);
  });

  it('counts first ayahs without their Tanzil basmala (incl. بِّسْمِ in 95:1 and 97:1), and only the documented joined pairs', () => {
    const quran = canonicalQuran();
    const basmala = quran.text('1:1').trim().split(/\s+/);
    const plain = quran.text('2:1').trim().split(/\s+/).length;
    expect(mushafWordCount('2:1', quran.text('2:1'), basmala)).toEqual({ words: plain - 4, basmalaPrefix: true, joined: false });
    for (const key of ['95:1', '97:1']) expect(mushafWordCount(key, quran.text(key), basmala).basmalaPrefix).toBe(true);
    expect(mushafWordCount('1:1', quran.text('1:1'), basmala).basmalaPrefix).toBe(false);
    expect(mushafWordCount('9:1', quran.text('9:1'), basmala).basmalaPrefix).toBe(false);
    for (const key of Object.keys(JOINED_WORDS)) expect(mushafWordCount(key, quran.text(key), basmala).joined).toBe(true);
    // Elsewhere "بَعْدَ مَا" counts as two words.
    expect(mushafWordCount('2:182', quran.text('2:182'), basmala).joined).toBe(false);
  });

  it('chunks are content-addressed: same data, same version; one changed glyph changes one chunk', () => {
    const a = chunkDataset(compileDataset(toSet(base), canonicalQuran()));
    const b = chunkDataset(compileDataset(toSet(clone(base)), canonicalQuran()));
    expect(a).toHaveLength(31);
    expect(datasetVersion(a)).toBe(datasetVersion(b));
    const changed = clone(base).map((x) => (x.record_type === 'mushaf_word' && x.page_number === 450 && x.position_in_page === 3 ? { ...x, text: '' } : x));
    const c = chunkDataset(compileDataset(toSet(changed), canonicalQuran()));
    expect(datasetVersion(c)).not.toBe(datasetVersion(a));
    expect(c.filter((chunk, i) => chunk.sha256 !== a[i].sha256).map((chunk) => chunk.index)).toEqual([22]); // pages 441–460
  });
});

describe('snapshot stream', () => {
  it('reads every record however the bytes are split, and keeps the envelope', async () => {
    const records = [{ record_type: 'mushaf', id: 2, name: 'a "quoted" {brace} \\ name' }, { record_type: 'mushaf_page', id: 1, verse_mapping: { 1: '1-7' } }];
    for (const chunkSize of [1, 2, 3, 7, 64]) {
      const seen: RawRecord[] = [];
      const result = await readSnapshotStream(snapshotStream(records, { chunkSize, sequence: 42 }), (record) => seen.push(record));
      expect(seen).toEqual(records);
      expect(result.envelope).toEqual({ resource_group: 'mushafs', resource_id: 2, resource_content_id: null, schema_version: 1, sync_sequence: 42 });
    }
  });

  it('a body cut off mid-way, or not JSON, is an error — never a shorter dataset', async () => {
    await expect(readSnapshotStream(snapshotStream(base.slice(0, 500), { chunkSize: 4096, failAfterBytes: 20_000 }), () => undefined)).rejects.toThrow('connection reset');
    const truncated = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"resource_group":"mushafs","records":[{"id":1},')); c.close(); } });
    await expect(readSnapshotStream(truncated, () => undefined)).rejects.toThrow(SnapshotFormatError);
    const garbage = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('<html>oops</html>')); c.close(); } });
    await expect(readSnapshotStream(garbage, () => undefined)).rejects.toThrow(SnapshotFormatError);
  });
});

// ── Sync service against a fake Content Sync API ─────────────────────────

type Mutation = Record<string, unknown>;
function fakeContentSync(initial: RawRecord[]) {
  const state = { records: initial, sequence: 100, log: [] as Mutation[], snapshotCalls: 0, failSnapshotAfterBytes: undefined as number | undefined, resyncRequired: false };
  const client: QfContentClient = {
    async get(path) {
      const url = new URL(path, 'https://qf.test');
      if (url.searchParams.get('bootstrap') === 'true') {
        return { sync: { mutations: [{ sequence: state.sequence, type: 'RESOURCE_CREATE', resource_group: 'mushafs', resource_id: 2, snapshot_url: '/api/v4/resources/snapshots/mushafs/2', unavailable_reason: null }], has_more: false, next_sync_token: `t${state.sequence}`, sync_until_sequence: state.sequence } };
      }
      if (state.resyncRequired) throw new QfUnavailableError('gone', 'upstream', { status: 410 });
      const after = Number(url.searchParams.get('sync_token')?.slice(1));
      const pending = state.log.filter((m) => (m.sequence as number) > after);
      // Two pages when there is more than one change, to exercise next_page_url.
      if (pending.length > 1 && !url.searchParams.get('cursor')) {
        return { sync: { mutations: pending.slice(0, 1), has_more: true, next_page_url: `/api/v4/resources/sync?cursor=c1&sync_token=t${after}&resources=mushafs%3A2&per_page=100`, sync_until_sequence: state.sequence } };
      }
      const rest = url.searchParams.get('cursor') ? pending.slice(1) : pending;
      return { sync: { mutations: rest, has_more: false, next_sync_token: `t${state.sequence}`, sync_until_sequence: state.sequence } };
    },
    async stream(path) {
      expect(path).toBe('/content/api/v4/resources/snapshots/mushafs/2');
      state.snapshotCalls++;
      return snapshotStream(state.records, { sequence: state.sequence, failAfterBytes: state.failSnapshotAfterBytes });
    },
  };
  const change = (mutation: Mutation) => {
    state.sequence += 1;
    state.log.push({ resource_group: 'mushafs', resource_id: 2, record_key: null, source_record_id: null, data: null, snapshot_url: null, unavailable_reason: null, record_type: null, ...mutation, sequence: state.sequence });
  };
  return { client, state, change };
}

describe('backend Content Sync and relay', () => {
  let dir: string;
  let clock: number;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mushaf-sync-'));
    clock = Date.parse('2026-10-11T00:00:00Z');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const service = (client: QfContentClient, environment: 'production' | 'prelive' = 'production') =>
    createMushafSyncService({ client, environment, store: createMushafSyncStore(dir), quran: canonicalQuran, now: () => new Date(clock), log: () => undefined });
  const app = () => createApp({ repository: {} as QuranRepository, databaseHealthCheck: async () => true, mushafOfflineStore: createMushafSyncStore(dir) });
  const manifest = async () => (await request(app()).get('/api/mushaf/qpc-v1/offline/manifest')).body.data;

  it('bootstraps from the snapshot, publishes a validated version, and relays it in verified chunks', async () => {
    const qf = fakeContentSync(clone(base));
    expect(await service(qf.client).runSync()).toMatchObject({ status: 'published', snapshot: true });
    const m = await manifest();
    expect(m).toMatchObject({ edition: 'qpc-v1', verses: 6236, mushaf: { id: 2, pagesCount: 604, linesPerPage: 15 }, source: { provider: 'Quran Foundation', resource: 'mushafs:2', snapshotSequence: 100 } });
    expect(m.chunks).toHaveLength(31);
    expect(m.attribution).toMatch(/Quran Foundation/);
    const chunk = await request(app()).get(`/api/mushaf/qpc-v1/offline/versions/${m.version}/chunks/3`).buffer(true).parse((res, done) => {
      const parts: Buffer[] = [];
      res.on('data', (part: Buffer) => parts.push(part));
      res.on('end', () => done(null, Buffer.concat(parts)));
    });
    expect(chunk.headers['content-encoding']).toBe('gzip');
    expect(chunk.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    // supertest may already have inflated it; either way the JSON hashes to the manifest's SHA-256.
    const body = chunk.body as Buffer;
    const text = body[0] === 0x1f ? gunzipSync(body).toString('utf8') : body.toString('utf8');
    expect(createHash('sha256').update(text).digest('hex')).toBe(m.chunks[3].sha256);
    expect(JSON.parse(text)).toMatchObject({ index: 3, firstPage: 61, lastPage: 80 });
  });

  it('nothing is served before a first successful sync, and bad chunk requests are 404s', async () => {
    expect((await request(app()).get('/api/mushaf/qpc-v1/offline/manifest')).status).toBe(503);
    const qf = fakeContentSync(clone(base));
    await service(qf.client).runSync();
    const { version } = await manifest();
    for (const path of [`/versions/${version}/chunks/31`, `/versions/${version}/chunks/-1`, '/versions/zzz/chunks/0', `/versions/${'0'.repeat(24)}/chunks/0`]) {
      expect((await request(app()).get(`/api/mushaf/qpc-v1/offline${path}`)).status).toBe(404);
    }
  });

  it('an interrupted snapshot download publishes nothing and keeps nothing partial', async () => {
    const qf = fakeContentSync(clone(base));
    qf.state.failSnapshotAfterBytes = 2_000_000;
    await expect(service(qf.client).runSync()).rejects.toThrow();
    expect((await request(app()).get('/api/mushaf/qpc-v1/offline/manifest')).status).toBe(503);
    expect(await readdir(dir).catch(() => [])).not.toContain('state.json');
    qf.state.failSnapshotAfterBytes = undefined;
    expect(await service(qf.client).runSync()).toMatchObject({ status: 'published' });
  });

  it('applies row changes in order (over two change pages), publishing a new version only when content changes', async () => {
    const qf = fakeContentSync(clone(base));
    const sync = service(qf.client);
    await sync.runSync();
    const before = await manifest();
    // No changes: the same version, a fresher sync time.
    clock += 60_000;
    expect(await sync.runSync()).toEqual({ status: 'unchanged', version: before.version, mutations: 0 });
    expect(Date.parse((await manifest()).syncedAt)).toBe(clock);
    // A corrected glyph and a css change, applied in sequence order.
    const target = words(base).find((w) => w.page_number === 300 && w.position_in_page === 10)!;
    qf.change({ type: 'ROW_UPDATE', record_type: 'mushaf_word', record_key: target.id, data: { ...target, text: '' } });
    qf.change({ type: 'ROW_UPDATE', record_type: 'mushaf_word', record_key: target.id, data: { ...target, text: '' } });
    expect(await sync.runSync()).toMatchObject({ status: 'published', previousVersion: before.version, mutations: 2, snapshot: false });
    const after = await manifest();
    expect(after.source.appliedSequence).toBe(qf.state.sequence);
    const changedChunks = after.chunks.filter((chunk: { sha256: string }, i: number) => chunk.sha256 !== before.chunks[i].sha256);
    expect(changedChunks.map((chunk: { index: number }) => chunk.index)).toEqual([14]); // pages 281–300
    // The previous version stays downloadable for devices mid-download.
    expect((await request(app()).get(`/api/mushaf/qpc-v1/offline/versions/${before.version}/chunks/0`)).status).toBe(200);
  });

  it('a change that breaks validation is kept but never published; the last valid version is still served', async () => {
    const qf = fakeContentSync(clone(base));
    const sync = service(qf.client);
    await sync.runSync();
    const valid = await manifest();
    const marker = words(base).find((w) => w.verse_id === 2000 && w.char_type_name === 'end')!;
    qf.change({ type: 'ROW_DELETE', record_type: 'mushaf_word', record_key: marker.id });
    const outcome = await sync.runSync();
    expect(outcome).toMatchObject({ status: 'invalid', version: valid.version });
    expect((await manifest()).version).toBe(valid.version);
    // Quran Foundation restores the row: published again, without a new snapshot.
    qf.change({ type: 'ROW_CREATE', record_type: 'mushaf_word', record_key: marker.id, data: marker });
    expect(await sync.runSync()).toMatchObject({ status: 'unchanged', version: valid.version, mutations: 1 });
    expect(qf.state.snapshotCalls).toBe(1);
  });

  it('RESOURCE_INVALIDATE replaces everything from a new snapshot; 410 resync_required bootstraps again', async () => {
    const qf = fakeContentSync(clone(base));
    const sync = service(qf.client);
    await sync.runSync();
    qf.state.records = clone(base).map((x) => (x.record_type === 'mushaf_word' && x.page_number === 604 && x.position_in_page === 1 ? { ...x, text: '' } : x));
    qf.change({ type: 'RESOURCE_INVALIDATE', snapshot_url: '/api/v4/resources/snapshots/mushafs/2' });
    expect(await sync.runSync()).toMatchObject({ status: 'published', snapshot: true });
    expect(qf.state.snapshotCalls).toBe(2);
    qf.state.resyncRequired = true;
    expect(await sync.runSync()).toMatchObject({ status: 'unchanged' });
    expect(qf.state.snapshotCalls).toBe(3);
  });

  it('RESOURCE_DELETE withdraws the offline Mushaf; another environment`s copy is never reused', async () => {
    const qf = fakeContentSync(clone(base));
    await service(qf.client).runSync();
    await service(qf.client, 'prelive').runSync();
    expect(qf.state.snapshotCalls).toBe(2);
    qf.change({ type: 'RESOURCE_DELETE' });
    expect(await service(qf.client, 'prelive').runSync()).toEqual({ status: 'deleted' });
    expect((await request(app()).get('/api/mushaf/qpc-v1/offline/manifest')).status).toBe(503);
  });

  it('concurrent runs share one sync', async () => {
    const qf = fakeContentSync(clone(base));
    const sync = service(qf.client);
    const [a, b] = await Promise.all([sync.runSync(), sync.runSync()]);
    expect(a).toBe(b);
    expect(qf.state.snapshotCalls).toBe(1);
  });

  it('a mushafs:2 that Content Sync does not offer is reported, not invented', async () => {
    const client: QfContentClient = { get: async () => ({ sync: { mutations: [], has_more: false, next_sync_token: 't0', sync_until_sequence: 0 } }), stream: async () => { throw new Error('unused'); } };
    await expect(service(client).runSync()).rejects.toThrow(/not offered/);
  });
});

