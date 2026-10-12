"""Clearance between the page's content and the decorative frame, Normal Mode, all 604 pages (2026-10-12).

  python tools/mushaf-audit/audit_frame_clearance.py <fonts dir> <records-*.json.gz> <report.json> [--shift FRACTION]

Per page, the topmost and bottommost ink of the content in the frame against the inner edge of the frame's band
(the inner brown rule): Quran lines (real outlines: contours that enclose area, and each ayah-end medallion, drawn
MARKER_SCALE of its ring's height over the hidden marker glyph), and the Surah heading and
Basmala in their empty-line slots (each slot measured as the worse of the two: Basmala in QPC V1 page 1's glyphs,
heading in Amiri Bold at 0.78 of the letter size in a 1.8-em line box). Same model as QpcV1PageText and
pageGeometry.ts: the 29-tile frame; the widest line fills the text area (FIT); 15 rows of equal pitch; each box
centred in its row; pages 1–2 at their fixed letter size, their block centred.
All lengths are proportional to the page width; they are reported in points on a 387-pt page (iPhone 393).
--shift: the text block moved by this fraction of the page width (negative = up), as Normal Mode's
QCF_V1_NORMAL_TEXT_SHIFT. The report also gives the single shift that maximises the smaller of the two worst
gaps (the balanced position) and the clearances with it.
(The former --write-shifts, Normal Mode's per-page centring, was removed 2026-10-12; the text's vertical position is now
audited by audit_vertical_position.py.)
"""
import gzip, json, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SHIFT = float(sys.argv[sys.argv.index('--shift') + 1]) if '--shift' in sys.argv else 0.0
ROOT = Path(__file__).resolve().parents[2]
UPM, ASC, DESC, FIT, W = 2048, 2541, 1378, 0.985, 387.0
HEADING_SIZE, HEADING_LINE = 0.78, 1.8
OPENING_SIZE_PER_WIDTH = 0.0692

class InkPen(BasePen):
    def __init__(s, gs): super().__init__(gs); s.ys = []; s.cur = []
    def _moveTo(s, p): s.cur = [p]
    def _lineTo(s, p): s.cur.append(p)
    def _qCurveToOne(s, a, b):
        p0 = s.cur[-1]
        for i in range(1, 17): t = i / 16; u = 1 - t; s.cur.append((u*u*p0[0]+2*u*t*a[0]+t*t*b[0], u*u*p0[1]+2*u*t*a[1]+t*t*b[1]))
    def _curveToOne(s, a, b, c):
        p0 = s.cur[-1]
        for i in range(1, 17): t = i / 16; u = 1 - t; s.cur.append((u**3*p0[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0], u**3*p0[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
    def _closePath(s):
        pts = s.cur
        if len(pts) > 2 and abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts)))) > 2: s.ys += [p[1] for p in pts]
        s.cur = []
    _endPath = _closePath

def ink(gs, name):
    pen = InkPen(gs); gs[name].draw(pen); return (min(pen.ys, default=0), max(pen.ys, default=0))

# Frame (pageGeometry.ts, 29 tiles) at W.
tile = W / 20
inner_h = W * 29 / 20 - 2 * tile
text_w = W - 2 * tile - 2 * W * 25 / 593
inset_y = W * 10 / 593
text_h = inner_h - 2 * inset_y
pitch = text_h / 15

# Basmala (page 1's font) and heading (Amiri Bold) vertical ink, in em of their own size.
p1 = TTFont(f'{FONTS}/p1.ttf'); p1c = p1.getBestCmap(); p1g = p1.getGlyphSet()
bas = [ink(p1g, p1c[cp]) for cp in range(0xFB51, 0xFB55)]
BAS_LO, BAS_HI = min(b[0] for b in bas) / UPM, max(b[1] for b in bas) / UPM
amiri = TTFont(str(ROOT / 'mobile/node_modules/@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'))
a_upm = amiri['head'].unitsPerEm; a_asc, a_desc = amiri['hhea'].ascent / a_upm, -amiri['hhea'].descent / a_upm
names = json.loads((ROOT / 'tools/quran-verification/surah-names.json').read_text(encoding='utf-8'))
chars = {ch for s in names.get('names', names.get('surahs', [])) for ch in (s.get('nameArabic', '') if isinstance(s, dict) else '')} | set('سورة')
acm = amiri.getBestCmap(); ag = amiri.getGlyphSet()
hk = [ink(ag, acm[ord(ch)]) for ch in chars if ord(ch) in acm and not ch.isspace()]
HEAD_LO, HEAD_HI = min(h[0] for h in hk) / a_upm, max(h[1] for h in hk) / a_upm  # em of the heading's size
HEAD_BASE = (HEADING_LINE - (a_asc + a_desc)) / 2 + a_asc  # baseline below its line box top, em

# Ayah-end medallions: drawn over each hidden marker glyph, MARKER_SCALE of its ring's height, centred on the ring
# (ayahMarkers.ts markerOverlayBox; rings in generated/ayahMarkerInk.ts) — taller than the ring, so they can be the
# outermost ink of a first or last line.
import re
MARKER_SCALE = float(re.search(r'export const MARKER_SCALE = ([\d.]+);', (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')).group(1))
RINGS = {m.group(1): tuple(map(int, m.group(2).split(','))) for m in re.finditer(r"'(\d+:\d+)': \[([^\]]+)\]", (ROOT / 'mobile/src/mushaf/generated/ayahMarkerInk.ts').read_text(encoding='utf-8'))}
COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
VERSE_KEYS = [f'{s + 1}:{a + 1}' for s, n in enumerate(COUNTS) for a in range(n)]

recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in recs: pages[r['page_number']].append(r)

def extents(page):
    """[(top, bottom)] of each row's ink, in points below the inner top edge, without any shift."""
    f = TTFont(f'{FONTS}/p{page}.ttf'); cmap = f.getBestCmap(); gs = f.getGlyphSet(); hm = f['hmtx']
    cache = {}
    lines = defaultdict(lambda: [0.0, 0.0]); widths = defaultdict(int)
    for r in pages[page]:
        for ch in r['text']:
            n = cmap[ord(ch)]
            if n not in cache: cache[n] = ink(gs, n)
            lo, hi = cache[n]; l = lines[r['line_number']]; l[0] = min(l[0], lo); l[1] = max(l[1], hi)
            widths[r['line_number']] += hm[n][0]
        if r['char_type_name'] == 'end':
            _, x0, x1, y0, y1 = RINGS[VERSE_KEYS[r['verse_id'] - 1]]
            c, half = (y0 + y1) / 2, (y1 - y0) * MARKER_SCALE / 2
            l = lines[r['line_number']]; l[0] = min(l[0], c - half); l[1] = max(l[1], c + half)
    size = text_w * OPENING_SIZE_PER_WIDTH if page <= 2 else text_w * FIT / (max(widths.values()) / UPM)
    em = size / UPM
    text_lines = sorted(lines)
    slots = [ln for ln in range(1, 16) if ln not in lines and (page > 2 or min(text_lines) - 2 <= ln < min(text_lines))]
    used = text_lines + slots
    block = (text_h - (max(used) - min(used) + 1) * pitch) / 2 - (min(used) - 1) * pitch if page <= 2 else 0
    centre = lambda ln: inset_y + block + (ln - 0.5) * pitch
    out = {}
    for ln in text_lines:
        base = centre(ln) + (ASC - DESC) / 2 * em
        out[ln] = (base - lines[ln][1] * em, base - lines[ln][0] * em)
    for ln in slots:
        b_base = centre(ln) + (ASC - DESC) / 2 * em  # Basmala: same box as a Quran line
        hs = size * HEADING_SIZE; h_top = centre(ln) - HEADING_LINE * hs / 2; h_base = h_top + HEAD_BASE * hs
        out[ln] = (min(b_base - BAS_HI * size, h_base - HEAD_HI * hs), max(b_base - BAS_LO * size, h_base - HEAD_LO * hs))
    return out, size

rows = []
for page in range(1, 605):
    ext, size = extents(page)
    first, last = min(ext), max(ext)
    rows.append({'page': page, 'firstRow': first, 'lastRow': last, 'top': ext[first][0], 'bottom': inner_h - ext[last][1], 'fontPt': round(size, 3)})

def summary(shift_frac):
    s = shift_frac * W
    t = [r['top'] + s for r in rows]; b = [r['bottom'] - s for r in rows]
    worst_t = min(range(len(rows)), key=lambda i: t[i]); worst_b = min(range(len(rows)), key=lambda i: b[i])
    return {'shiftFraction': shift_frac, 'shiftPt': round(s, 3), 'minTopPt': round(t[worst_t], 2), 'minTopPage': rows[worst_t]['page'],
            'minBottomPt': round(b[worst_b], 2), 'minBottomPage': rows[worst_b]['page'], 'overlaps': sum(1 for x in t + b if x <= 0)}

regular = [r for r in rows if r['page'] > 2]
best = (min(r['top'] for r in rows) - min(r['bottom'] for r in rows)) / 2  # move up by this many points
result = {'pageWidthPt': W, 'pitchPt': round(pitch, 3), 'innerHeightPt': round(inner_h, 2),
          'now': summary(0.0), 'balanced': summary(-best / W), 'requested': summary(SHIFT),
          'pages': [{**r, 'top': round(r['top'], 2), 'bottom': round(r['bottom'], 2)} for r in rows]}
json.dump(result, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in result.items() if k != 'pages'}, indent=1))

