import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { MEASURED_RELEASE } from '@/audio/generated/timingRelease';
import { getReciter, type Reciter } from '@/audio/reciters';
import { ayahAt, ayahStartMs, createTimingLoader, parseTimingPayload, timingUrl, verifyTiming, type TimingStore } from '@/audio/timing';
import { timingFingerprint, type TimingEntry } from '@/audio/timingFingerprint';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/mp3quran-timing/${name}`, import.meta.url)), 'utf8');

/** A reciter whose surah 112 (4 ayahs) has the given audited timing. */
function reciterWith(entries: TimingEntry[], surah = 112): Reciter {
  return { ...getReciter('maher')!, id: 'test', timingRead: 999, timed: { [surah]: [timingFingerprint(entries), 1000] } };
}
const SURAH_112: TimingEntry[] = [
  { ayah: 0, startMs: 0, endMs: 5000 },
  { ayah: 1, startMs: 5000, endMs: 9000 },
  { ayah: 2, startMs: 9000, endMs: 12000 },
  { ayah: 3, startMs: 12000, endMs: 16000 },
  { ayah: 4, startMs: 16000, endMs: 21000 },
];
const payload = (entries: TimingEntry[]) => JSON.stringify(entries.map((e) => ({ ayah: e.ayah, start_time: e.startMs, end_time: e.endMs, polygon: null, page: null })));

describe('MP3Quran timing payloads', () => {
  it('parses ayah, start and end', () => {
    expect(parseTimingPayload(JSON.parse(payload(SURAH_112)))).toEqual(SURAH_112);
  });

  it('rejects anything else', () => {
    expect(parseTimingPayload(null)).toBeNull();
    expect(parseTimingPayload([])).toBeNull();
    expect(parseTimingPayload({ error: 'x' })).toBeNull();
    expect(parseTimingPayload([{ ayah: '1', start_time: 0, end_time: 1 }])).toBeNull();
    expect(parseTimingPayload([{ ayah: 1, start_time: 'x', end_time: 1 }])).toBeNull();
  });

  it('the real audited payloads verify against the catalog (Maher Al-Muaiqly, Al-Fatiha and Al-Ikhlas)', () => {
    const maher = getReciter('maher')!;
    for (const [surah, name] of [[1, 'read133-surah1.json'], [112, 'read133-surah112.json']] as const) {
      const timing = verifyTiming(maher, surah, parseTimingPayload(JSON.parse(fixture(name)))!);
      expect(timing).not.toBeNull();
      expect(timing!.ayahs).toHaveLength(surah === 1 ? 7 : 4);
    }
  });

  it('Al-Husary\'s Al-Fatiha timing (Basmala labelled ayah 0, six ayahs) is not in the catalog and never verifies', () => {
    const husary = getReciter('husary')!;
    const entries = parseTimingPayload(JSON.parse(fixture('read118-surah1.json')))!;
    expect(entries.filter((e) => e.ayah > 0)).toHaveLength(6);
    // The catalogue has none; a release plays the measured timing of his file (MEASURED_RELEASE), never this payload.
    expect(GENERATED_RECITERS.find((r) => r.id === 'husary')!.timed[1]).toBeUndefined();
    expect(husary.timed[1]).toEqual([MEASURED_RELEASE.husary[1].fingerprint, MEASURED_RELEASE.husary[1].bytes]);
    expect(verifyTiming(husary, 1, entries)).toBeNull();
  });
});

describe('verifying timing', () => {
  it('accepts exactly the audited copy', () => {
    const timing = verifyTiming(reciterWith(SURAH_112), 112, SURAH_112);
    expect(timing).toEqual({ reciterId: 'test', surah: 112, introEndMs: 5000, ayahs: SURAH_112.slice(1).map(({ startMs, endMs }) => ({ startMs, endMs })) });
  });

  it('refuses any changed value', () => {
    const changed = SURAH_112.map((e) => (e.ayah === 3 ? { ...e, startMs: e.startMs + 1 } : e));
    expect(verifyTiming(reciterWith(SURAH_112), 112, changed)).toBeNull();
  });

  it('refuses a surah without audited timing', () => {
    expect(verifyTiming(reciterWith(SURAH_112), 113, SURAH_112)).toBeNull();
  });

  it('refuses malformed timing even if it were the audited copy (missing ayah, overlap, zero length)', () => {
    const missing = SURAH_112.filter((e) => e.ayah !== 4);
    expect(verifyTiming(reciterWith(missing), 112, missing)).toBeNull();
    const overlap = SURAH_112.map((e) => (e.ayah === 2 ? { ...e, startMs: 8000 } : e));
    expect(verifyTiming(reciterWith(overlap), 112, overlap)).toBeNull();
    const zero = SURAH_112.map((e) => (e.ayah === 2 ? { ...e, endMs: e.startMs } : e));
    expect(verifyTiming(reciterWith(zero), 112, zero)).toBeNull();
  });

  it('locates ayahs in the audio', () => {
    const timing = verifyTiming(reciterWith(SURAH_112), 112, SURAH_112)!;
    expect(ayahStartMs(timing, 1)).toBe(0); // with the opening
    expect(ayahStartMs(timing, 3)).toBe(12000);
    expect(ayahAt(timing, 100)).toBe(0);
    expect(ayahAt(timing, 5000)).toBe(1);
    expect(ayahAt(timing, 11999)).toBe(2);
    expect(ayahAt(timing, 99999)).toBe(4);
  });
});

describe('loading timing', () => {
  function memoryStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const store: TimingStore = {
      read: async (read, surah) => data.get(`${read}/${surah}`) ?? null,
      write: async (read, surah, text) => void data.set(`${read}/${surah}`, text),
    };
    return { store, data };
  }

  it('fetches from MP3Quran, verifies, stores, and then serves from memory', async () => {
    const reciter = reciterWith(SURAH_112);
    const { store, data } = memoryStore();
    const urls: string[] = [];
    const loader = createTimingLoader({ fetchText: async (url) => (urls.push(url), payload(SURAH_112)), store });
    expect((await loader.load(reciter, 112)).ok).toBe(true);
    expect(urls).toEqual([timingUrl(999, 112)]);
    expect(urls[0]).toBe('https://www.mp3quran.net/api/v3/ayat_timing?surah=112&read=999');
    expect(data.has('999/112')).toBe(true);
    expect((await loader.load(reciter, 112)).ok).toBe(true);
    expect(urls).toHaveLength(1);
  });

  it('works offline from the stored copy (no request)', async () => {
    const reciter = reciterWith(SURAH_112);
    const { store } = memoryStore({ '999/112': payload(SURAH_112) });
    const loader = createTimingLoader({ fetchText: async () => { throw new Error('offline'); }, store });
    const result = await loader.load(reciter, 112);
    expect(result.ok).toBe(true);
    expect(await loader.stored(reciter, 112)).not.toBeNull();
  });

  it('a stored copy that no longer verifies is ignored and fetched again', async () => {
    const reciter = reciterWith(SURAH_112);
    const { store } = memoryStore({ '999/112': '[{"ayah":1,"start_time":0,"end_time":1}]' });
    const loader = createTimingLoader({ fetchText: async () => payload(SURAH_112), store });
    expect((await loader.load(reciter, 112)).ok).toBe(true);
  });

  it('reports network failures, changed timing, and surahs without timing', async () => {
    const reciter = reciterWith(SURAH_112);
    expect(await createTimingLoader({ fetchText: async () => { throw new Error('x'); }, store: memoryStore().store }).load(reciter, 112)).toEqual({ ok: false, reason: 'network' });
    const changed = SURAH_112.map((e) => ({ ...e, endMs: e.endMs + 1 }));
    expect(await createTimingLoader({ fetchText: async () => payload(changed), store: memoryStore().store }).load(reciter, 112)).toEqual({ ok: false, reason: 'mismatch' });
    let fetched = false;
    const loader = createTimingLoader({ fetchText: async () => { fetched = true; return ''; }, store: memoryStore().store });
    expect(await loader.load(reciter, 1)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await loader.load(getReciter('islam-sobhi')!, 17)).toEqual({ ok: false, reason: 'unavailable' });
    expect(fetched).toBe(false);
  });

  it('shares one request between concurrent loads', async () => {
    const reciter = reciterWith(SURAH_112);
    let requests = 0;
    const loader = createTimingLoader({ fetchText: async () => { requests++; return payload(SURAH_112); }, store: memoryStore().store });
    const [a, b] = await Promise.all([loader.load(reciter, 112), loader.load(reciter, 112)]);
    expect(a.ok && b.ok).toBe(true);
    expect(requests).toBe(1);
  });
});

describe('measured timing (shipped in the app)', () => {
  const MEASURED_112: TimingEntry[] = SURAH_112.filter((e) => e.ayah > 0);
  /** A reciter with measured timing for surah 112 only. */
  const measuredReciter = (): Reciter => ({
    ...GENERATED_RECITERS.find((r) => r.id === 'hudhaifi')!,
    id: 'measured-test',
    timingSource: 'measured',
    timingRead: null,
    timed: { 112: [timingFingerprint(MEASURED_112), 1000] },
  });
  const noNetwork = async () => {
    throw new Error('measured timing must never be fetched');
  };
  const noStore: TimingStore = {
    read: async () => {
      throw new Error('measured timing is never read from the device');
    },
    write: async () => {
      throw new Error('measured timing is never stored');
    },
  };

  it('loads without any request or storage, verified against the catalogue fingerprint', async () => {
    const loader = createTimingLoader({ fetchText: noNetwork, store: noStore, measured: (id, surah) => (id === 'measured-test' && surah === 112 ? MEASURED_112 : null) });
    const result = await loader.load(measuredReciter(), 112);
    expect(result).toEqual({ ok: true, timing: { reciterId: 'measured-test', surah: 112, introEndMs: 5000, ayahs: MEASURED_112.map(({ startMs, endMs }) => ({ startMs, endMs })) } });
    expect(await loader.stored(measuredReciter(), 112)).not.toBeNull();
  });

  it('refuses measured timing that is not the audited copy, and surahs without it', async () => {
    const changed = MEASURED_112.map((e) => (e.ayah === 2 ? { ...e, endMs: e.endMs + 1 } : e));
    const loader = createTimingLoader({ fetchText: noNetwork, store: noStore, measured: () => changed });
    expect(await loader.load(measuredReciter(), 112)).toEqual({ ok: false, reason: 'mismatch' });
    expect(await loader.load(measuredReciter(), 1)).toEqual({ ok: false, reason: 'unavailable' });
    const none = createTimingLoader({ fetchText: noNetwork, store: noStore, measured: () => null });
    expect(await none.load(measuredReciter(), 112)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('the real shipped timing verifies for every surah Ali Al-Hudhaifi is listed with', async () => {
    const hudhaifi = GENERATED_RECITERS.find((r) => r.id === 'hudhaifi')!;
    const loader = createTimingLoader({ fetchText: noNetwork, store: noStore });
    for (const surah of Object.keys(hudhaifi.timed).map(Number)) expect((await loader.load(hudhaifi, surah)).ok).toBe(true);
  });
});
