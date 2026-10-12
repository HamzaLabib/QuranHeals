"""Every word's advance on every page, for the selection audit (2026-10-12).

  python tools/mushaf-audit/export_word_advances.py <fonts dir> <records-*.json.gz> <out.json> [--pages 1,2,5]

Writes {page: [[line, [[verseKey, position, kind, advance], ...]], ...]} (advance in font units, 2048 per em; words in
reading order), which mobile/tests/mushafSelectionAudit.test.ts lays out as the app does to check the selection
highlight and taps on every ayah. The full output (all 604 pages) holds no glyph codes but is large: keep it outside
the repository and pass its path in QPC_V1_ADVANCES. With --pages it writes a small fixture.
"""
import gzip, json, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ONLY = [int(p) for p in sys.argv[sys.argv.index('--pages') + 1].split(',')] if '--pages' in sys.argv else list(range(1, 605))
ROOT = Path(__file__).resolve().parents[2]
COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
VERSE_KEYS = [f'{s + 1}:{a + 1}' for s, n in enumerate(COUNTS) for a in range(n)]
recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in recs: pages[r['page_number']].append(r)
out = {}
for page in ONLY:
    f = TTFont(f'{FONTS}/p{page}.ttf'); cmap = f.getBestCmap(); hm = f['hmtx']
    lines = defaultdict(list)
    for r in sorted(pages[page], key=lambda r: r['position_in_page']):
        adv = sum(hm[cmap[ord(ch)]][0] for ch in r['text'])
        lines[r['line_number']].append([VERSE_KEYS[r['verse_id'] - 1], r['position_in_verse'], 'end' if r['char_type_name'] == 'end' else 'word', adv])
    out[page] = [[ln, words] for ln, words in sorted(lines.items())]
json.dump(out, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
print('pages', len(out))
