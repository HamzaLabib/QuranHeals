import { REFERENCE_PAGE_61, type QpcV1PageLayout, type QpcV1Word } from '@/mushaf/qpcV1Layout';

/**
 * A SYNTHETIC QPC V1 layout for page 61, built only from our own data: the
 * verified Tanzil word count of each ayah and the line breaks transcribed
 * from Reference Design.jpg (REFERENCE_PAGE_61). Glyph codes are made up
 * (private-use characters) — no Quran Foundation content is stored in this
 * repository.
 */
export const TANZIL_WORD_COUNTS_3_84_TO_91: Record<string, number> = {
  '3:84': 29, '3:85': 13, '3:86': 18, '3:87': 9, '3:88': 9, '3:89': 11, '3:90': 14, '3:91': 24,
};

export function syntheticQpcPage61(overrides: { dropWord?: string; fetchedAt?: string; keepDays?: number } = {}): QpcV1PageLayout {
  const starts = REFERENCE_PAGE_61.lineStarts.map(([verseKey, word]) => `${verseKey}#${word}`);
  const lines: { line: number; words: QpcV1Word[] }[] = [];
  let line = 0;
  let glyph = 0xe000;
  for (const [verseKey, count] of Object.entries(TANZIL_WORD_COUNTS_3_84_TO_91)) {
    const words = overrides.dropWord === verseKey ? count - 1 : count;
    for (let position = 1; position <= words; position += 1) {
      if (starts.includes(`${verseKey}#${position}`)) {
        line += 1;
        lines.push({ line, words: [] });
      }
      lines[lines.length - 1].words.push({ verseKey, position, kind: 'word', glyph: String.fromCharCode(glyph++) });
    }
    lines[lines.length - 1].words.push({ verseKey, position: words + 1, kind: 'end', glyph: String.fromCharCode(glyph++) });
  }
  // Fetched an hour ago by default, so the layout is inside its retention window whenever the tests run
  // (a fixed date made every test that loads it through the real clock fail once it expired, 2026-10-18).
  const fetchedAt = overrides.fetchedAt ?? new Date(Date.now() - 3600_000).toISOString();
  return {
    page: 61,
    edition: 'qpc-v1',
    fontFamily: 'QCF_P061',
    lines,
    verseKeys: Object.keys(TANZIL_WORD_COUNTS_3_84_TO_91),
    fetchedAt,
    keepUntil: new Date(Date.parse(fetchedAt) + (overrides.keepDays ?? 7) * 24 * 3600 * 1000).toISOString(),
  };
}
