"""Horizontal ink audit of the QCF V1 renderer, all 604 pages (2026-10-12).

Why: iOS and Android draw a Text only within its own frame. Each Quran word is its own Text, and its frame is
the glyph's advance, but QCF V1 glyphs put ink outside their advance: the dots of an initial ت, the kasra
under an initial إِ, the hamzat al-wasl, every waqf sign. audit_glyph_bounds.py checked only the vertical
extent, and the browser does not clip, so neither caught it. Ink is measured from the real outlines:
contours that enclose area (QCF V1 fonts also hold single-point contours, which draw nothing but stretch the
fonts' own bounding boxes by up to 2 em).

Checks, per page font and per word of the Content Sync layout:
  1. every glyph code is in its own page's font (else iOS would fall back to another font);
  2. ink outside the word's advance (what the former Text clipped), and outside the advance plus
     QCF_V1_INK_OVERFLOW_EM on each side (what the current Text draws): the latter must be none;
  3. the first and last word of each line: ink beyond the text area must stay inside the inner frame;
  4. each ayah marker's ring (its exact ink box), written to mobile/src/mushaf/generated/ayahMarkerInk.ts
     so each medallion is sized and centred on its own glyph, on every page.

  python tools/mushaf-audit/audit_ink_overflow.py <fonts dir> <records-*.json.gz> <report.json> [--write-marker-ink]
"""
import gzip, json, re, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
WRITE_MARKER_INK = '--write-marker-ink' in sys.argv
ROOT = Path(__file__).resolve().parents[2]
MARKERS_TS = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
PAD_EM = float(re.search(r'QCF_V1_INK_OVERFLOW_EM = ([\d.]+);', MARKERS_TS).group(1))
COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
VERSE_KEYS = [f'{s + 1}:{a + 1}' for s, n in enumerate(COUNTS) for a in range(n)]
FIT = 0.985


class InkPen(BasePen):
    """Outline points (curves sampled finely), per contour; contours enclosing no area are dropped."""
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours, self.cur = [], []

    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)

    def _qCurveToOne(self, a, b):
        p0 = self.cur[-1]
        for i in range(1, 17):
            t = i / 16; u = 1 - t
            self.cur.append((u * u * p0[0] + 2 * u * t * a[0] + t * t * b[0], u * u * p0[1] + 2 * u * t * a[1] + t * t * b[1]))

    def _curveToOne(self, a, b, c):
        p0 = self.cur[-1]
        for i in range(1, 17):
            t = i / 16; u = 1 - t
            self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * c[0],
                             u ** 3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * c[1]))

    def _closePath(self):
        pts = self.cur
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2 if len(pts) > 2 else 0
        if abs(area) > 1:
            self.contours.append(pts)
        self.cur = []

    _endPath = _closePath


def ink_box(glyph_set, name):
    pen = InkPen(glyph_set)
    glyph_set[name].draw(pen)
    pts = [p for c in pen.contours for p in c]
    if not pts:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs), max(xs), min(ys), max(ys))


def text_area(tiles_down=29, W=1000.0):
    tile = W / 20
    inner_w = W - 2 * tile
    inset_x = W * 25 / 593
    return inner_w - 2 * inset_x, inset_x


records = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in records:
    pages[r['page_number']].append(r)

summary = {'pages': 0, 'words': 0, 'glyphs': 0, 'missingGlyphs': [], 'wordsInkOutsideAdvance': 0, 'wordsInkOutsideAdvanceByKind': defaultdict(int),
           'pagesWithInkOutsideAdvance': 0, 'wordsInkOutsideCurrentBox': [], 'maxLeftEm': [0, None], 'maxRightEm': [0, None],
           'lineEdgeBeyondFrame': [], 'padEm': PAD_EM, 'markers': 0}
per_page = {}
marker_ink = {}
for page in range(1, 605):
    font = TTFont(f'{FONTS}/p{page}.ttf')
    upm = font['head'].unitsPerEm
    cmap, gs, hmtx = font.getBestCmap(), font.getGlyphSet(), font['hmtx']
    cache = {}

    def glyph(ch):
        if ch not in cache:
            name = cmap.get(ord(ch))
            cache[ch] = None if name is None else (hmtx[name][0], ink_box(gs, name))
        return cache[ch]

    words = sorted(pages[page], key=lambda r: r['position_in_page'])  # the app's order (position_in_line is not reading order)
    summary['pages'] += 1
    outside = 0
    line_words = defaultdict(list)
    for r in words:
        summary['words'] += 1
        x, lo, hi = 0, 0.0, 0.0
        inks = []
        for ch in r['text']:
            g = glyph(ch)
            if g is None:
                summary['missingGlyphs'].append({'page': page, 'line': r['line_number'], 'word': r['position_in_line'], 'code': hex(ord(ch))})
                continue
            summary['glyphs'] += 1
            adv, box = g
            if box:
                lo, hi = min(lo, x + box[0]), max(hi, x + box[1])
                inks.append((x + box[0], x + box[1], box[2], box[3]))
            x += adv
        left, right = max(0.0, -lo) / upm, max(0.0, hi - x) / upm
        if left > 0 or right > 0:
            outside += 1
            summary['wordsInkOutsideAdvanceByKind'][r['char_type_name']] += 1
        where = {'page': page, 'line': r['line_number'], 'word': r['position_in_line'], 'verse': VERSE_KEYS[r['verse_id'] - 1]}
        if left > summary['maxLeftEm'][0]: summary['maxLeftEm'] = [round(left, 4), where]
        if right > summary['maxRightEm'][0]: summary['maxRightEm'] = [round(right, 4), where]
        if left > PAD_EM or right > PAD_EM:
            summary['wordsInkOutsideCurrentBox'].append({**where, 'leftEm': round(left, 4), 'rightEm': round(right, 4)})
        line_words[r['line_number']].append((x, lo, hi))
        if r['char_type_name'] == 'end':
            summary['markers'] += 1
            ring = inks[0] if inks else None
            marker_ink[where['verse']] = [page, *[round(v) for v in ring]] if ring else None
    summary['wordsInkOutsideAdvance'] += outside
    summary['pagesWithInkOutsideAdvance'] += 1 if outside else 0

    # Line edges (regular pages: lines justified edge to edge, the widest filling the text area at FIT).
    if page > 2:
        tw, inset_x = text_area()
        widest = max(sum(w[0] for w in ws) for ws in line_words.values())
        em = tw * FIT / widest  # page units per font unit
        for ln, ws in line_words.items():
            first, last = ws[0], ws[-1]  # right-most and left-most word (right to left)
            beyond_right = (first[2] - first[0]) * em   # ink right of the line's right edge
            beyond_left = -last[1] * em                 # ink left of the line's left edge
            worst = max(beyond_right, beyond_left)
            if worst > inset_x:
                summary['lineEdgeBeyondFrame'].append({'page': page, 'line': ln, 'beyondTextAreaPct': round(worst / 10, 2), 'insetPct': round(inset_x / 10, 2)})
    per_page[page] = {'wordsInkOutsideAdvance': outside, 'words': len(words)}

summary['wordsInkOutsideAdvanceByKind'] = dict(summary['wordsInkOutsideAdvanceByKind'])
summary['wordsInkOutsideCurrentBoxCount'] = len(summary['wordsInkOutsideCurrentBox'])
summary['lineEdgeBeyondFrameCount'] = len(summary['lineEdgeBeyondFrame'])
summary['missingGlyphCount'] = len(summary['missingGlyphs'])
summary['markersWithoutInk'] = [k for k, v in marker_ink.items() if v is None]
json.dump({'summary': summary, 'perPage': per_page}, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in summary.items() if not isinstance(v, list) or len(v) <= 3}, indent=1, ensure_ascii=False))

if WRITE_MARKER_INK:
    assert len(marker_ink) == 6236 and not summary['markersWithoutInk'], 'every ayah needs one marker with ink'
    ordered = {k: marker_ink[k] for k in VERSE_KEYS}
    body = ',\n'.join(f"  '{k}': [{', '.join(map(str, v))}]" for k, v in ordered.items())
    (ROOT / 'mobile/src/mushaf/generated/ayahMarkerInk.ts').write_text(
        '// GENERATED by tools/mushaf-audit/audit_ink_overflow.py --write-marker-ink — do not edit.\n'
        "// Each ayah's marker glyph in its page's QCF V1 font (Quran Foundation CDN, v1 ttf, read 2026-10-12):\n"
        '// [page, xMin, xMax, yMin, yMax] of its ring, in font units (2048 per em), from the outlines that draw ink.\n'
        "// The medallion is sized and centred on it (ayahMarkers.ts markerOverlayBox).\n"
        'export const AYAH_MARKER_INK: Readonly<Record<string, readonly [page: number, xMin: number, xMax: number, yMin: number, yMax: number]>> = {\n'
        + body + ',\n};\n', encoding='utf-8', newline='\n')
    print('wrote ayahMarkerInk.ts', len(ordered))
