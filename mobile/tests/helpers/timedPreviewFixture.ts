import { timingFingerprint } from '@/audio/timingFingerprint';
import type { TimedPreviewRecording } from '@/audio/timedPreview';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** A synthetic timed preview (audio/timedPreview.ts) for Ahmed Mohamed Salama: ayah 1 heard from 5 s, every ayah 4 s. */
export const ONSET = 5000;
export const LEN = 4000;
export function surahOf(surah: number, host = 'media.assabile.com') {
  const n = SURAH_AYAH_COUNTS[surah - 1];
  const deltas = [ONSET, ...Array.from({ length: n }, () => LEN)];
  const entries = Array.from({ length: n }, (_, i) => ({ ayah: i + 1, startMs: ONSET + i * LEN, endMs: ONSET + (i + 1) * LEN }));
  return { provider: host.split('.')[1], url: `https://${host}/ahmed/${String(surah).padStart(3, '0')}.mp3`, bytes: 100_000 + surah, durationMs: ONSET + n * LEN + 2000, fingerprint: timingFingerprint(entries), deltas };
}
export const TIMED_FIXTURE: TimedPreviewRecording = {
  reciterId: 'ahmed-salama', evidence: 'fixture', generatedOn: '2026-10-23',
  surahs: {
    1: surahOf(1),
    112: surahOf(112),
    113: surahOf(113, 'media.way2quran.com'),
    // Not playable: an ayah missing, and a fingerprint that is not the timing's.
    2: { ...surahOf(2), deltas: surahOf(2).deltas.slice(0, -1) },
    3: { ...surahOf(3), fingerprint: '00000000' },
  },
};
