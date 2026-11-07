import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { entryCovering, parseTafsirDataset } from '@/tafsir/dataset';
import { DEFAULT_TAFSIR_EDITION, TAFSIR_EDITION_IDS, tafsirEditions, type TafsirEditionId } from '@/tafsir/editions';
import { createTafsirLibrary } from '@/tafsir/library';
import type { TafsirFileStore } from '@/tafsir/storage';
import { anchorAyahOf, buildSurahRows, commentaryIndexOf, earlierWindowStart, PREPEND_CHUNK, rowIndexOfAyah } from '@/tafsir/surahItems';

import { syntheticFile, syntheticSurahs, type Entry } from './helpers/tafsirSynthetic';

/**
 * The tafsir reader's data: the app file's rules (complete, ordered coverage; passages kept whole), the rows the reader
 * draws, and the library that keeps editions on the device (verified downloads only). All tafsir text here is
 * SYNTHETIC («نص تجريبي»); no edition's real text is used.
 */
const counts = (surahs: Entry[][]) => ({ entries: surahs.flat().length, ranges: surahs.flat().filter(([a, b]) => b > a).length });

describe('the app file (dataset.ts)', () => {
  it('accepts a complete edition, with passages, and finds the entry covering any ayah', () => {
    const surahs = syntheticSurahs({ 2: [[183, 187]], 28: [[33, 34]] });
    const result = parseTafsirDataset(syntheticFile('zilal', surahs), 'zilal');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.entryCount).toBe(6236 - 4 - 1);
    expect(result.dataset.rangeCount).toBe(2);
    expect(result.dataset.entryFor(2, 186)).toEqual({ from: 183, to: 187, text: 'نص تجريبي 2:183-187' });
    expect(result.dataset.entryFor(2, 188)).toEqual({ from: 188, to: 188, text: 'نص تجريبي 2:188' });
    expect(result.dataset.entryFor(114, 6)?.from).toBe(6);
    expect(entryCovering(result.dataset.surah(2), 287)).toBeNull();
  });

  it.each([
    ['a missing ayah', (s: Entry[][]) => { s[1].splice(10, 1); }],
    ['an overlap', (s: Entry[][]) => { s[1][10] = [10, 11, 'x']; }],
    ['out of order', (s: Entry[][]) => { [s[1][3], s[1][4]] = [s[1][4], s[1][3]]; }],
    ['past the last ayah', (s: Entry[][]) => { s[0][6] = [7, 8, 'x']; }],
    ['an empty commentary', (s: Entry[][]) => { s[3][0] = [1, 1, '   ']; }],
    ['a missing Surah', (s: Entry[][]) => { s.pop(); }],
  ])('rejects the whole file on %s', (_name, damage) => {
    const surahs = syntheticSurahs();
    damage(surahs);
    expect(parseTafsirDataset(syntheticFile('saadi', surahs), 'saadi').ok).toBe(false);
  });

  it('rejects another edition, format or language', () => {
    expect(parseTafsirDataset(syntheticFile('saadi'), 'jalalayn').ok).toBe(false);
    expect(parseTafsirDataset({ ...syntheticFile('saadi'), version: 2 }, 'saadi').ok).toBe(false);
    expect(parseTafsirDataset({ ...syntheticFile('saadi'), language: 'en' }, 'saadi').ok).toBe(false);
    expect(parseTafsirDataset(null, 'saadi').ok).toBe(false);
  });
});

describe('the rows the reader draws (surahItems.ts)', () => {
  const verses = Array.from({ length: 286 }, (_, i) => ({ ayah: i + 1, text: `آية ${i + 1}` }));
  const entries = [...Array.from({ length: 182 }, (_, i) => ({ from: i + 1, to: i + 1, text: `t${i + 1}` })), { from: 183, to: 187, text: 'passage' }, ...Array.from({ length: 99 }, (_, i) => ({ from: 188 + i, to: 188 + i, text: `t${188 + i}` }))];
  const rows = buildSurahRows(verses, entries);

  it('each ayah once, in order; a passage\'s commentary once, after its last ayah, never under each ayah', () => {
    expect(rows.filter((r) => r.type === 'ayah').map((r) => (r.type === 'ayah' ? r.ayah : 0))).toEqual(verses.map((v) => v.ayah));
    expect(rows.filter((r) => r.type === 'commentary' && r.text === 'passage')).toHaveLength(1);
    const at = rows.findIndex((r) => r.type === 'commentary' && r.text === 'passage');
    expect(rows.slice(at - 5, at).map((r) => r.key)).toEqual(['a183', 'a184', 'a185', 'a186', 'a187']);
    expect(rows[rowIndexOfAyah(rows, 186)]).toMatchObject({ type: 'ayah', ayah: 186, range: { from: 183, to: 187 } });
    expect(rows.length).toBe(286 + entries.length);
  });

  it('opens on the chosen ayah\'s own row (inside a passage too), finds its commentary, and the last ayah', () => {
    expect(rows[rowIndexOfAyah(rows, 1)].key).toBe('a1');
    expect(rows[rowIndexOfAyah(rows, 186)].key).toBe('a186');
    expect(rows[commentaryIndexOf(rows, 186)].key).toBe('c183-187');
    expect(rows[rowIndexOfAyah(rows, 286)].key).toBe('a286');
    expect(rows[rows.length - 1].key).toBe('c286-286');
  });

  it('the ayah being read: an ayah row is itself, a commentary row the first ayah it explains', () => {
    expect(anchorAyahOf(rows[rowIndexOfAyah(rows, 50)])).toBe(50);
    expect(anchorAyahOf(rows[commentaryIndexOf(rows, 186)])).toBe(183);
    expect(anchorAyahOf(undefined)).toBeNull();
  });

  it('scrolling up adds earlier rows in chunks, never before the first', () => {
    expect(earlierWindowStart(100)).toBe(100 - PREPEND_CHUNK);
    expect(earlierWindowStart(5)).toBe(0);
  });

  it('refuses rows for a Surah whose verses do not match', () => {
    expect(() => buildSurahRows(verses.slice(0, 10), entries)).toThrow();
  });
});

/** An in-memory file store with the device's behaviour: .part files, size + hash check at commit. */
function memoryStore(options: { hashOk?: () => boolean } = {}) {
  const files = new Map<string, string>();
  const parts = new Map<string, string>();
  let next: { resolve: (ok: boolean) => void; reject: (e: unknown) => void; progress: (n: number) => void } | null = null;
  const body = new Map<string, string>();
  const store: TafsirFileStore & { serve(edition: TafsirEditionId, text: string): void; finish(ok: boolean | Error): void; progress(n: number): void; files: Map<string, string>; parts: Map<string, string> } = {
    files,
    parts,
    serve: (edition, text) => body.set(edition, text),
    finish: (ok) => (ok instanceof Error ? next?.reject(ok) : next?.resolve(ok)),
    progress: (n) => next?.progress(n),
    has: async (edition, sha256, bytes) => files.get(`${edition}/${sha256}`)?.length === bytes,
    read: async (edition, sha256) => files.get(`${edition}/${sha256}`) ?? null,
    download: vi.fn(async (_url: string, edition: TafsirEditionId, sha256: string, onProgress: (n: number) => void) => {
      const done = new Promise<boolean>((resolve, reject) => {
        next = {
          resolve: (ok) => {
            if (ok) parts.set(`${edition}/${sha256}`, body.get(edition) ?? '');
            resolve(ok);
          },
          reject,
          progress: onProgress,
        };
      });
      return { done, cancel: () => next?.resolve(false) };
    }),
    commit: vi.fn(async (edition: TafsirEditionId, sha256: string, bytes: number) => {
      const part = parts.get(`${edition}/${sha256}`);
      parts.delete(`${edition}/${sha256}`);
      if (part === undefined || part.length !== bytes || !(options.hashOk?.() ?? true)) return false;
      files.set(`${edition}/${sha256}`, part);
      return true;
    }),
    discardPartial: vi.fn(async (edition: TafsirEditionId, sha256: string) => {
      parts.delete(`${edition}/${sha256}`);
    }),
    remove: vi.fn(async (edition: TafsirEditionId) => {
      for (const key of [...files.keys()]) if (key.startsWith(`${edition}/`)) files.delete(key);
    }),
  };
  return store;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(options: { hashOk?: () => boolean; bundled?: boolean; store?: ReturnType<typeof memoryStore> } = {}) {
  const surahs = syntheticSurahs({ 2: [[183, 187]] });
  const saadiText = JSON.stringify(syntheticFile('saadi', surahs));
  const zilalText = JSON.stringify(syntheticFile('zilal', surahs));
  const pin = (text: string) => ({ status: 'ready' as const, sha256: 'a'.repeat(64), bytes: text.length, ...counts(surahs) });
  const release = {
    muyassar: options.bundled === false ? { status: 'blocked' as const, reason: 'source-unreachable' } : { ...pin(''), ...counts(syntheticSurahs()) },
    saadi: pin(saadiText),
    jalalayn: { status: 'blocked' as const, reason: 'rights-unverified' },
    zilal: { ...pin(zilalText), sha256: 'b'.repeat(64) },
  };
  const store = options.store ?? memoryStore(options);
  store.serve('saadi', saadiText);
  store.serve('zilal', zilalText);
  const library = createTafsirLibrary({
    editions: tafsirEditions(release),
    files: store,
    bundled: () => syntheticFile('muyassar'),
    downloadUrl: (edition, sha256) => `https://api.example.invalid/api/tafsir/v1/editions/${edition}/${sha256}.json`,
  });
  return { library, store, release, saadiText };
}

describe('the library: bundled, downloadable and unavailable editions (library.ts)', () => {
  it('lists the four editions in their fixed order; الميسر is the default', () => {
    expect(tafsirEditions().map((e) => [e.id, e.title, e.delivery])).toEqual([
      ['muyassar', 'التفسير الميسر', 'bundled'],
      ['saadi', 'تفسير السعدي', 'download'],
      ['jalalayn', 'تفسير الجلالين', 'download'],
      ['zilal', 'في ظلال القرآن', 'download'],
    ]);
    expect(TAFSIR_EDITION_IDS[0]).toBe(DEFAULT_TAFSIR_EDITION);
  });

  it('without a verified release an edition is unavailable and can never be downloaded or read', async () => {
    const { library, store } = setup();
    expect(library.getSnapshot().jalalayn).toEqual({ kind: 'unavailable' });
    expect(await library.download('jalalayn')).toBe(false);
    expect(await library.load('jalalayn')).toBeNull();
    expect(store.download).not.toHaveBeenCalled();
  });

  it('الميسر is ready with no download (a fresh install, offline) and parses from the bundle', async () => {
    const { library, store } = setup();
    await library.refresh();
    expect(library.getSnapshot().muyassar).toEqual({ kind: 'ready' });
    expect((await library.load('muyassar'))?.entryFor(2, 186)?.text).toBe('نص تجريبي 2:186');
    expect(store.download).not.toHaveBeenCalled();
  });

  it('downloads with progress, verifies, then reads; two editions are kept side by side and survive a restart offline', async () => {
    const { library, store } = setup();
    await library.refresh();
    expect(library.getSnapshot().saadi).toEqual({ kind: 'notDownloaded' });
    const saadi = library.download('saadi');
    await tick();
    expect(store.download).toHaveBeenCalledWith('https://api.example.invalid/api/tafsir/v1/editions/saadi/' + 'a'.repeat(64) + '.json', 'saadi', 'a'.repeat(64), expect.any(Function));
    store.progress(1000);
    expect(library.getSnapshot().saadi.kind).toBe('downloading');
    expect((library.getSnapshot().saadi as { progress: number }).progress).toBeGreaterThan(0);
    store.finish(true);
    expect(await saadi).toBe(true);
    expect(library.getSnapshot().saadi).toEqual({ kind: 'ready' });

    const zilal = library.download('zilal');
    await tick();
    store.finish(true);
    expect(await zilal).toBe(true);
    expect((await library.load('zilal'))?.entryFor(2, 186)).toMatchObject({ from: 183, to: 187 });

    // A new launch, no network: the same files are found and read; nothing is downloaded.
    const again = createTafsirLibrary({ editions: library.editions, files: store, bundled: () => syntheticFile('muyassar'), downloadUrl: () => 'https://offline.invalid/' });
    await again.refresh();
    expect(again.getSnapshot()).toMatchObject({ muyassar: { kind: 'ready' }, saadi: { kind: 'ready' }, zilal: { kind: 'ready' }, jalalayn: { kind: 'unavailable' } });
    expect((await again.load('saadi'))?.entryFor(1, 1)?.text).toBe('نص تجريبي 1:1');
  });

  it('an interrupted download keeps nothing, says so, and a retry succeeds; the edition being read stays readable', async () => {
    const { library, store } = setup();
    await library.refresh();
    const reading = await library.load('muyassar');
    const first = library.download('saadi');
    await tick();
    store.progress(500);
    store.finish(new Error('network lost'));
    expect(await first).toBe(false);
    expect(library.getSnapshot().saadi).toEqual({ kind: 'failed', reason: 'network' });
    expect(store.discardPartial).toHaveBeenCalledWith('saadi', 'a'.repeat(64));
    expect(await library.load('saadi')).toBeNull();
    expect(await library.load('muyassar')).toBe(reading);

    const retry = library.download('saadi');
    await tick();
    store.finish(true);
    expect(await retry).toBe(true);
    expect(library.getSnapshot().saadi).toEqual({ kind: 'ready' });
  });

  it('a download that does not verify (hash) is deleted and never offered', async () => {
    const { library, store } = setup({ hashOk: () => false });
    await library.refresh();
    const run = library.download('saadi');
    await tick();
    store.finish(true);
    expect(await run).toBe(false);
    expect(library.getSnapshot().saadi).toEqual({ kind: 'failed', reason: 'verification' });
    expect(store.files.size).toBe(0);
  });

  it('a stored file that no longer parses (damaged) is deleted, the edition can be fetched again, and الميسر opens instead', async () => {
    const store = memoryStore();
    const { library, release } = setup({ store });
    store.files.set(`saadi/${release.saadi.sha256}`, '{"broken":'.padEnd(release.saadi.bytes, ' '));
    await library.refresh();
    expect(library.getSnapshot().saadi).toEqual({ kind: 'ready' });
    expect(await library.load('saadi')).toBeNull();
    expect(library.getSnapshot().saadi).toEqual({ kind: 'failed', reason: 'verification' });
    expect(store.remove).toHaveBeenCalledWith('saadi');
    expect(library.resolve('saadi')).toBe('muyassar');
  });

  it('a disk check that fails once does not hide a downloaded edition: the next opening finds it', async () => {
    const store = memoryStore();
    const { library, release, saadiText } = setup({ store });
    store.files.set(`saadi/${release.saadi.sha256}`, saadiText);
    const has = store.has;
    let fail = true;
    store.has = async (...args) => {
      if (fail) return false; // e.g. the file system module not loadable yet
      return has(...args);
    };
    await library.refresh();
    expect(library.getSnapshot().saadi).toEqual({ kind: 'notDownloaded' });
    fail = false;
    await library.refresh();
    expect(library.getSnapshot().saadi).toEqual({ kind: 'ready' });
  });

  it('resolve: the preferred edition when ready, else الميسر, else nothing', async () => {
    const { library } = setup();
    await library.refresh();
    expect(library.resolve('saadi')).toBe('muyassar');
    expect(library.resolve(null)).toBe('muyassar');
    const none = setup({ bundled: false }).library;
    expect(none.resolve('saadi')).toBeNull();
  });

  it('removing a download frees it; the bundled الميسر cannot be removed', async () => {
    const { library, store } = setup();
    await library.refresh();
    const run = library.download('saadi');
    await tick();
    store.finish(true);
    await run;
    await library.remove('saadi');
    expect(library.getSnapshot().saadi).toEqual({ kind: 'notDownloaded' });
    await library.remove('muyassar');
    expect(library.getSnapshot().muyassar).toEqual({ kind: 'ready' });
  });
});

describe('this build', () => {
  it('ships التفسير الميسر bundled and ready; the other three stay unavailable until each is cleared', async () => {
    const { TAFSIR_RELEASE } = await import('@/tafsir/generated/tafsirRelease');
    expect(TAFSIR_RELEASE.muyassar).toEqual({ status: 'ready', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: expect.any(Number), entries: 5278, ranges: 494 });
    expect({ saadi: TAFSIR_RELEASE.saadi, jalalayn: TAFSIR_RELEASE.jalalayn, zilal: TAFSIR_RELEASE.zilal }).toEqual({
      saadi: { status: 'blocked', reason: 'rights-unverified' },
      jalalayn: { status: 'blocked', reason: 'rights-unverified' },
      zilal: { status: 'blocked', reason: 'rights-unverified' },
    });
    // One lazy require of the bundled file, inside the loader (never at the app's start).
    const loader = readFileSync(fileURLToPath(new URL('../src/tafsir/generated/bundledTafsir.ts', import.meta.url)), 'utf8');
    expect(loader.match(/require\(/g)).toHaveLength(1);
    expect(loader).toContain("return require('../../../assets/tafsir/muyassar.json');");
  });
});

/**
 * The bundled file itself (QuranEnc.com's `arabic_moyassar` v1.0.0, git-ignored: restored by `node tools/tafsir/build.mjs`).
 * Skipped where it is absent (CI); a release cannot bundle without it.
 */
const BUNDLED = fileURLToPath(new URL('../assets/tafsir/muyassar.json', import.meta.url));
describe.skipIf(!existsSync(BUNDLED))('the bundled التفسير الميسر (real data)', () => {
  it('is exactly the pinned file, and parses with the app\'s own rules into the pinned counts', async () => {
    const { TAFSIR_RELEASE } = await import('@/tafsir/generated/tafsirRelease');
    const pin = TAFSIR_RELEASE.muyassar as { sha256: string; bytes: number; entries: number; ranges: number };
    const bytes = readFileSync(BUNDLED);
    expect(bytes.length).toBe(pin.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);
    const result = parseTafsirDataset(JSON.parse(bytes.toString('utf8')), 'muyassar');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.dataset.entryCount, result.dataset.rangeCount]).toEqual([pin.entries, pin.ranges]);
    expect(result.dataset.source).toMatchObject({ title: 'التفسير الميسر', publisher: 'مجمع الملك فهد لطباعة المصحف الشريف', distributor: 'QuranEnc.com', version: '1.0.0', url: 'https://quranenc.com/ar/browse/arabic_moyassar' });
  });

  it('keeps the source\'s joint commentary as passages: 28:33–34 and 68:21–22 (each shown once)', () => {
    const result = parseTafsirDataset(JSON.parse(readFileSync(BUNDLED, 'utf8')), 'muyassar');
    if (!result.ok) throw new Error(result.reason);
    const d = result.dataset;
    for (const [surah, ayah, from, to] of [[28, 33, 33, 34], [28, 34, 33, 34], [68, 21, 21, 22], [68, 22, 21, 22], [68, 19, 19, 20]]) {
      expect(d.entryFor(surah, ayah)).toMatchObject({ from, to });
    }
    expect(d.entryFor(28, 33)!.text.startsWith('قال موسى:') && d.entryFor(28, 33)!.text.includes('هارون')).toBe(true);
    expect(d.entryFor(68, 21)!.text.startsWith('فنادى بعضهم بعضًا وقت الصباح')).toBe(true);
    expect(d.entryFor(28, 32)).toMatchObject({ from: 32, to: 32 });
    expect(d.entryFor(28, 35)).toMatchObject({ from: 35, to: 35 });
  });

  it('the app\'s loader returns that same file', async () => {
    const { bundledMuyassar } = await import('@/tafsir/generated/bundledTafsir');
    expect(parseTafsirDataset(bundledMuyassar(), 'muyassar').ok).toBe(true);
  });
});
