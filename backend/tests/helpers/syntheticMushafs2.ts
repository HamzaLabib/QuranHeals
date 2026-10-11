import { mushafWordCount, verseIndex, type RawRecord } from '../../src/mushaf/offline/dataset';
import { canonicalQuran } from '../../src/mushaf/offline/setup';

/**
 * A SYNTHETIC mushafs:2 resource in Content Sync's record shapes: 604 pages
 * of 15 lines holding all 6,236 ayahs, each with as many words as the
 * verified Tanzil text (less its basmala and documented joined pairs) plus
 * one marker. Glyph codes are made up (private-use characters). No Quran
 * Foundation data is used or stored.
 */
export function syntheticMushafs2Records(): RawRecord[] {
  const quran = canonicalQuran();
  const index = verseIndex(quran.surahCounts);
  const basmala = quran.text('1:1').trim().split(/\s+/);
  const records: RawRecord[] = [{
    record_type: 'mushaf', id: 2, resource_content_id: null, name: 'QCF V1', description: 'Synthetic test Mushaf',
    pages_count: 604, lines_per_page: 15, default_font_name: 'v1', mapping_mode: 'reference', qirat: { id: 1, name: 'Hafs' },
  }];
  // Ayahs per page: 6,236 spread over 604 pages (10 or 11 each), in order.
  const perPage = (page: number) => Math.floor((page * 6236) / 604) - Math.floor(((page - 1) * 6236) / 604);
  let verse = 1;
  let recordId = 1;
  let wordId = 1;
  for (let page = 1; page <= 604; page++) {
    const first = verse;
    const count = perPage(page);
    const words: RawRecord[] = [];
    for (let v = verse; v < verse + count; v++) {
      const key = index.keyOf(v)!;
      const { words: n } = mushafWordCount(key, quran.text(key), basmala);
      for (let p = 1; p <= n + 1; p++) {
        words.push({
          record_type: 'mushaf_word', id: recordId++, mushaf_id: 2, word_id: wordId++, verse_id: v, source_verse_id: v,
          text: String.fromCharCode(0xe000 + (p % 4000)), char_type_id: p > n ? 3 : 1, char_type_name: p > n ? 'end' : 'word',
          page_number: page, line_number: 0, position_in_verse: p, position_in_line: 0, position_in_page: words.length + 1,
          css_class: null, css_style: null,
        });
      }
    }
    // Spread the page's words over its 15 lines; position_in_line deliberately starts each line with
    // the line's last number, as Quran Foundation's data does, to prove order comes from position_in_page.
    const perLine = Math.ceil(words.length / 15);
    words.forEach((word, i) => {
      word.line_number = Math.min(15, Math.floor(i / perLine) + 1);
    });
    for (let l = 1; l <= 15; l++) {
      const own = words.filter((word) => word.line_number === l);
      own.forEach((word, i) => { word.position_in_line = i === 0 ? own.length : i; });
    }
    records.push({
      record_type: 'mushaf_page', id: page, mushaf_id: 2, page_number: page,
      first_verse_id: first, last_verse_id: verse + count - 1, first_word_id: words[0].word_id, last_word_id: words[words.length - 1].word_id,
      verses_count: count, verse_mapping: {}, updated_at: '2026-01-01T00:00:00.000Z',
    });
    records.push(...words);
    verse += count;
  }
  return records;
}

/** The records as a Content Sync snapshot body, streamed in `chunkSize`-byte pieces. */
export function snapshotStream(records: RawRecord[], options: { sequence?: number; chunkSize?: number; failAfterBytes?: number } = {}) {
  const json = JSON.stringify({ resource_group: 'mushafs', resource_id: 2, resource_content_id: null, schema_version: 1, sync_sequence: options.sequence ?? 100, records });
  const bytes = new TextEncoder().encode(json);
  const size = options.chunkSize ?? 65536;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfterBytes !== undefined && offset >= options.failAfterBytes) {
        controller.error(new TypeError('connection reset'));
        return;
      }
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}
