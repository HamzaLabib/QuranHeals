import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMMAND_GRACE_MS, createPlaybackEngine, type AudioOutput, type OutputStatus } from '@/audio/engine';
import { getReciter, isReciterId, surahAudioUrl } from '@/audio/reciters';
import { SOURCE_REGISTRY } from '@/audio/sourceRegistry';
import { localFirstSource } from '@/audio/sources';
import { createTimingLoader, ayahAt, ayahStartMs, type SurahTiming } from '@/audio/timing';
import { createVerifiedCatalog, parseManifest, verifyVersion, type VerifiedEntry, type VerifiedTimingStore } from '@/audio/verifiedTiming';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

// Phase 4.8.3: the app's side of human-verified timing. SYNTHETIC timing and recordings only. The version documents are
// made by the review service's own code (tools/quran-audio/review/cloud/publication-rules.mjs), so this also checks that
// the service and the app agree on the format and the fingerprint.
type J = any;
const tools = resolve(__dirname, '../../tools/quran-audio');
const rules = await import(pathToFileURL(join(tools, 'review/cloud/publication-rules.mjs')).href);

const BASE = 'https://review.example.test';
const INTRO = 4000;
const AYAH = 10_000;
const maher = getReciter('maher')!;
const talib = getReciter('saleh-talib')!;
const SURAH = Number(Object.keys(maher.timed).find((s) => SURAH_AYAH_COUNTS[Number(s) - 1] <= 8));
const N = SURAH_AYAH_COUNTS[SURAH - 1];
const DURATION = INTRO + N * AYAH + 1000;
const entriesFor = (shift = 0, surah = SURAH) => Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ ayah: i + 1, verse: `${surah}:${i + 1}`, startMs: INTRO + i * AYAH + (i ? shift : 0), endMs: INTRO + (i + 1) * AYAH + shift }))
  .map((e, i, all) => ({ ...e, endMs: i + 1 < all.length ? all[i + 1].startMs : INTRO + all.length * AYAH }));
const maherIdentity = { reciterId: 'maher', surah: SURAH, provider: 'mp3quran', url: surahAudioUrl(maher, SURAH), bytes: maher.timed[SURAH][1], sha256: 'a'.repeat(64), durationMs: DURATION, format: { mode: 'cbr', kbps: 128 } };
const T87 = 87;
const talibIdentity = { reciterId: 'saleh-talib', surah: T87, provider: 'archive', url: 'https://archive.org/download/saqrsm/087.mp3', bytes: 3_000_000, sha256: 'b'.repeat(64), durationMs: INTRO + SURAH_AYAH_COUNTS[T87 - 1] * AYAH + 1000, format: { mode: 'cbr', kbps: 64 } };

/** A published version as the service makes it: [manifest entry, document text]. */
function publish(identity: J, entries: J[], versionNo = 1, playback?: J): [J, string] {
  const c = rules.timingContent(identity, entries, ...(playback ? [playback] : []));
  const entry = { recordingId: c.recordingId, versionId: c.versionId, versionNo, reciterId: identity.reciterId, surah: identity.surah, ayahCount: entries.length, timingFingerprint: c.fingerprint, contentSha256: c.contentSha256, playback: c.body.playback, audio: { provider: identity.provider, url: identity.url, bytes: identity.bytes, sha256: identity.sha256, durationMs: identity.durationMs, format: identity.format }, attribution: null, activatedAt: '2026-10-19T12:00:00.000Z' };
  return [entry, JSON.stringify({ ...c.body, versionId: c.versionId, versionNo, createdAt: '2026-10-19T12:00:00.000Z' })];
}
const manifestOf = (env: string, entries: J[]) => JSON.stringify({ kind: 'quran-heals-verified-timing-manifest', format: 1, environment: env, entries });

/** A fake review service and device store. */
function world(env: 'development' | 'production' = 'production') {
  const docs = new Map<string, string>();
  let manifestText = manifestOf(env, []);
  let online = true;
  const requests: string[] = [];
  const disk = { manifest: new Map<string, string>(), versions: new Map<string, string>() };
  const store: VerifiedTimingStore = {
    readManifest: async (e) => disk.manifest.get(e) ?? null,
    writeManifest: async (e, t) => { disk.manifest.set(e, t); },
    readVersion: async (id) => disk.versions.get(id) ?? null,
    writeVersion: async (id, t) => { disk.versions.set(id, t); },
    listVersions: async () => [...disk.versions.keys()],
    removeVersion: async (id) => { disk.versions.delete(id); },
  };
  const etagOf = (t: string) => `"${t.length}-${[...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)}"`;
  const fetch = async (url: string, etag: string | null) => {
    requests.push(url);
    if (!online) throw new Error('offline');
    if (url === `${BASE}/v1/audio-timing/${env}/manifest`) { const e = etagOf(manifestText); return etag === e ? { status: 304, text: '', etag: e } : { status: 200, text: manifestText, etag: e }; }
    const m = /versions\/(tv_[0-9a-f]+)$/.exec(url);
    if (m && docs.has(m[1])) return { status: 200, text: docs.get(m[1])!, etag: null };
    return { status: 404, text: '', etag: null };
  };
  let clock = 0;
  const make = () => createVerifiedCatalog({ baseUrl: BASE, environment: env, fetch, store, knownReciter: isReciterId, now: () => clock, refreshIntervalMs: 60_000 });
  return {
    make, docs, disk, requests, store,
    setManifest(entries: J[]) { manifestText = manifestOf(env, entries); },
    add([entry, text]: [J, string]) { docs.set(entry.versionId, text); return entry; },
    offline(v = true) { online = !v; },
    tick(ms: number) { clock += ms; },
    setRaw(text: string) { manifestText = text; },
  };
}
const legacyFetches: string[] = [];
const loaderWith = (catalog: ReturnType<typeof createVerifiedCatalog> | undefined) => createTimingLoader({
  fetchText: async (url) => { legacyFetches.push(url); throw new Error('the catalogue timing must not be used here'); },
  store: { read: async () => null, write: async () => undefined },
  measured: () => null,
  ...(catalog ? { verified: catalog } : {}),
});

describe('the published manifest and versions: strict validation', () => {
  it('the service document verifies in the app: same format, same fingerprint, the exact recording attached', () => {
    const [entry, text] = publish(maherIdentity, entriesFor());
    const timing = verifyVersion(text, entry as VerifiedEntry)!;
    expect(timing.ayahs).toHaveLength(N);
    expect(timing.introEndMs).toBe(INTRO);
    expect(timing.recording).toMatchObject({ url: maherIdentity.url, bytes: maherIdentity.bytes, versionId: entry.versionId });
  });

  it('refuses any difference: another recording, another fingerprint, overlaps, times past the end, a wrong count', () => {
    const [entry, text] = publish(maherIdentity, entriesFor());
    const doc = JSON.parse(text);
    const bad = (mutate: (d: J) => void) => { const d = structuredClone(doc); mutate(d); return verifyVersion(JSON.stringify(d), entry as VerifiedEntry); };
    expect(bad((d) => { d.recording.url = 'https://cdn.mp3quran.net/other/001.mp3'; })).toBeNull();
    expect(bad((d) => { d.recording.bytes += 1; })).toBeNull();
    expect(bad((d) => { d.timing.entries[1].startMs += 5; })).toBeNull(); // fingerprint
    expect(bad((d) => { d.timing.entries[1].startMs = d.timing.entries[0].startMs + 1; })).toBeNull(); // overlap
    expect(bad((d) => { d.timing.entries.at(-1).endMs = DURATION + 1; })).toBeNull(); // past the recording
    expect(bad((d) => { d.timing.entries.pop(); })).toBeNull(); // count
    expect(bad((d) => { d.versionId = 'tv_' + '0'.repeat(24); })).toBeNull();
    expect(verifyVersion('not json', entry as VerifiedEntry)).toBeNull();
  });

  it('a manifest entry that is not valid (VBR, wrong ayah count, unknown reciter, a duplicate) is rejected, never used', () => {
    const [ok] = publish(maherIdentity, entriesFor());
    const [t] = publish(talibIdentity, entriesFor(0, T87));
    const vbr = { ...t, audio: { ...t.audio, format: { mode: 'vbr', kbps: 64 } } };
    const m = parseManifest(manifestOf('production', [ok, vbr, { ...ok, reciterId: 'nobody' }]), 'production', isReciterId)!;
    expect(m.entries.map((e) => e.reciterId)).toEqual(['maher']);
    expect(m.rejected).toContain(`saleh-talib:${T87}`);
    const dup = parseManifest(manifestOf('production', [ok, { ...ok, versionId: 'tv_' + '1'.repeat(24) }]), 'production', isReciterId)!;
    expect(dup.entries).toHaveLength(0);
    expect(dup.rejected).toEqual([`maher:${SURAH}`]);
    expect(parseManifest(manifestOf('development', [ok]), 'production', isReciterId)).toBeNull(); // another environment's manifest
  });
});

describe('Phase 4.8.5: exact-seek methods and platforms', () => {
  const vbrIdentity = { ...talibIdentity, reciterId: 'islam-sobhi', surah: 17, url: 'https://server14.mp3quran.net/islam/Rewayat-Hafs-A-n-Assem/017.mp3', format: { mode: 'vbr', kbps: null }, durationMs: INTRO + SURAH_AYAH_COUNTS[16] * AYAH + 1000 };
  const vbr = publish(vbrIdentity, entriesFor(0, 17), 1, { method: 'vbr-mllt', platforms: ['android', 'ios'] })[0];
  const [cbr] = publish(maherIdentity, entriesFor());

  it('this build ships CBR seeking only: a published VBR recording is unavailable here (never seconds-off seeking)', () => {
    const m = parseManifest(manifestOf('production', [cbr, vbr]), 'production', isReciterId, { platform: 'android' })!;
    expect(m.entries.map((e) => e.reciterId)).toEqual(['maher']);
    expect(m.rejected).toEqual(['islam-sobhi:17']);
  });

  it('a build that ships the VBR method accepts it; a method that does not match the file is refused', () => {
    const withMllt = parseManifest(manifestOf('production', [vbr]), 'production', isReciterId, { platform: 'ios', seekMethods: ['cbr-exact', 'vbr-mllt'] })!;
    expect(withMllt.entries).toHaveLength(1);
    expect(withMllt.entries[0].playback.method).toBe('vbr-mllt');
    const lying = { ...vbr, playback: { method: 'cbr-exact', platforms: ['android', 'ios'] } }; // VBR file, CBR method
    expect(parseManifest(manifestOf('production', [lying]), 'production', isReciterId, { platform: 'ios' })!.entries).toEqual([]);
  });

  it('an entry verified for one platform only is not offered on the other', () => {
    const androidOnly = { ...cbr, playback: { method: 'cbr-exact', platforms: ['android'] } };
    expect(parseManifest(manifestOf('production', [androidOnly]), 'production', isReciterId, { platform: 'android' })!.entries).toHaveLength(1);
    const ios = parseManifest(manifestOf('production', [androidOnly]), 'production', isReciterId, { platform: 'ios' })!;
    expect(ios.entries).toEqual([]);
    expect(ios.rejected).toEqual([`maher:${SURAH}`]); // unavailable there, never the catalogue's timing instead
  });

  it('the loader treats a not-supported entry as unavailable (mismatch), not as the catalogue', async () => {
    const w = world();
    w.add(publish(vbrIdentity, entriesFor(0, 17), 1, { method: 'vbr-mllt', platforms: ['android', 'ios'] }));
    w.setManifest([vbr]);
    const c = w.make();
    await c.refresh();
    expect(await loaderWith(c).load(getReciter('islam-sobhi')!, 17)).toEqual({ ok: false, reason: 'mismatch' });
  });
});

describe('loading: published timing first, its own recording, never mixed', () => {
  it('16. a published version wins over the catalogue timing of the same recording (no catalogue request)', async () => {
    const w = world();
    const e = w.add(publish(maherIdentity, entriesFor(120)));
    w.setManifest([e]);
    const c = w.make();
    expect(await c.refresh()).toBe('updated');
    legacyFetches.length = 0;
    const r = await loaderWith(c).load(maher, SURAH);
    expect(r.ok && r.timing.recording?.versionId).toBe(e.versionId);
    expect(r.ok && r.timing.ayahs[1].startMs).toBe(INTRO + AYAH + 120);
    expect(legacyFetches).toEqual([]);
    // The catalogue's own file (same URL and size): it plays as audited, no extra check, and a downloaded copy may serve it.
    const resolver = localFirstSource({ uri: async () => null });
    expect(await resolver(maher, SURAH, r.ok ? r.timing : null)).toEqual({ uri: maherIdentity.url, local: false });
    const local = localFirstSource({ uri: async () => 'file:///maher.mp3' });
    expect((await local(maher, SURAH, r.ok ? r.timing : null)).local).toBe(true);
  });

  it('a new provider (archive.org): plays that exact file, checked before it plays; a downloaded catalogue file is never used for it', async () => {
    const w = world();
    const e = w.add(publish(talibIdentity, entriesFor(0, T87)));
    w.setManifest([e]);
    const c = w.make();
    await c.refresh();
    const r = await loaderWith(c).load(talib, T87);
    expect(r.ok).toBe(true);
    const resolver = localFirstSource({ uri: async () => 'file:///catalogue-talib-87.mp3' });
    expect(await resolver(talib, T87, r.ok ? r.timing : null)).toEqual({ uri: talibIdentity.url, local: false, bytes: talibIdentity.bytes, verify: true });
  });

  it('23. nothing published and no catalogue timing: still unavailable; a rejected published entry: unavailable too (never the catalogue)', async () => {
    const w = world();
    const [t] = publish(talibIdentity, entriesFor(0, T87));
    w.setManifest([{ ...t, ayahCount: 3 }]); // invalid
    const c = w.make();
    await c.refresh();
    expect(c.rejected('saleh-talib', T87)).toBe(true);
    expect(await loaderWith(c).load(talib, T87)).toEqual({ ok: false, reason: 'mismatch' });
    const ahmed = getReciter('ahmed-salama')!;
    expect(await loaderWith(c).load(ahmed, 1)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a published version whose document fails validation is a mismatch: no fall-back to other timing', async () => {
    const w = world();
    const [entry, text] = publish(maherIdentity, entriesFor());
    const doc = JSON.parse(text); doc.timing.entries[2].startMs += 1;
    w.docs.set(entry.versionId, JSON.stringify(doc));
    w.setManifest([entry]);
    const c = w.make();
    await c.refresh();
    legacyFetches.length = 0;
    expect(await loaderWith(c).load(maher, SURAH)).toEqual({ ok: false, reason: 'mismatch' });
    expect(legacyFetches).toEqual([]);
  });

  it('24. catalogue off (no service URL) or nothing published: the catalogue timing exactly as before', async () => {
    const off = createVerifiedCatalog({ baseUrl: null, environment: 'production', fetch: async () => { throw new Error('never'); }, store: world().store, knownReciter: isReciterId });
    expect(await off.refresh()).toBe('disabled');
    const measured = (rid: string, s: number) => (rid === 'maher' && s === SURAH ? entriesFor().map(({ ayah, startMs, endMs }) => ({ ayah, startMs, endMs })) : null);
    const loader = createTimingLoader({ fetchText: async () => '[]', store: { read: async () => null, write: async () => undefined }, measured, verified: off });
    const r = await loader.load({ ...maher, timingSource: 'measured', timed: { ...maher.timed, [SURAH]: [rules.timingContent(maherIdentity, entriesFor()).fingerprint, maher.timed[SURAH][1]] } }, SURAH);
    expect(r.ok && r.timing.recording).toBeUndefined(); // the catalogue's timing: no published recording attached
  });
});

describe('versions, caching, offline, rollback', () => {
  it('17/18. a new version is recognised; the old one is dropped from the device; an unchanged manifest costs one small request', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    w.setManifest([v1]);
    const c = w.make();
    await c.refresh();
    const loader = loaderWith(c);
    await loader.load(maher, SURAH);
    expect(w.disk.versions.has(v1.versionId)).toBe(true);
    w.tick(61_000);
    expect(await c.refresh()).toBe('unchanged'); // 304
    const v2 = w.add(publish(maherIdentity, entriesFor(200), 2));
    w.setManifest([v2]);
    expect(await c.refresh()).toBe('skipped'); // throttled
    w.tick(61_000);
    expect(await c.refresh()).toBe('updated');
    const r = await loader.load(maher, SURAH);
    expect(r.ok && r.timing.recording?.versionNo).toBe(2);
    expect(r.ok && r.timing.ayahs[1].startMs).toBe(INTRO + AYAH + 200);
    expect(w.disk.versions.has(v1.versionId)).toBe(false);
    const fetched = w.requests.filter((u) => u.includes('/versions/'));
    await loader.load(maher, SURAH);
    expect(w.requests.filter((u) => u.includes('/versions/'))).toEqual(fetched); // no repeated download
  });

  it('the app open during an update: the playing surah keeps its version until playback leaves it', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    const t1 = w.add(publish(talibIdentity, entriesFor(0, T87)));
    w.setManifest([v1]);
    const c = w.make();
    await c.refresh();
    let playing: string | null = `maher:${SURAH}`;
    c.setInUse(() => playing);
    const v2 = w.add(publish(maherIdentity, entriesFor(300), 2));
    w.setManifest([v2, t1]);
    expect(await c.refresh({ force: true })).toBe('updated');
    expect(c.entry('maher', SURAH)?.versionId).toBe(v1.versionId); // held
    expect(c.hasPending()).toBe(true);
    c.settle();
    expect(c.entry('maher', SURAH)?.versionId).toBe(v1.versionId); // still playing it
    playing = null;
    c.settle();
    expect(c.entry('maher', SURAH)?.versionId).toBe(v2.versionId);
    expect(c.entry('saleh-talib', T87)?.versionId).toBe(t1.versionId);
  });

  it('19. offline: the stored manifest and documents serve; a version never stored is a network failure (no other timing)', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    const t1 = w.add(publish(talibIdentity, entriesFor(0, T87)));
    w.setManifest([v1, t1]);
    const first = w.make();
    await first.refresh();
    await loaderWith(first).load(maher, SURAH); // stored on the device
    w.offline();
    const restarted = w.make(); // the app restarted without a network
    expect(await restarted.refresh({ force: true })).toBe('offline');
    expect(restarted.entry('maher', SURAH)?.versionId).toBe(v1.versionId);
    const r = await loaderWith(restarted).load(maher, SURAH);
    expect(r.ok).toBe(true);
    expect(await loaderWith(restarted).load(talib, T87)).toEqual({ ok: false, reason: 'network' });
    // A damaged stored document is never used.
    w.disk.versions.set(v1.versionId, w.disk.versions.get(v1.versionId)!.replace(`"startMs":${INTRO + AYAH}`, `"startMs":${INTRO + AYAH + 1}`));
    expect(await loaderWith(w.make()).load(maher, SURAH)).toEqual({ ok: false, reason: 'network' });
  });

  it('an invalid or foreign answer keeps the last validated manifest', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    w.setManifest([v1]);
    const c = w.make();
    await c.refresh();
    w.setRaw('{"kind":"something-else"}');
    expect(await c.refresh({ force: true })).toBe('invalid');
    expect(c.entry('maher', SURAH)?.versionId).toBe(v1.versionId);
  });

  it('25. rollback: the manifest points at version 1 again, and the app plays version 1 again', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    const v2 = w.add(publish(maherIdentity, entriesFor(250), 2));
    w.setManifest([v2]);
    const c = w.make();
    await c.refresh();
    const loader = loaderWith(c);
    expect((await loader.load(maher, SURAH) as J).timing.recording.versionNo).toBe(2);
    w.setManifest([v1]);
    await c.refresh({ force: true });
    expect((await loader.load(maher, SURAH) as J).timing.recording.versionId).toBe(v1.versionId);
  });
});

describe('playback with published timing (the one engine)', () => {
  function player(catalog: ReturnType<typeof createVerifiedCatalog>) {
    const calls: string[] = [];
    const listeners = new Set<(s: OutputStatus) => void>();
    let clock = 0;
    const output: AudioOutput = {
      async load(uri, startMs) { calls.push(`load ${uri} @${startMs}`); },
      async seek(ms) { calls.push(`seek @${ms}`); },
      play: () => calls.push('play'), pause: () => calls.push('pause'), stop: () => calls.push('stop'),
      subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
      setNowPlaying: () => undefined, preload: (uri) => calls.push(`preload ${uri}`),
    };
    const checks: string[] = [];
    const engine = createPlaybackEngine({
      output,
      timing: loaderWith(catalog),
      resolveSource: localFirstSource({ uri: async () => null }),
      capability: (r, s) => (catalog.rejected(r.id, s) ? 'none' : catalog.entry(r.id, s) ? 'ayah' : SOURCE_REGISTRY.mode(r.id, s)),
      checkStream: async (uri) => { checks.push(uri); return 'ok'; },
      now: () => clock,
      schedule: () => () => undefined,
    });
    const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const at = async (positionMs: number) => { clock += COMMAND_GRACE_MS; for (const l of listeners) l({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null }); await settle(); };
    return { engine, calls, checks, settle, at };
  }

  it('20-22. seeking, highlighting, Repeat Ayah and continuous playback follow the verified timing of the verified file', async () => {
    const w = world();
    const t1 = w.add(publish(talibIdentity, entriesFor(0, T87)));
    w.setManifest([t1]);
    const c = w.make();
    await c.refresh();
    const p = player(c);
    p.engine.start({ surah: T87, ayah: 3 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await p.settle();
    expect(p.calls).toContain(`load ${talibIdentity.url} @${INTRO + 2 * AYAH}`); // 20: seek to ayah 3 of THIS file
    expect(p.checks).toEqual([talibIdentity.url]); // checked before it plays (not in the audited catalogue)
    await p.at(INTRO + 2 * AYAH + 500);
    await p.at(INTRO + 3 * AYAH - 20);
    expect(p.engine.getState().position).toEqual({ surah: T87, ayah: 4 }); // 20: highlighting follows the verified timing
    p.engine.setRepeat(1); // 21
    await p.at(INTRO + 3 * AYAH + 500);
    await p.at(INTRO + 4 * AYAH - 20);
    expect(p.engine.getState().position).toEqual({ surah: T87, ayah: 4 });
    expect(p.calls.filter((x) => x.startsWith('seek')).at(-1)).toBe(`seek @${INTRO + 3 * AYAH}`);
    const timing = (await loaderWith(c).load(talib, T87) as { ok: true; timing: SurahTiming }).timing;
    expect(ayahAt(timing, INTRO + 5 * AYAH + 1)).toBe(6); // 22: ayah tracking through the whole surah
    expect(ayahStartMs(timing, 1)).toBe(0);
  });

  it('a version published while a surah plays is not applied to it; the next load uses it', async () => {
    const w = world();
    const v1 = w.add(publish(maherIdentity, entriesFor()));
    w.setManifest([v1]);
    const c = w.make();
    await c.refresh();
    const p = player(c);
    c.setInUse(() => { const s = p.engine.getState(); return s.position && ['loading', 'playing', 'paused'].includes(s.phase) ? `${s.reciterId}:${s.position.surah}` : null; });
    p.engine.start({ surah: SURAH, ayah: 2 }, { mode: 'continuous', reciterId: 'maher' });
    await p.settle();
    const v2 = w.add(publish(maherIdentity, entriesFor(400), 2));
    w.setManifest([v2]);
    await c.refresh({ force: true });
    await p.at(INTRO + AYAH + 500);
    await p.at(INTRO + 2 * AYAH - 20); // the end of ayah 2 by v1 (by v2 it ends 400 ms later)
    expect(p.engine.getState().position).toEqual({ surah: SURAH, ayah: 3 });
    expect(c.entry('maher', SURAH)?.versionNo).toBe(1);
    p.engine.stop();
    await p.settle();
    c.settle();
    expect(c.entry('maher', SURAH)?.versionNo).toBe(2);
    p.engine.start({ surah: SURAH, ayah: 2 }, { mode: 'continuous', reciterId: 'maher' });
    await p.settle();
    expect(p.calls.filter((x) => x.startsWith('load')).at(-1)).toBe(`load ${maherIdentity.url} @${INTRO + AYAH + 400}`);
  });
});
