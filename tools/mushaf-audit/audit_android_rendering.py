"""Android: can every Quran glyph be drawn in full? All 604 pages, every word occurrence, an Android screen matrix (2026-10-12).

  python tools/mushaf-audit/audit_android_rendering.py <fonts dir> <records-*.json.gz> <android-matrix.json> <report.json>

The matrix (page width, frame tiles, mode, density per phone and system-bar configuration) comes from the app's own
fitMushafPage (mobile/tests/mushafScreen.test.ts "Android screen matrix", ANDROID_MATRIX_OUT).

Android draws each Quran word through an unclipped copy (QpcV1PageText androidInk): an absolutely positioned Text over
the transparent in-flow word, its content box the word's advance ± QCF_V1_INK_OVERFLOW_EM (R), no horizontal padding,
text centred; vertically the in-flow word's box plus QCF_V1_INK_ROOM_V_EM (RV) and the mode's margin (m) above and
below, as padding. The rules this checks, from the React Native 0.86 / Android sources:
- TextView.onDraw clips the canvas to [compound padding left, width - compound padding right] horizontally and, when the
  text is not scrolled, to the view's own bounds vertically. So the drawable region of a copy is its content box
  horizontally (advance ± R) and its whole box vertically (line box ± (RV + m)). Parents do not clip (ReactViewGroup
  clipChildren = false; overflow visible); the zoom viewport clips only at the page's outer edge.
- Baseline: CustomLineHeightSpan (CSS half-leading): leading = ceil(lineHeight px) - (ascent + descent), half above
  (ceil), half below; with includeFontPadding false the first line's top is the content top. Font metrics come from
  Skia: the OS/2 typo ascender/descender when USE_TYPO_METRICS is set (pages 1 and 565), hhea otherwise; Android rounds
  them to whole pixels (Paint.getFontMetricsInt) - every rounding direction is tried here.
- Glyph order: the QPC V1 codes are Arabic presentation forms (bidi class AL), so a word of several glyphs is drawn
  right to left: its first glyph rightmost. (The earlier audits composed them left to right; both are reported.)
- Pixel snapping: Yoga rounds every edge to the pixel grid and the in-flow width is ceil(advance px), which can move
  a copy's content box and its centred glyph run by up to a pixel; this allows 1.5 px per side, plus 1 px for
  anti-aliasing (a clearance must be at least 1 px after the allowance).

Every word occurrence's ink (contours enclosing area: letters, dots, harakat, hamzas, waqf signs) is measured in its
real visual position; ayah-end glyphs are hidden under their medallions (drawn by the app in their own box) and are
not drawn as text. The Basmala's four page-1 glyphs are checked on every page (in page 1's metrics). Also checked per
configuration: the first/last lines' ink against the frame (top, bottom; with MUSHAF_TEXT_LIFT_PT), and each line's
end words' ink against the frame's inner edge (left, right).
"""
import gzip, json, math, re, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS, MATRIX, OUT = sys.argv[1:5]
ROOT = Path(__file__).resolve().parents[2]
UPM, FIT, OPENING = 2048, 0.985, 0.0692
LINE_BOX = 3919
src = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
R_EM = float(re.search(r'QCF_V1_INK_OVERFLOW_EM = ([\d.]+);', src).group(1))
RV_EM = float(re.search(r'QCF_V1_INK_ROOM_V_EM = ([\d.]+);', src).group(1))
M_EM = {'normal': float(re.search(r'QCF_V1_NORMAL_BOX_MARGIN_EM = ([\d.]+);', src).group(1)), 'fullScreen': 0.0}
MARKER_SCALE = float(re.search(r'export const MARKER_SCALE = ([\d.]+);', src).group(1))
LIFT = float(re.search(r'export const MUSHAF_TEXT_LIFT_PT = ([\d.]+);', (ROOT / 'mobile/src/mushaf/pageGeometry.ts').read_text(encoding='utf-8')).group(1))
SNAP, AA = 1.5, 1.0
# Android draws the Quran rows where the iPhone draws the lines (ayahMarkers.ts ANDROID_MATCHES_IPHONE_BASELINE): moved
# down by the iPhone's drop, from each font's metrics (OS/2 line at the bottom of the box, vs the hhea line centred).
PARITY = re.search(r'export const ANDROID_MATCHES_IPHONE_BASELINE = (true|false);', src).group(1) == 'true'
def iphone_drop_units(font):
    os2, hhea = font['OS/2'], font['hhea']
    drawn = LINE_BOX + os2.sTypoDescender - os2.sTypoLineGap
    return drawn - (hhea.ascent + (LINE_BOX - hhea.ascent + hhea.descent) / 2) if PARITY else 0.0
HEADING_SIZE, HEADING_LINE = 0.78, 1.8

class InkPen(BasePen):
    def __init__(s, gs): super().__init__(gs); s.pts = []; s.cur = []
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
        if len(pts) > 2 and abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts)))) > 2: s.pts += pts
        s.cur = []
    _endPath = _closePath

def glyph_ink(gs, name):
    pen = InkPen(gs); gs[name].draw(pen)
    if not pen.pts: return None
    xs = [p[0] for p in pen.pts]; ys = [p[1] for p in pen.pts]
    return (min(xs), max(xs), min(ys), max(ys))

def android_metrics(font):
    os2, hhea = font['OS/2'], font['hhea']
    if os2.fsSelection & (1 << 7): return os2.sTypoAscender, -os2.sTypoDescender, True
    return hhea.ascent, -hhea.descent, False

def word_ink(chars, cmap, gs, hm, cache, visual):
    """(xmin, xmax, ymin, ymax, advance) of a word, glyphs in drawing order: visual = right to left."""
    seq = list(reversed(chars)) if visual else list(chars)
    x = 0; box = [math.inf, -math.inf, math.inf, -math.inf]
    for ch in seq:
        n = cmap[ord(ch)]
        if n not in cache: cache[n] = glyph_ink(gs, n)
        g = cache[n]
        if g:
            box = [min(box[0], x + g[0]), max(box[1], x + g[1]), min(box[2], g[2]), max(box[3], g[3])]
        x += hm[n][0]
    return (*box, x)

COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
VERSE_KEYS = [f'{s + 1}:{a + 1}' for s, n in enumerate(COUNTS) for a in range(n)]
RINGS = {m.group(1): tuple(map(int, m.group(2).split(','))) for m in re.finditer(r"'(\d+:\d+)': \[([^\]]+)\]", (ROOT / 'mobile/src/mushaf/generated/ayahMarkerInk.ts').read_text(encoding='utf-8'))}
recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
by_page = defaultdict(list)
for r in recs: by_page[r['page_number']].append(r)

p1 = TTFont(f'{FONTS}/p1.ttf'); p1c = p1.getBestCmap(); p1g = p1.getGlyphSet(); p1h = p1['hmtx']
BAS_A, BAS_D, _ = android_metrics(p1)
BAS_DROP = iphone_drop_units(p1)
bas_cache = {}
BASMALA = [word_ink([chr(cp)], p1c, p1g, p1h, bas_cache, True) for cp in range(0xFB51, 0xFB55)]
amiri = TTFont(str(ROOT / 'mobile/node_modules/@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'))
a_upm = amiri['head'].unitsPerEm; a_asc, a_desc = amiri['hhea'].ascent / a_upm, -amiri['hhea'].descent / a_upm
names = json.loads((ROOT / 'tools/quran-verification/surah-names.json').read_text(encoding='utf-8'))
chars = {ch for s in names.get('names', names.get('surahs', [])) for ch in (s.get('nameArabic', '') if isinstance(s, dict) else '')} | set('سورة')
acm = amiri.getBestCmap(); ag = amiri.getGlyphSet()
hk = [glyph_ink(ag, acm[ord(ch)]) for ch in chars if ord(ch) in acm and not ch.isspace()]
HEAD_LO, HEAD_HI = min(h[2] for h in hk if h) / a_upm, max(h[3] for h in hk if h) / a_upm
HEAD_BASE = (HEADING_LINE - (a_asc + a_desc)) / 2 + a_asc

# ---- per page: the extremes of every drawn word occurrence (em, relative to its own advance box and baseline) ----
pages = {}
occurrences = glyphs = 0
order_diff = []
for page in range(1, 605):
    font = TTFont(f'{FONTS}/p{page}.ttf'); cmap = font.getBestCmap(); gs = font.getGlyphSet(); hm = font['hmtx']
    A, D, typo = android_metrics(font)
    cache = {}
    lines = defaultdict(list)
    for r in sorted(by_page[page], key=lambda r: r['position_in_page']): lines[r['line_number']].append(r)
    adv_line = {ln: sum(hm[cmap[ord(c)]][0] for r in ws for c in r['text']) for ln, ws in lines.items()}
    worst = {'left': (math.inf, None), 'right': (math.inf, None), 'top': (math.inf, None), 'bottom': (math.inf, None)}
    line_ext = {}
    for ln, ws in lines.items():
        lo_y, hi_y = 0.0, 0.0
        for i, r in enumerate(ws):
            glyphs += len(r['text'])
            if r['char_type_name'] == 'end':
                _, x0, x1, y0, y1 = RINGS[VERSE_KEYS[r['verse_id'] - 1]]
                c, half = (y0 + y1) / 2, (y1 - y0) * MARKER_SCALE / 2
                lo_y, hi_y = min(lo_y, c - half), max(hi_y, c + half)
                continue
            occurrences += 1
            xmin, xmax, ymin, ymax, adv = word_ink(r['text'], cmap, gs, hm, cache, True)
            if len(r['text']) > 1:
                lx = word_ink(r['text'], cmap, gs, hm, cache, False)
                order_diff.append((max(-xmin, xmax - adv) - max(-lx[0], lx[1] - lx[4])) / UPM)
            where = f"p{page} l{ln} {VERSE_KEYS[r['verse_id'] - 1]}:{r['position_in_verse']}"
            for key, val in (('left', R_EM + xmin / UPM), ('right', R_EM - (xmax - adv) / UPM), ('top', -ymax / UPM), ('bottom', ymin / UPM)):
                if val < worst[key][0]: worst[key] = (val, where)
            lo_y, hi_y = min(lo_y, ymin), max(hi_y, ymax)
            if i == 0: line_ext.setdefault(ln, {})['rightInkEm'] = (xmax - adv) / UPM   # first word: the line's right end
            if i == len(ws) - 1: line_ext.setdefault(ln, {})['leftInkEm'] = -xmin / UPM  # last word: the left end
        line_ext.setdefault(ln, {}).update({'lo': lo_y, 'hi': hi_y})
    pages[page] = {'A': A, 'D': D, 'typo': typo, 'drop': iphone_drop_units(font), 'worst': worst, 'lines': line_ext, 'sizePerTextWidth': OPENING if page <= 2 else FIT / (max(adv_line.values()) / UPM)}

# ---- per configuration ----
def frame(width, tiles):
    tile = width / 20; inner_h = width * tiles / 20 - 2 * tile; inset_y = width * 10 / 593; inset_x = width * 25 / 593
    text_w = width - 2 * tile - 2 * inset_x
    return inner_h, inset_y, inset_x, text_w, (inner_h - 2 * inset_y) / 15

def baseline_px_range(A, D, s):
    """Android baseline below the line box's top (px) for each rounding direction of the font metrics."""
    lint = math.ceil(LINE_BOX / UPM * s)
    out = []
    for ar in (math.floor, math.ceil):
        for dr in (math.floor, math.ceil):
            a, d = ar(A / UPM * s), dr(D / UPM * s)
            out.append(a + math.ceil((lint - (a + d)) / 2))
    return min(out), max(out), lint

matrix = json.load(open(MATRIX, encoding='utf-8'))
configs = []
minima = {k: (math.inf, None) for k in ('left', 'right', 'top', 'bottom', 'frameTop', 'frameBottom', 'frameLeft', 'frameRight')}
failures = []
for cfg in matrix:
    W, d, mode, tiles = cfg['pageWidth'], cfg['density'], cfg['mode'], cfg['tilesDown']
    inner_h, inset_y, inset_x, text_w, pitch = frame(W, tiles)
    text_h = inner_h - 2 * inset_y
    m = M_EM[mode]
    res = {k: (math.inf, None) for k in minima}
    for page, P in pages.items():
        size = text_w * P['sizePerTextWidth']; s = size * d  # px per em
        bmin, bmax, lint = baseline_px_range(P['A'], P['D'], s)
        pad = (RV_EM + m) * s
        w = P['worst']
        vals = {
            'left': w['left'][0] * s - SNAP,
            'right': w['right'][0] * s - SNAP,
            'top': pad + bmin + w['top'][0] * s - SNAP,             # ink top below the copy's top edge
            'bottom': lint + pad - (bmax - w['bottom'][0] * s) - SNAP,  # copy's bottom edge below the ink
        }
        where = {k: w[k][1] for k in ('left', 'right', 'top', 'bottom')}
        # Basmala glyphs (page 1's font and metrics) at this page's size.
        bb_min, bb_max, _ = baseline_px_range(BAS_A, BAS_D, s)
        for g in BASMALA:
            for key, val in (('left', (R_EM + g[0] / UPM) * s - SNAP), ('right', (R_EM - (g[1] - g[4]) / UPM) * s - SNAP),
                             ('top', pad + bb_min - g[3] / UPM * s - SNAP), ('bottom', lint + pad - (bb_max - g[2] / UPM * s) - SNAP)):
                if val < vals[key]: vals[key], where[key] = val, f'p{page} Basmala'
        # Frame: the text area MUSHAF_TEXT_LIFT_PT up; the baseline at Android's (ideal) place in the line box.
        em = size / UPM
        base_units = P['A'] + (LINE_BOX - P['A'] - P['D']) / 2 + P['drop']
        lns = sorted(P['lines'])
        opening = page <= 2
        # opening pages: their block centred (QpcV1PageText); slots ignored for the regular grid here (headings checked below)
        rows_used = lns
        block = (text_h - (max(rows_used) - min(rows_used) + 1) * pitch) / 2 - (min(rows_used) - 1) * pitch if opening else 0
        centre = lambda ln: inset_y + block + (ln - 0.5) * pitch - LIFT
        first, last = lns[0], lns[-1]
        top_ink = centre(first) - LINE_BOX / 2 * em + (base_units - P['lines'][first]['hi']) * em
        bot_ink = centre(last) - LINE_BOX / 2 * em + (base_units - P['lines'][last]['lo']) * em
        ft = top_ink - 1.0 / d; fb = inner_h - bot_ink - 1.0 / d   # pt; less a pixel of rounding
        # A Surah heading or Basmala in the first empty rows (the top), Amiri in its 1.8-em box.
        if first > 1 and not opening:
            hs = size * HEADING_SIZE
            for ln in range(1, first):
                h_top = centre(ln) - HEADING_LINE * hs / 2 + (HEAD_BASE - HEAD_HI) * hs
                b_top = centre(ln) - LINE_BOX / 2 * em + (BAS_A + (LINE_BOX - BAS_A - BAS_D) / 2 + BAS_DROP - max(g[3] for g in BASMALA)) * em
                ft = min(ft, min(h_top, b_top) - 1.0 / d)
        fl = fr = math.inf
        for ln, e in P['lines'].items():
            if 'leftInkEm' in e: fl = min(fl, inset_x - e['leftInkEm'] * size - 1.0 / d)
            if 'rightInkEm' in e: fr = min(fr, inset_x - e['rightInkEm'] * size - 1.0 / d)
        vals_px = dict(vals)
        for key, val in (('frameTop', ft * d), ('frameBottom', fb * d), ('frameLeft', fl * d), ('frameRight', fr * d)):
            vals_px[key] = val; where[key] = f'p{page}'
        for key, val in vals_px.items():
            if val < res[key][0]: res[key] = (val, where[key])
            if (key in ('left', 'right', 'top', 'bottom') and val < AA) or (key.startswith('frame') and val < 0):
                failures.append({'config': f"{cfg['screen']} | {cfg['bars']} | {mode} | {d}x | page {W}", 'check': key, 'px': round(val, 2), 'where': where[key]})
    configs.append({**cfg, 'minPx': {k: [round(v[0], 2), v[1]] for k, v in res.items()}})
    for k in minima:
        if res[k][0] < minima[k][0]: minima[k] = (res[k][0], f"{cfg['screen']} | {cfg['bars']} | {mode} | {d}x: {res[k][1]}")

od = sorted(order_diff)
report = {
    'pages': len(pages), 'wordOccurrences': occurrences, 'glyphs': glyphs, 'basmalaGlyphs': len(BASMALA), 'configurations': len(matrix),
    'androidMatchesIphoneBaseline': PARITY, 'iphoneDropUnits': sorted({round(P['drop'], 1) for P in pages.values()}),
    'constants': {'R_em': R_EM, 'RV_em': RV_EM, 'margin_em': M_EM, 'liftPt': LIFT, 'snapPx': SNAP, 'antialiasPx': AA},
    'androidMetrics': {'typoPages': [p for p, P in pages.items() if P['typo']], 'otherMetricsPages': {p: [P['A'], P['D']] for p, P in pages.items() if (P['A'], P['D']) not in ((2541, 1378),) and not P['typo']}},
    'worstEm': {k: [round(min(P['worst'][k][0] for P in pages.values()), 4), min(pages.values(), key=lambda P: P['worst'][k][0])['worst'][k][1]] for k in ('left', 'right', 'top', 'bottom')},
    'multiGlyphWords': {'count': len(od), 'overflowChangeEm_visualVsLeftToRight': [round(od[0], 4), round(od[len(od)//2], 4), round(od[-1], 4)] if od else None},
    'minimumPx': {k: [round(v[0], 2), v[1]] for k, v in minima.items()},
    'failureCount': len(failures),
    # Every failing (configuration, check): its pages. Clipping checks (left/right/top/bottom) fail below AA px after the
    # snapping allowance; frame checks below 0 after a pixel of rounding.
    'failuresByConfiguration': {cfg: {chk: sorted({int(f['where'][1:].split()[0]) for f in failures if f['config'] == cfg and f['check'] == chk})
                                      for chk in sorted({f['check'] for f in failures if f['config'] == cfg})}
                                for cfg in sorted({f['config'] for f in failures})},
    'configurationsDetail': configs,
}
json.dump(report, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in report.items() if k not in ('configurationsDetail', 'failuresByConfiguration')}, indent=1, ensure_ascii=False))
fc = defaultdict(int)
for f in failures: fc[(f['check'], f['config'].split(' | ')[0], f['config'].split(' | ')[2])] += 1
for k, v in sorted(fc.items()): print('FAIL', k, v)
