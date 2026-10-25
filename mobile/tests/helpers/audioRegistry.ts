import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, type GeneratedSurahOnlySource } from '@/audio/generated/sourceRegistry';
import { getReciter, RECITERS, type Reciter } from '@/audio/reciters';
import { createSourceRegistry, type AudioSource, type Provider } from '@/audio/sourceRegistry';

/** An approved whole-surah source, as surah-mode-approvals.json would give it (every field filled). */
export function approval(reciterId: string, surah: number, patch: Partial<GeneratedSurahOnlySource> = {}): GeneratedSurahOnlySource {
  const reciter = getReciter(reciterId)!;
  return {
    reciterId,
    surah,
    provider: 'mp3quran',
    url: `${reciter.server}${String(surah).padStart(3, '0')}.mp3`,
    bytes: 1_000_000 + surah,
    durationMs: 600_000 + surah * 1000,
    kbps: 128,
    sampleRateHz: 44100,
    bitrateMode: 'cbr',
    completeness: { method: 'test', evidence: 'fixture', checkedOn: '2026-10-18' },
    identity: { method: 'test', evidence: 'fixture', checkedOn: '2026-10-18' },
    riwayah: { value: 'hafs', evidence: 'fixture' },
    listening: { by: 'test', on: '2026-10-18', notes: '' },
    approvedBy: 'test',
    approvedOn: '2026-10-18',
    ...patch,
  };
}

/**
 * The app's reciters with only the MP3Quran catalogue's own timing (no released reviewed, VBR or timed-preview surahs):
 * for fixtures that need a catalogue surah with no timing, independent of what a release adds.
 */
export const CATALOGUE_RECITERS: readonly Reciter[] = RECITERS.map((r) => (GENERATED_RECITERS.find((g) => g.id === r.id) as Reciter | undefined) ?? r);

/** Fixture registries enable whole-surah playback (off in the app) unless told otherwise: it tests that dormant path. */
export function fixtureRegistry(options: { surahOnly?: GeneratedSurahOnlySource[]; extra?: AudioSource[]; providers?: Provider[]; offlineSwitch?: boolean; surahOnlyPlayback?: boolean; reciters?: readonly Reciter[] } = {}) {
  return createSourceRegistry({
    reciters: options.reciters ?? RECITERS,
    providers: options.providers ?? GENERATED_PROVIDERS,
    formats: GENERATED_FORMATS,
    surahOnly: options.surahOnly ?? [],
    extra: options.extra,
    offlineSwitch: options.offlineSwitch,
    surahOnlyPlayback: options.surahOnlyPlayback ?? true,
  });
}
