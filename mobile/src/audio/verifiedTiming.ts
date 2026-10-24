import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import type { SurahTiming } from './timing';
import { timingFingerprint } from './timingFingerprint';

/**
 * Phase 4.8.3: human-verified ayah timing published by the audio review service (tools/quran-audio/review/cloud:
 * registry.mjs, publisher.mjs). A recording two independent reviewers verified, and that passed every publication check
 * (rights, exact file, format, timing), is published as an immutable VERSION; each app environment (development
 * builds, release builds) has its own pointer to the version it plays, set together by the service.
 *
 * The app reads its environment's manifest (which version of which exact recording is active for a reciter and surah)
 * and each version's document, validates both, and keeps them on the device so they also work offline. A published
 * version takes precedence over the catalogue's timing for that reciter and surah, and plays ITS OWN recording (the
 * exact file it was verified on: URL and size), never another one.
 *
 * Strict by design: when a published entry or document fails validation, that surah is UNAVAILABLE for the reciter
 * (reason 'mismatch'): it never falls back to other timing or another recording.
 */

export type VerifiedEnvironment = 'development' | 'production';

/**
 * Phase 4.8.5: the exact-seek methods THIS app build ships. 'cbr-exact': a CBR file with byte ranges (the player seeks by
 * constant bitrate). A VBR recording would need 'vbr-mllt' (a native data source giving the player an exact seek table in
 * front of the unchanged stream: docs/audio/vbr-cross-platform-phase-4-4), which is not built: a published VBR entry is
 * therefore unavailable here, never played with seconds-off seeking.
 */
export const APP_SEEK_METHODS: readonly string[] = ['cbr-exact'];
export type ManifestOptions = { platform?: string | null; seekMethods?: readonly string[] };

export type VerifiedEntry = {
  recordingId: string;
  versionId: string;
  versionNo: number;
  reciterId: string;
  surah: number;
  ayahCount: number;
  timingFingerprint: string;
  audio: { provider: string; url: string; bytes: number; sha256: string; durationMs: number; format: { mode: 'cbr' | 'vbr'; kbps: number | null } };
  /** How this file must be seeked, and the platforms that was verified on (Phase 4.8.5). */
  playback: { method: string; platforms: readonly string[] };
  attribution: string | null;
  activatedAt: string;
};

/** The exact recording a verified timing belongs to: what must play with it. */
export type VerifiedRecording = { recordingId: string; versionId: string; versionNo: number; provider: string; url: string; bytes: number; durationMs: number };

export type VerifiedManifest = { environment: VerifiedEnvironment; entries: readonly VerifiedEntry[]; rejected: readonly string[] };

const RECORDING_ID = /^rec_[0-9a-f]{24}$/;
const VERSION_ID = /^tv_[0-9a-f]{24}$/;
const FINGERPRINT = /^[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const positiveInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0;
export const keyOf = (reciterId: string, surah: number) => `${reciterId}:${surah}`;

/** One manifest entry, or null when anything about it is not as published entries must be. */
function parseEntry(raw: unknown, knownReciter: (id: string) => boolean, options: ManifestOptions): VerifiedEntry | null {
  if (!isObject(raw) || !isObject(raw.audio) || !isObject(raw.audio.format)) return null;
  const { recordingId, versionId, versionNo, reciterId, surah, ayahCount, timingFingerprint: fp, audio, attribution, activatedAt } = raw;
  if (typeof recordingId !== 'string' || !RECORDING_ID.test(recordingId) || typeof versionId !== 'string' || !VERSION_ID.test(versionId) || !positiveInt(versionNo)) return null;
  if (typeof reciterId !== 'string' || !knownReciter(reciterId) || !Number.isInteger(surah) || (surah as number) < 1 || (surah as number) > 114) return null;
  if (ayahCount !== SURAH_AYAH_COUNTS[(surah as number) - 1] || typeof fp !== 'string' || !FINGERPRINT.test(fp)) return null;
  const a = audio as Record<string, unknown> & { format: Record<string, unknown> };
  if (typeof a.provider !== 'string' || typeof a.url !== 'string' || !/^https:\/\/[^\s]+$/.test(a.url) || !positiveInt(a.bytes) || typeof a.sha256 !== 'string' || !SHA256.test(a.sha256) || !positiveInt(a.durationMs)) return null;
  // Exact seeking: the entry's method must be one this build ships (and match the file's bitrate mode), verified for this
  // platform. Older manifests (no playback field) are CBR with the CBR method on both platforms.
  const playback = isObject(raw.playback) ? raw.playback : { method: 'cbr-exact', platforms: ['android', 'ios'] };
  const method = playback.method;
  const platforms = Array.isArray(playback.platforms) ? playback.platforms.filter((p): p is string => typeof p === 'string') : [];
  if (a.format.mode !== 'cbr' && a.format.mode !== 'vbr') return null;
  if (typeof method !== 'string' || !(options.seekMethods ?? APP_SEEK_METHODS).includes(method)) return null;
  if ((a.format.mode === 'cbr') !== (method === 'cbr-exact')) return null;
  if (options.platform && !platforms.includes(options.platform)) return null;
  return {
    recordingId, versionId, versionNo: versionNo as number, reciterId, surah: surah as number, ayahCount: ayahCount as number, timingFingerprint: fp,
    audio: { provider: a.provider, url: a.url, bytes: a.bytes as number, sha256: a.sha256, durationMs: a.durationMs as number, format: { mode: a.format.mode, kbps: typeof a.format.kbps === 'number' ? a.format.kbps : null } },
    playback: { method, platforms },
    attribution: typeof attribution === 'string' ? attribution : null,
    activatedAt: typeof activatedAt === 'string' ? activatedAt : '',
  };
}

/**
 * The manifest of `environment`, validated, or null when it is not a manifest of that environment at all (the previous
 * one is then kept). An invalid entry is not used, and its reciter and surah are listed in `rejected` (unavailable,
 * never served by other timing); so are two entries for one reciter and surah (one recording each, always).
 */
export function parseManifest(text: string, environment: VerifiedEnvironment, knownReciter: (id: string) => boolean, options: ManifestOptions = {}): VerifiedManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.kind !== 'quran-heals-verified-timing-manifest' || raw.format !== 1 || raw.environment !== environment || !Array.isArray(raw.entries)) return null;
  const byKey = new Map<string, VerifiedEntry>();
  const rejected = new Set<string>();
  for (const item of raw.entries) {
    const entry = parseEntry(item, knownReciter, options);
    if (!entry) {
      if (isObject(item) && typeof item.reciterId === 'string' && Number.isInteger(item.surah)) rejected.add(keyOf(item.reciterId, item.surah as number));
      continue;
    }
    const key = keyOf(entry.reciterId, entry.surah);
    if (byKey.has(key)) rejected.add(key);
    byKey.set(key, entry);
  }
  for (const key of rejected) byKey.delete(key);
  return { environment, entries: [...byKey.values()], rejected: [...rejected] };
}

/**
 * A version's document → the surah's timing, only if it is exactly the published entry: the same version, the same
 * recording (provider, URL, size, SHA-256, length), the canonical ayah set 1..N of that surah with its verse ids, every
 * ayah inside the recording, in order, with a positive length and no overlap, and the published fingerprint.
 */
export function verifyVersion(text: string, entry: VerifiedEntry): SurahTiming | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(doc) || doc.kind !== 'quran-heals-verified-timing' || doc.format !== 1 || doc.versionId !== entry.versionId || doc.recordingId !== entry.recordingId) return null;
  const rec = doc.recording;
  if (!isObject(rec) || rec.reciterId !== entry.reciterId || rec.surah !== entry.surah || rec.provider !== entry.audio.provider || rec.url !== entry.audio.url || rec.bytes !== entry.audio.bytes || rec.sha256 !== entry.audio.sha256 || rec.durationMs !== entry.audio.durationMs) return null;
  const timing = doc.timing;
  if (!isObject(timing) || !Array.isArray(timing.entries) || timing.fingerprint !== entry.timingFingerprint) return null;
  const list = timing.entries as unknown[];
  if (list.length !== entry.ayahCount) return null;
  const ayahs: { startMs: number; endMs: number }[] = [];
  let previousEnd = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!isObject(e) || e.ayah !== i + 1 || e.verse !== `${entry.surah}:${i + 1}` || !Number.isInteger(e.startMs) || !Number.isInteger(e.endMs)) return null;
    const startMs = e.startMs as number;
    const endMs = e.endMs as number;
    if (startMs < 0 || !(endMs > startMs) || startMs < previousEnd || endMs > entry.audio.durationMs) return null;
    ayahs.push({ startMs, endMs });
    previousEnd = endMs;
  }
  const fp = timingFingerprint(ayahs.map((a, i) => ({ ayah: i + 1, startMs: a.startMs, endMs: a.endMs })));
  // Phase 4.8.8: ayah 1 plays from 0 (opening rule); introEndMs is where its words begin (highlighting), inside ayah 1.
  const introEndMs = timing.introEndMs;
  if (fp !== entry.timingFingerprint || !Number.isInteger(introEndMs) || (introEndMs as number) < ayahs[0].startMs || (introEndMs as number) >= ayahs[0].endMs) return null;
  return {
    reciterId: entry.reciterId,
    surah: entry.surah,
    introEndMs: introEndMs as number,
    ayahs,
    recording: { recordingId: entry.recordingId, versionId: entry.versionId, versionNo: entry.versionNo, provider: entry.audio.provider, url: entry.audio.url, bytes: entry.audio.bytes, durationMs: entry.audio.durationMs },
  };
}

/** Where the manifest and version documents are kept on the device (one manifest per environment). */
export type VerifiedTimingStore = {
  readManifest(environment: VerifiedEnvironment): Promise<string | null>;
  writeManifest(environment: VerifiedEnvironment, text: string): Promise<void>;
  readVersion(versionId: string): Promise<string | null>;
  writeVersion(versionId: string, text: string): Promise<void>;
  listVersions(): Promise<string[]>;
  removeVersion(versionId: string): Promise<void>;
};

/** A GET with an optional If-None-Match: 304 means unchanged. */
export type ConditionalFetch = (url: string, etag: string | null) => Promise<{ status: number; text: string; etag: string | null }>;

export type VerifiedLoad = { ok: true; timing: SurahTiming } | { ok: false; reason: 'network' | 'mismatch' };
export type RefreshResult = 'disabled' | 'skipped' | 'unchanged' | 'updated' | 'offline' | 'invalid';

export type VerifiedCatalog = ReturnType<typeof createVerifiedCatalog>;

/**
 * The verified timing of one environment on this device.
 *  - ready(): the stored manifest (validated) is used at once, offline included.
 *  - refresh(): fetches the manifest (conditional, at most every `refreshIntervalMs` unless forced). A new manifest takes
 *    effect at once for every surah except the one playing (`inUse`): that one keeps its version until playback leaves
 *    it (settle()), so a surah is never switched to other timing or another file in the middle. Offline or an invalid
 *    answer: the stored, validated manifest stays (stale until the next successful refresh: that is the realistic
 *    guarantee). Version documents no manifest refers to any more are removed from the device.
 *  - load(entry): the version's timing: memory, else the device (validated again), else the service (validated, then
 *    stored). Immutable: a version id names one document forever.
 */
export function createVerifiedCatalog(deps: {
  baseUrl: string | null;
  environment: VerifiedEnvironment;
  fetch: ConditionalFetch;
  store: VerifiedTimingStore;
  knownReciter: (id: string) => boolean;
  /** This device's platform ('android' | 'ios') and the seek methods this build ships (Phase 4.8.5). */
  platform?: string | null;
  seekMethods?: readonly string[];
  now?: () => number;
  refreshIntervalMs?: number;
  /** Development diagnostics (what was installed, held, applied, loaded): verifiedCatalog.ts passes devLog. */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}) {
  const log = deps.log ?? (() => undefined);
  const ids = (m: VerifiedManifest) => m.entries.map((e) => `${keyOf(e.reciterId, e.surah)}=v${e.versionNo}:${e.versionId}`);
  const now = deps.now ?? (() => Date.now());
  const interval = deps.refreshIntervalMs ?? 15 * 60_000;
  const base = deps.baseUrl?.replace(/\/+$/, '') ?? null;
  const manifestOptions: ManifestOptions = { platform: deps.platform ?? null, seekMethods: deps.seekMethods ?? APP_SEEK_METHODS };
  let current: VerifiedManifest = { environment: deps.environment, entries: [], rejected: [] };
  let byKey = new Map<string, VerifiedEntry>();
  let rejected = new Set<string>();
  let pending: VerifiedManifest | null = null;
  let etag: string | null = null;
  let checkedAt = -Infinity;
  let version = 0;
  let inUse: () => string | null = () => null;
  let started: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const memory = new Map<string, SurahTiming>();
  const inFlight = new Map<string, Promise<VerifiedLoad>>();

  const emit = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const install = (m: VerifiedManifest) => {
    current = m;
    byKey = new Map(m.entries.map((e) => [keyOf(e.reciterId, e.surah), e]));
    rejected = new Set(m.rejected);
    log('manifest installed', { entries: ids(m), rejected: m.rejected });
    emit();
  };
  const sameFor = (a: VerifiedManifest, b: VerifiedManifest, key: string) => {
    const x = a.entries.find((e) => keyOf(e.reciterId, e.surah) === key);
    const y = b.entries.find((e) => keyOf(e.reciterId, e.surah) === key);
    return (x?.versionId ?? null) === (y?.versionId ?? null) && a.rejected.includes(key) === b.rejected.includes(key);
  };
  /** Applies `next`, unless it changes the surah being played: then it waits for settle(). */
  const apply = (next: VerifiedManifest) => {
    const playing = inUse();
    if (playing && !sameFor(current, next, playing)) {
      pending = next;
      log('manifest held: the playing surah keeps its version until playback leaves it', { playing, pending: ids(next) });
      return;
    }
    pending = null;
    install(next);
  };

  async function collect(keep: VerifiedManifest) {
    const wanted = new Set([...keep.entries, ...current.entries, ...(pending?.entries ?? [])].map((e) => e.versionId));
    const stored = await deps.store.listVersions().catch(() => [] as string[]);
    for (const id of stored) if (!wanted.has(id)) await deps.store.removeVersion(id).catch(() => undefined);
    for (const id of [...memory.keys()]) if (!wanted.has(id)) memory.delete(id);
  }

  const ready = () =>
    (started ??= (async () => {
      if (!base) return;
      const text = await deps.store.readManifest(deps.environment).catch(() => null);
      if (!text) return;
      try {
        const saved = JSON.parse(text) as { etag?: string | null; text?: string };
        const m = typeof saved.text === 'string' ? parseManifest(saved.text, deps.environment, deps.knownReciter, manifestOptions) : null;
        if (m) {
          etag = typeof saved.etag === 'string' ? saved.etag : null;
          install(m);
        }
      } catch {
        // an unreadable stored manifest is ignored; the next refresh replaces it
      }
    })());

  async function refresh(options: { force?: boolean } = {}): Promise<RefreshResult> {
    if (!base) return 'disabled';
    await ready();
    if (!options.force && now() - checkedAt < interval) return 'skipped';
    let answer: Awaited<ReturnType<ConditionalFetch>>;
    try {
      answer = await deps.fetch(`${base}/v1/audio-timing/${deps.environment}/manifest`, etag);
    } catch {
      return 'offline';
    }
    if (answer.status === 304) {
      checkedAt = now();
      log('manifest unchanged (304)');
      return 'unchanged';
    }
    if (answer.status !== 200) return answer.status >= 500 || answer.status === 429 ? 'offline' : 'invalid';
    const m = parseManifest(answer.text, deps.environment, deps.knownReciter, manifestOptions);
    if (!m) return 'invalid';
    checkedAt = now();
    etag = answer.etag;
    const changed = JSON.stringify(m) !== JSON.stringify(pending ?? current);
    await deps.store.writeManifest(deps.environment, JSON.stringify({ etag, text: answer.text })).catch(() => undefined);
    if (!changed) return 'unchanged';
    apply(m);
    await collect(m);
    return 'updated';
  }

  /** Playback left the held surah (or stopped): a waiting manifest takes effect now. */
  function settle() {
    if (pending) apply(pending);
  }

  const entry = (reciterId: string, surah: number): VerifiedEntry | null => byKey.get(keyOf(reciterId, surah)) ?? null;
  const isRejected = (reciterId: string, surah: number) => rejected.has(keyOf(reciterId, surah));

  async function fromStore(e: VerifiedEntry): Promise<SurahTiming | null> {
    const cached = memory.get(e.versionId);
    if (cached) return cached;
    const text = await deps.store.readVersion(e.versionId).catch(() => null);
    const timing = text ? verifyVersion(text, e) : null;
    if (timing) memory.set(e.versionId, timing);
    return timing;
  }

  async function load(e: VerifiedEntry): Promise<VerifiedLoad> {
    const local = await fromStore(e);
    if (local) {
      log('version from the device', { key: keyOf(e.reciterId, e.surah), versionNo: e.versionNo, versionId: e.versionId });
      return { ok: true, timing: local };
    }
    if (!base) return { ok: false, reason: 'network' };
    const pendingLoad = inFlight.get(e.versionId);
    if (pendingLoad) return pendingLoad;
    const request = (async (): Promise<VerifiedLoad> => {
      let answer: Awaited<ReturnType<ConditionalFetch>>;
      try {
        answer = await deps.fetch(`${base}/v1/audio-timing/versions/${e.versionId}`, null);
      } catch {
        return { ok: false, reason: 'network' };
      }
      if (answer.status !== 200) return { ok: false, reason: answer.status >= 500 || answer.status === 429 ? 'network' : 'mismatch' };
      const timing = verifyVersion(answer.text, e);
      log(timing ? 'version downloaded and verified' : 'version REFUSED (validation failed)', { key: keyOf(e.reciterId, e.surah), versionNo: e.versionNo, versionId: e.versionId });
      if (!timing) return { ok: false, reason: 'mismatch' };
      memory.set(e.versionId, timing);
      await deps.store.writeVersion(e.versionId, answer.text).catch(() => undefined);
      return { ok: true, timing };
    })();
    inFlight.set(e.versionId, request);
    try {
      return await request;
    } finally {
      inFlight.delete(e.versionId);
    }
  }

  return {
    ready,
    refresh,
    settle,
    entry,
    rejected: isRejected,
    load,
    stored: fromStore,
    entries: () => current.entries,
    /** The published recording with this URL (for the stream check), or null. */
    byUrl: (url: string) => current.entries.find((e) => e.audio.url === url) ?? null,
    hasPending: () => pending !== null,
    setInUse(fn: () => string | null) {
      inUse = fn;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    enabled: base !== null,
  };
}
