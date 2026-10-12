"""Vertical position of the Quran text in its frame: clearance and clipping, all 604 pages, Normal and Full-Screen (2026-10-12).

  python tools/mushaf-audit/audit_vertical_position.py <fonts dir> <records-*.json.gz> <report.json> [--lift PT] [--device-baseline UNITS]

The reader's only vertical offset is MUSHAF_TEXT_LIFT_PT (pageGeometry.ts): the whole text area drawn that many points
above the printed layout's, on every page and in both modes (no per-page shift, no device baseline correction).
--lift defaults to the value in pageGeometry.ts. It is a fixed screen distance, so clearance is checked at every page
width the app shows (small Android to tablet), not only one.

1. Frame clearance: per page, the outermost ink of the first and last rows (real outlines of every letter and mark:
   contours enclosing area; each ayah-end medallion, MARKER_SCALE of its ring; the Surah heading and Basmala slots)
   against the frame's inner edges. Normal: the 29-tile frame. Full-Screen: every frame it can use (29 tiles to
   TALLER_MAX_TILES_DOWN). Two glyph placements in the line box:
   - intended: the baseline where the layout puts it (the font's hhea line centred: 2541 units below the box top);
     the web, and the model for Android (unverified there);
   - iphone: the baseline as measured on the iPhone screenshots of pages 5, 61, 466 (--device-baseline, default 3311
     units below the box top: about 0.376 em lower). Surah headings (Amiri) keep the intended placement in both.
2. Clipping (independent of the lift: glyphs keep their place in their own boxes): every word and Basmala glyph's ink
   against its Text's paintable box (the line box plus QCF_V1_INK_ROOM_V_EM + the mode's box margin above and below)
   at both placements, and the range of baselines for which nothing would be clipped.
"""
import gzip, json, re, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = Path(__file__).resolve().parents[2]
LIFT = float(sys.argv[sys.argv.index('--lift') + 1]) if '--lift' in sys.argv else float(re.search(r'export const MUSHAF_TEXT_LIFT_PT = ([\d.]+);', (ROOT / 'mobile/src/mushaf/pageGeometry.ts').read_text(encoding='utf-8')).group(1))
DEVICE_BASELINE = float(sys.argv[sys.argv.index('--device-baseline') + 1]) if '--device-baseline' in sys.argv else 3311.0
UPM, ASC, DESC, FIT, W = 2048, 2541, 1378, 0.985, 387.0
LINE_BOX = 3919  # QCF_V1_LINE_BOX_EM, units
CSS_BASELINE = ASC  # cssBaseline(size, LINE_BOX): the hhea line (ASC + DESC = LINE_BOX) centred
HEADING_SIZE, HEADING_LINE = 0.78, 1.8
OPENING_SIZE_PER_WIDTH = 0.0692
src = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
ROOM_V = float(re.search(r'QCF_V1_INK_ROOM_V_EM = ([\d.]+);', src).group(1)) * UPM
MARGIN = {'normal': float(re.search(r'QCF_V1_NORMAL_BOX_MARGIN_EM = ([\d.]+);', src).group(1)) * UPM, 'fullScreen': 0.0}
MARKER_SCALE = float(re.search(r'export const MARKER_SCALE = ([\d.]+);', src).group(1))
TALLER_MAX_LINE_SPACING = float(re.search(r'TALLER_MAX_LINE_SPACING = ([\d.]+);', (ROOT / 'mobile/src/app/mushaf.tsx').read_text(encoding='utf-8')).group(1))
# Page widths the app shows (pt): small Android, iPhone SE … Pro Max, Android phones, tablets (device matrix).
WIDTHS = [268, 317, 354, 367, 378, 387, 396, 406, 424, 434, 442, 467, 681]

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

def frame(tiles):
    tile = W / 20; inner_h = W * tiles / 20 - 2 * tile; inset_y = W * 10 / 593
    return inner_h, inset_y, (inner_h - 2 * inset_y) / 15

text_w = W - 2 * (W / 20) - 2 * W * 25 / 593
printed_pitch = frame(29)[2]
TALLER_MAX = 29
while frame(TALLER_MAX + 1)[2] / printed_pitch <= TALLER_MAX_LINE_SPACING: TALLER_MAX += 1

p1 = TTFont(f'{FONTS}/p1.ttf'); p1c = p1.getBestCmap(); p1g = p1.getGlyphSet()
bas = [ink(p1g, p1c[cp]) for cp in range(0xFB51, 0xFB55)]
BAS_LO, BAS_HI = min(b[0] for b in bas), max(b[1] for b in bas)
amiri = TTFont(str(ROOT / 'mobile/node_modules/@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'))
a_upm = amiri['head'].unitsPerEm; a_asc, a_desc = amiri['hhea'].ascent / a_upm, -amiri['hhea'].descent / a_upm
names = json.loads((ROOT / 'tools/quran-verification/surah-names.json').read_text(encoding='utf-8'))
chars = {ch for s in names.get('names', names.get('surahs', [])) for ch in (s.get('nameArabic', '') if isinstance(s, dict) else '')} | set('سورة')
acm = amiri.getBestCmap(); ag = amiri.getGlyphSet()
hk = [ink(ag, acm[ord(ch)]) for ch in chars if ord(ch) in acm and not ch.isspace()]
HEAD_LO, HEAD_HI = min(h[0] for h in hk) / a_upm, max(h[1] for h in hk) / a_upm
HEAD_BASE = (HEADING_LINE - (a_asc + a_desc)) / 2 + a_asc

RINGS = {m.group(1): tuple(map(int, m.group(2).split(','))) for m in re.finditer(r"'(\d+:\d+)': \[([^\]]+)\]", (ROOT / 'mobile/src/mushaf/generated/ayahMarkerInk.ts').read_text(encoding='utf-8'))}
COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
VERSE_KEYS = [f'{s + 1}:{a + 1}' for s, n in enumerate(COUNTS) for a in range(n)]
recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in recs: pages[r['page_number']].append(r)

# Clipping extremes: the drawn glyph whose ink reaches highest above / lowest below its baseline.
glyph_hi = (-1e9, None); glyph_lo = (1e9, None); glyphs_checked = 0
def note(lo, hi, where):
    global glyph_hi, glyph_lo, glyphs_checked
    glyphs_checked += 1
    if hi > glyph_hi[0]: glyph_hi = (hi, where)
    if lo < glyph_lo[0]: glyph_lo = (lo, where)
for i, (lo, hi) in enumerate(bas): note(lo, hi, f'Basmala glyph {i + 1}')

rows_by_page = {}
for page in range(1, 605):
    f = TTFont(f'{FONTS}/p{page}.ttf'); cmap = f.getBestCmap(); gs = f.getGlyphSet(); hm = f['hmtx']
    cache = {}
    lines = defaultdict(lambda: [0.0, 0.0]); widths = defaultdict(int)
    for r in sorted(pages[page], key=lambda r: r['position_in_page']):
        ln = r['line_number']; wlo, whi = 0.0, 0.0
        for ch in r['text']:
            n = cmap[ord(ch)]
            if n not in cache: cache[n] = ink(gs, n)
            lo, hi = cache[n]; wlo, whi = min(wlo, lo), max(whi, hi)
            widths[ln] += hm[n][0]
        l = lines[ln]
        if r['char_type_name'] == 'end':  # hidden glyph; its medallion is drawn outside the Text (not clipped by it)
            _, x0, x1, y0, y1 = RINGS[VERSE_KEYS[r['verse_id'] - 1]]
            c, half = (y0 + y1) / 2, (y1 - y0) * MARKER_SCALE / 2
            l[0] = min(l[0], c - half); l[1] = max(l[1], c + half)
        else:
            note(wlo, whi, f"page {page} line {ln}")
            l[0] = min(l[0], wlo); l[1] = max(l[1], whi)
    size = text_w * OPENING_SIZE_PER_WIDTH if page <= 2 else text_w * FIT / (max(widths.values()) / UPM)
    rows_by_page[page] = (dict(lines), size)

def clearance(tiles):
    """Per page at W, no lift: gaps above the first row and below the last (pt), intended and iPhone placements."""
    inner_h, inset_y, pitch = frame(tiles)
    text_h = inner_h - 2 * inset_y
    out = []
    for page, (lines, size) in rows_by_page.items():
        em = size / UPM
        text_lines = sorted(lines)
        slots = [ln for ln in range(1, 16) if ln not in lines and (page > 2 or min(text_lines) - 2 <= ln < min(text_lines))]
        used = text_lines + slots
        block = (text_h - (max(used) - min(used) + 1) * pitch) / 2 - (min(used) - 1) * pitch if page <= 2 else 0
        centre = lambda ln: inset_y + block + (ln - 0.5) * pitch
        res = {'page': page}
        for name, baseline in (('intended', CSS_BASELINE), ('iphone', DEVICE_BASELINE)):
            ext = {}
            for ln in text_lines:
                base = centre(ln) - LINE_BOX / 2 * em + baseline * em
                ext[ln] = (base - lines[ln][1] * em, base - lines[ln][0] * em)
            for ln in slots:
                b_base = centre(ln) - LINE_BOX / 2 * em + baseline * em  # Basmala: a QPC V1 glyph, placed like a line
                hs = size * HEADING_SIZE; h_base = centre(ln) - HEADING_LINE * hs / 2 + HEAD_BASE * hs
                ext[ln] = (min(b_base - BAS_HI * em, h_base - HEAD_HI * hs), max(b_base - BAS_LO * em, h_base - HEAD_LO * hs))
            first, last = min(ext), max(ext)
            res[name] = (ext[first][0], inner_h - ext[last][1])
        out.append(res)
    return out

def evaluate(rows, width, placement):
    k = width / W  # every length but the lift scales with the page width
    tops = [(r[placement][0] * k - LIFT, r['page']) for r in rows]
    bots = [(r[placement][1] * k + LIFT, r['page']) for r in rows]
    t, b = min(tops), min(bots)
    return {'widthPt': width, 'minTopPt': round(t[0], 2), 'minTopPage': t[1], 'minBottomPt': round(b[0], 2), 'minBottomPage': b[1],
            'pagesTouchingTop': sorted(p for v, p in tops if v <= 0), 'pagesTouchingBottom': sorted(p for v, p in bots if v <= 0)}

def clipping(mode):
    room = ROOM_V + MARGIN[mode]
    def at(baseline):
        top = baseline - glyph_hi[0] + room
        bottom = LINE_BOX + room - (baseline - glyph_lo[0])
        return {'baselineUnits': baseline, 'topClearUnits': round(top, 1), 'bottomClearUnits': round(bottom, 1), 'clipped': top < 0 or bottom < 0}
    return {'paintableRoomUnits': room, 'safeBaselineUnits': [round(glyph_hi[0] - room, 1), round(LINE_BOX + room + glyph_lo[0], 1)],
            'intended': at(CSS_BASELINE), 'iphone': at(DEVICE_BASELINE)}

normal = clearance(29)
full = {t: clearance(t) for t in range(29, TALLER_MAX + 1)}
KEY_PAGES = (1, 2, 5, 13, 61, 307, 431, 466, 560)
result = {
    'liftPt': LIFT, 'referenceWidthPt': W, 'deviceBaselineUnits': DEVICE_BASELINE, 'glyphsChecked': glyphs_checked,
    'highestInk': {'units': glyph_hi[0], 'where': glyph_hi[1]}, 'lowestInk': {'units': glyph_lo[0], 'where': glyph_lo[1]},
    'normal': {pl: [evaluate(normal, w, pl) for w in WIDTHS] for pl in ('intended', 'iphone')},
    'fullScreen': {pl: [{'tiles': t, **evaluate(full[t], w, pl)} for t in full for w in WIDTHS] for pl in ('intended', 'iphone')},
    'clipping': {'normal': clipping('normal'), 'fullScreen': clipping('fullScreen')},
    # iPhone 16 Pro Normal page (396 pt), with the lift: [gap above the first line, gap below the last], pt.
    'keyPages396': {p: {pl: [round(v * 396 / W + d, 2) for v, d in zip(next(r for r in normal if r['page'] == p)[pl], (-LIFT, LIFT))] for pl in ('intended', 'iphone')} for p in KEY_PAGES},
    'pages387NoLift': [{'page': r['page'], **{pl: [round(v, 3) for v in r[pl]] for pl in ('intended', 'iphone')}} for r in normal],
}
json.dump(result, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)

def brief(r): return {k: v for k, v in r.items() if k not in ('pagesTouchingTop', 'pagesTouchingBottom')} | {'touchTop': r['pagesTouchingTop'][:12], 'nTop': len(r['pagesTouchingTop']), 'nBottom': len(r['pagesTouchingBottom'])}
print(json.dumps({'lift': LIFT, 'glyphs': glyphs_checked, 'clipping': result['clipping'], 'keyPages396': result['keyPages396']}, ensure_ascii=False))
for pl in ('intended', 'iphone'):
    print('NORMAL', pl)
    for r in result['normal'][pl]: print(' ', brief(r))
    fs = result['fullScreen'][pl]
    print('FULL', pl, 'worst top', min(fs, key=lambda r: r['minTopPt'])['minTopPt'], 'worst bottom', min(fs, key=lambda r: r['minBottomPt'])['minBottomPt'],
          'frames x widths with a page touching', sum(1 for r in fs if r['pagesTouchingTop'] or r['pagesTouchingBottom']), 'of', len(fs))
    for r in fs:
        if r['pagesTouchingTop'] or r['pagesTouchingBottom']: print('   ', brief(r))
