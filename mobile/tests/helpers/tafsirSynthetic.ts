import { TAFSIR_FORMAT } from '@/tafsir/dataset';
import type { TafsirEditionId } from '@/tafsir/editions';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** SYNTHETIC tafsir editions for the tests («نص تجريبي»): every ayah covered, with optional passages. */
export type Entry = [number, number, string];
export function syntheticSurahs(ranges: Record<number, [number, number][]> = {}): Entry[][] {
  return SURAH_AYAH_COUNTS.map((count, i) => {
    const surah = i + 1;
    const list: Entry[] = [];
    const passages = ranges[surah] ?? [];
    for (let ayah = 1; ayah <= count;) {
      const passage = passages.find(([from]) => from === ayah);
      const to = passage ? passage[1] : ayah;
      list.push([ayah, to, `نص تجريبي ${surah}:${ayah}${to > ayah ? `-${to}` : ''}`]);
      ayah = to + 1;
    }
    return list;
  });
}
export function syntheticFile(edition: TafsirEditionId, surahs = syntheticSurahs()) {
  return {
    format: TAFSIR_FORMAT,
    version: 1,
    edition,
    language: 'ar',
    source: { title: 'تفسير تجريبي', publisher: 'ناشر تجريبي', url: 'https://example.invalid/', retrieved: '2026-11-06', sha256: '0'.repeat(64) },
    surahs,
  };
}
