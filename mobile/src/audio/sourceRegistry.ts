import {
  GENERATED_FORMATS,
  GENERATED_PROVIDERS,
  GENERATED_SURAH_ONLY,
  type BitrateEvidence,
  type BitrateMode,
  type GeneratedProvider,
  type GeneratedRecordingFormat,
  type GeneratedSurahOnlySource,
} from './generated/sourceRegistry';
import { OFFLINE_DOWNLOADS_PERMITTED, RECITERS, timingSourceOf, type Reciter } from './reciters';
import { isPreviewSurah } from './timedPreview';

/**
 * The universal source registry: for every reciter and surah, the recordings that exist, what was verified about
 * each, and so how (or whether) the surah may play.
 *
 * Two playback capabilities, decided per reciter and surah from the source's own record, never from a network answer:
 *  - 'ayah': start at any ayah, follow and highlight ayahs. Needs a complete recording of the right reciter and riwayah,
 *    streaming permitted, validated ayah timing for that exact file, and exact seeking (a CBR file with byte ranges).
 *  - 'surah': the whole surah from its start, with no ayah ever shown. Needs the same, except the ayah timing: it has
 *    none, or none that can be used.
 *  - 'none': nothing that may play. The player says so; another reciter is never substituted.
 *
 * Sources are listed per reciter, so resolving one can never reach another reciter's recording. MP3Quran is the
 * preferred provider (priority 0). Its files exist only for the surahs its catalogue lists for a recording (an unlisted
 * surah's URL redirects to another Sheikh), and a URL is never built for any other surah. Fallbacks are other verified,
 * permitted sources of the same reciter and surah with the same capability, in priority order; for ayah playback a
 * fallback must also carry the same validated timing.
 */
export type ProviderId = 'mp3quran' | 'way2quran' | 'assabile' | (string & {});

export type Permission = { permitted: boolean; evidence: string };

export type Provider = Omit<GeneratedProvider, 'id' | 'streaming' | 'offline'> & { id: ProviderId; streaming: Permission; offline: Permission };

export type VerificationStatus = 'verified' | 'unverified' | 'failed';

export type AudioSource = {
  reciterId: string;
  surah: number;
  provider: ProviderId;
  /** The streaming URL. */
  url: string;
  /** The file's size when verified (a different size is a different file); null: never verified. */
  bytes: number | null;
  /** The file's length when verified (whole-surah sources: checked again once loaded); null: not recorded. */
  durationMs: number | null;
  format: {
    kbps: number;
    sampleRateHz: number;
    /** CBR or VBR: a VBR file never plays ayah by ayah (its seeks land 0.5-1.8 s off), unless `vbrIndexSeek`. */
    bitrateMode: BitrateMode;
    bitrateEvidence: BitrateEvidence;
    /** Exact seeking: the file is CBR and its host answers byte-range requests. */
    exactSeek: boolean;
    /** The host answers byte-range requests (audited). */
    rangeRequests: boolean;
    /** A VBR file the installed binary seeks exactly (vbrSeek.ts; development, patched binaries only). */
    vbrIndexSeek?: true;
  };
  /** The whole surah is in the file, first to last ayah. */
  completeness: { status: VerificationStatus; evidence: string };
  /** The voice is this reciter's (and the file is not a redirect to another recording). */
  identity: { status: VerificationStatus; evidence: string };
  riwayah: { value: 'hafs' | null; status: 'confirmed' | 'unconfirmed'; evidence: string };
  timing:
    | { status: 'verified'; kind: 'mp3quran' | 'measured'; fingerprint: string }
    | { status: 'none' | 'rejected'; reason: string };
  /** Lower is preferred. MP3Quran: 0. */
  priority: number;
  validation: { auditedOn: string; method: string };
};

export type CapabilityMode = 'ayah' | 'surah' | 'none';

export type Capability =
  | { mode: 'ayah' | 'surah'; sources: readonly AudioSource[] }
  | {
      mode: 'none';
      /**
       * 'no-recording': no source for this surah; 'not-permitted': sources exist, none the provider permits streaming;
       * 'not-verified': permitted sources exist, none verified complete, of this reciter, Hafs, and usable.
       */
      reason: 'no-recording' | 'not-permitted' | 'not-verified';
    };

const MP3QURAN_PRIORITY = 0;
const EXTERNAL_PRIORITY = 10;

const MP3QURAN_TIMED_COMPLETENESS =
  'Every ayah located in this file: verified ayah timing (complete Kufan ayah set, ordered, inside the audio, boundaries checked in the audio itself).';
const MP3QURAN_IDENTITY =
  "Listed in MP3Quran's catalogue under this reciter's recording; audited size differs from every other recording's file of the surah (no redirect).";

function formatOf(format: GeneratedRecordingFormat | undefined, surah: number): AudioSource['format'] | null {
  if (!format) return null;
  const exception = format.exceptions[surah];
  const [kbps, sampleRateHz, bitrateMode, bitrateEvidence] = exception ?? [format.kbps, format.sampleRateHz, format.bitrateMode, format.bitrateEvidence];
  return { kbps, sampleRateHz, bitrateMode, bitrateEvidence, exactSeek: bitrateMode === 'cbr' && format.rangeRequests, rangeRequests: format.rangeRequests };
}

function riwayahOf(reciter: Reciter, timed: boolean): AudioSource['riwayah'] {
  if (reciter.riwayaLabel === 'hafs') return { value: 'hafs', status: 'confirmed', evidence: 'MP3Quran labels the recording حفص عن عاصم.' };
  // Unlabelled (Maher's mujawwad): Hafs is confirmed per surah only by its verified Kufan ayah timing.
  if (timed) return { value: 'hafs', status: 'confirmed', evidence: 'Unlabelled by MP3Quran; the verified ayah timing follows the Kufan count (Hafs).' };
  return { value: null, status: 'unconfirmed', evidence: 'MP3Quran names no riwayah for this recording, and this surah has no verified timing.' };
}

/** The MP3Quran source of one listed surah of a catalogue recording (playable or not: the record says why). */
function mp3quranSource(reciter: Reciter, surah: number, format: AudioSource['format'], auditedOn: string, approved: GeneratedSurahOnlySource | undefined): AudioSource {
  const timed = reciter.timed[surah];
  const url = `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
  const kind = timingSourceOf(reciter, surah);
  const timing: AudioSource['timing'] = timed && kind
    ? { status: 'verified', kind, fingerprint: timed[0] }
    : reciter.timingSource === null
      ? { status: 'none', reason: 'No ayah timing exists for this recording.' }
      : { status: 'rejected', reason: 'The timing for this surah failed the audit (tools/quran-audio/audit-results.json, "excluded").' };
  if (timed) {
    return {
      reciterId: reciter.id, surah, provider: 'mp3quran', url, bytes: timed[1], durationMs: null, format, timing, priority: MP3QURAN_PRIORITY,
      completeness: { status: 'verified', evidence: MP3QURAN_TIMED_COMPLETENESS },
      identity: { status: 'verified', evidence: MP3QURAN_IDENTITY },
      riwayah: riwayahOf(reciter, true),
      validation: reciter.developmentSurahs?.includes(surah)
        ? { auditedOn, method: 'DEVELOPMENT ONLY: measured timing (tools/quran-audio/development), listening review pending' }
        : reciter.releasedSurahs?.includes(surah)
          ? { auditedOn, method: 'Reviewed aligned timing (Reviewer 1 and automatic acceptance), released after every gate including physical-device tests (tools/quran-audio/development/generate-timing-release.mjs)' }
          : { auditedOn, method: 'tools/quran-audio audit (structural, acoustic, boundary sweep) and check-live.mjs' },
    };
  }
  if (approved) {
    return {
      reciterId: reciter.id, surah, provider: 'mp3quran', url, bytes: approved.bytes, durationMs: approved.durationMs, format, timing, priority: MP3QURAN_PRIORITY,
      completeness: { status: 'verified', evidence: `${approved.completeness.method}: ${approved.completeness.evidence} (${approved.completeness.checkedOn})` },
      identity: { status: 'verified', evidence: `${approved.identity.method}: ${approved.identity.evidence} (${approved.identity.checkedOn})` },
      riwayah: { value: 'hafs', status: 'confirmed', evidence: approved.riwayah.evidence },
      validation: { auditedOn: approved.approvedOn, method: `Listened by ${approved.listening.by} (${approved.listening.on}); approved by ${approved.approvedBy}` },
    };
  }
  // Listed by MP3Quran, but nothing establishes that the whole surah is in the file: never played.
  return {
    reciterId: reciter.id, surah, provider: 'mp3quran', url, bytes: null, durationMs: null, format, timing, priority: MP3QURAN_PRIORITY,
    completeness: { status: 'unverified', evidence: "Listed in MP3Quran's catalogue; completeness not established (no verified timing, no approved check)." },
    identity: { status: 'unverified', evidence: "Listed in MP3Quran's catalogue only." },
    riwayah: riwayahOf(reciter, false),
    validation: { auditedOn, method: 'Catalogue listing and file header only' },
  };
}

/** An approved whole-surah source from another provider. */
function externalSource(approved: GeneratedSurahOnlySource): AudioSource {
  return {
    reciterId: approved.reciterId,
    surah: approved.surah,
    provider: approved.provider,
    url: approved.url,
    bytes: approved.bytes,
    durationMs: approved.durationMs,
    // Byte ranges are not assumed for another provider: its stream check is HEAD only.
    format: { kbps: approved.kbps, sampleRateHz: approved.sampleRateHz, bitrateMode: approved.bitrateMode, bitrateEvidence: 'first-frame', exactSeek: false, rangeRequests: false },
    completeness: { status: 'verified', evidence: `${approved.completeness.method}: ${approved.completeness.evidence} (${approved.completeness.checkedOn})` },
    identity: { status: 'verified', evidence: `${approved.identity.method}: ${approved.identity.evidence} (${approved.identity.checkedOn})` },
    riwayah: { value: 'hafs', status: 'confirmed', evidence: approved.riwayah.evidence },
    timing: { status: 'none', reason: 'No validated ayah timing for this file.' },
    priority: EXTERNAL_PRIORITY,
    validation: { auditedOn: approved.approvedOn, method: `Listened by ${approved.listening.by} (${approved.listening.on}); approved by ${approved.approvedBy}` },
  };
}

export type RegistryData = {
  reciters: readonly Reciter[];
  providers: readonly Provider[];
  formats: Readonly<Record<string, GeneratedRecordingFormat>>;
  surahOnly: readonly GeneratedSurahOnlySource[];
  /** Extra sources (tests, and providers added later): validated by the same rules. */
  extra?: readonly AudioSource[];
  /** The app-wide offline switch (reciters.ts). */
  offlineSwitch?: boolean;
  /**
   * Whole-surah playback without ayah timing ('surah' capability). Off in the app (Phase 4, 2026-10-18: every recording
   * plays ayah by ayah with verified timing, or not at all); kept as a capability for tests and a possible later use.
   */
  surahOnlyPlayback?: boolean;
};

/** Untimed whole-surah playback is not offered in the app. */
export const SURAH_ONLY_PLAYBACK = false;

export function createSourceRegistry(data: RegistryData) {
  const providers = new Map(data.providers.map((p) => [p.id, p]));
  const reciters = new Map(data.reciters.map((r) => [r.id, r]));
  const approved = new Map(data.surahOnly.map((s) => [`${s.reciterId}:${s.surah}:${s.provider}`, s]));
  const cache = new Map<string, readonly AudioSource[]>();
  const coverageCache = new Map<string, { readonly ayah: readonly number[]; readonly surah: readonly number[] }>();
  const offlineSwitch = data.offlineSwitch ?? OFFLINE_DOWNLOADS_PERMITTED;
  const surahOnlyPlayback = data.surahOnlyPlayback ?? SURAH_ONLY_PLAYBACK;

  /** Every source of a reciter's surah, playable or not, most preferred first. */
  const sourcesFor = (reciterId: string, surah: number): readonly AudioSource[] => {
    const key = `${reciterId}:${surah}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const reciter = reciters.get(reciterId);
    const list: AudioSource[] = [];
    // A timed preview surah plays its own file (timedPreview.ts), never the catalogue's: no MP3Quran source carries its timing.
    if (reciter && reciter.server !== null && reciter.surahs.includes(surah) && !isPreviewSurah(reciter, surah)) {
      const listed = formatOf(data.formats[reciter.id], surah);
      // A VBR file the binary seeks exactly (vbrSeek.ts; development, patched binaries only): seekable like a CBR file.
      const format = listed && listed.bitrateMode === 'vbr' && reciter.vbrIndexSeekSurahs?.includes(surah) ? { ...listed, exactSeek: listed.rangeRequests, vbrIndexSeek: true as const } : listed;
      if (format) list.push(mp3quranSource(reciter, surah, format, data.formats[reciter.id].auditedOn, approved.get(`${reciterId}:${surah}:mp3quran`)));
    }
    for (const s of data.surahOnly) if (s.reciterId === reciterId && s.surah === surah && s.provider !== 'mp3quran') list.push(externalSource(s));
    for (const s of data.extra ?? []) if (s.reciterId === reciterId && s.surah === surah) list.push(s);
    // Defence in depth: whatever the data says, a source of another reciter or surah never resolves here.
    const own = list.filter((s) => s.reciterId === reciterId && s.surah === surah).sort((a, b) => a.priority - b.priority);
    cache.set(key, own);
    return own;
  };

  const streamingPermitted = (source: AudioSource) => providers.get(source.provider)?.streaming.permitted === true;
  const trusted = (source: AudioSource) =>
    source.bytes !== null && source.completeness.status === 'verified' && source.identity.status === 'verified' && source.riwayah.status === 'confirmed' && source.riwayah.value === 'hafs';
  const ayahReady = (source: AudioSource) => source.timing.status === 'verified' && (source.format.bitrateMode === 'cbr' || source.format.vbrIndexSeek === true) && source.format.exactSeek;

  const capability = (reciterId: string, surah: number): Capability => {
    const all = sourcesFor(reciterId, surah);
    if (all.length === 0) return { mode: 'none', reason: 'no-recording' };
    const permitted = all.filter(streamingPermitted);
    if (permitted.length === 0) return { mode: 'none', reason: 'not-permitted' };
    const usable = permitted.filter(trusted);
    const ayah = usable.filter(ayahReady);
    if (ayah.length > 0) {
      // A fallback must carry the same validated timing: the timing belongs to one exact recording.
      const first = ayah[0].timing;
      const same = ayah.filter((s) => s.timing.status === 'verified' && first.status === 'verified' && s.timing.fingerprint === first.fingerprint && s.bytes === ayah[0].bytes);
      return { mode: 'ayah', sources: same };
    }
    // A whole-surah source needs its verified length too: the app checks the loaded stream against it.
    const whole = usable.filter((s) => s.durationMs !== null && s.durationMs > 0);
    if (whole.length > 0 && surahOnlyPlayback) return { mode: 'surah', sources: whole };
    return { mode: 'none', reason: 'not-verified' };
  };

  let byUrl: Map<string, AudioSource> | null = null;
  /** The registered source with this URL (any reciter), or null: what a stream check compares the stream with. */
  const sourceByUrl = (url: string): AudioSource | null => {
    if (!byUrl) {
      byUrl = new Map();
      for (const reciter of data.reciters) for (let surah = 1; surah <= 114; surah++) for (const source of sourcesFor(reciter.id, surah)) byUrl.set(source.url, source);
    }
    return byUrl.get(url) ?? null;
  };

  return {
    sourcesFor,
    sourceByUrl,
    capability,
    mode: (reciterId: string, surah: number): CapabilityMode => capability(reciterId, surah).mode,
    provider: (id: ProviderId) => providers.get(id) ?? null,
    /** Whether a playable source may be stored on the device: the app's switch and the provider's own permission. */
    offlinePermitted: (source: AudioSource) => offlineSwitch && providers.get(source.provider)?.offline.permitted === true && trusted(source),
    /**
     * Whether a reciter's offline download may run: the app's switch, and every source it would store (its ayah
     * sources: downloads hold only surahs that play ayah by ayah) from a provider that permits offline storage.
     */
    reciterOfflinePermitted(reciterId: string): boolean {
      if (!offlineSwitch) return false;
      let any = false;
      for (let surah = 1; surah <= 114; surah++) {
        const cap = capability(reciterId, surah);
        if (cap.mode !== 'ayah') continue;
        any = true;
        if (!(providers.get(cap.sources[0].provider)?.offline.permitted === true && trusted(cap.sources[0]))) return false;
      }
      return any;
    },
    /** Attribution the app must show for the providers it plays from. */
    attributions(): string[] {
      const lines = new Set<string>();
      for (const reciter of data.reciters) {
        for (let surah = 1; surah <= 114; surah++) {
          const cap = capability(reciter.id, surah);
          if (cap.mode === 'none') continue;
          for (const source of cap.sources) {
            const attribution = providers.get(source.provider)?.attribution;
            if (attribution?.required) lines.add(attribution.text);
          }
        }
      }
      return [...lines];
    },
    /** Surahs a reciter can play, by capability. */
    coverage(reciterId: string): { readonly ayah: readonly number[]; readonly surah: readonly number[] } {
      const cached = coverageCache.get(reciterId);
      if (cached) return cached;
      const out = { ayah: [] as number[], surah: [] as number[] };
      for (let s = 1; s <= 114; s++) {
        const mode = capability(reciterId, s).mode;
        if (mode !== 'none') out[mode].push(s);
      }
      coverageCache.set(reciterId, out);
      return out;
    },
  };
}

export type SourceRegistry = ReturnType<typeof createSourceRegistry>;

/** The app's registry: the audited catalogue, its formats, and the approved whole-surah sources. */
export const SOURCE_REGISTRY: SourceRegistry = createSourceRegistry({
  reciters: RECITERS,
  providers: GENERATED_PROVIDERS,
  formats: GENERATED_FORMATS,
  surahOnly: GENERATED_SURAH_ONLY,
});
