import { GENERATED_FORMATS, GENERATED_PROVIDERS, type GeneratedSurahOnlySource } from '@/audio/generated/sourceRegistry';
import { getReciter, RECITERS } from '@/audio/reciters';
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

/** Fixture registries enable whole-surah playback (off in the app) unless told otherwise: it tests that dormant path. */
export function fixtureRegistry(options: { surahOnly?: GeneratedSurahOnlySource[]; extra?: AudioSource[]; providers?: Provider[]; offlineSwitch?: boolean; surahOnlyPlayback?: boolean } = {}) {
  return createSourceRegistry({
    reciters: RECITERS,
    providers: options.providers ?? GENERATED_PROVIDERS,
    formats: GENERATED_FORMATS,
    surahOnly: options.surahOnly ?? [],
    extra: options.extra,
    offlineSwitch: options.offlineSwitch,
    surahOnlyPlayback: options.surahOnlyPlayback ?? true,
  });
}
