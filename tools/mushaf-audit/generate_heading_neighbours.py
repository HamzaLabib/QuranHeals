"""The ink next to every Surah heading, for the heading clearance tests (2026-10-12).

  python tools/mushaf-audit/generate_heading_neighbours.py <fonts dir> <records-*.json.gz> [--check]

Writes mobile/src/mushaf/generated/surahHeadingNeighbours.ts (the app places each Surah heading with it:
mushaf/surahHeadingPlacement.ts). For each of the 114 headings (slots as surahOpeningSlots places them), the row above
and the row below and how far their real ink reaches toward the heading. Real outlines: every contour enclosing area
(letters, dots, harakat, signs) and each ayah-end medallion (MARKER_SCALE of its ring, at the line's baseline; for a
line below, the medallions' own top too). In font units relative to that row's own baseline (+ up). No glyph codes.
--check: regenerate in memory and fail if the committed file differs (the data must match its sources).
"""
import gzip, json, re, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS = sys.argv[1], sys.argv[2]
ROOT = Path(__file__).resolve().parents[2]
src = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
MARKER_SCALE = float(re.search(r'export const MARKER_SCALE = ([\d.]+);', src).group(1))
UPM, FIT, OPENING = 2048, 0.985, 0.0692

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

COUNTS = json.loads((ROOT / 'tools/quran-verification/surah-counts.json').read_text(encoding='utf-8'))['counts']
KEYS = [(s + 1, a + 1) for s, n in enumerate(COUNTS) for a in range(n)]
RINGS = {m.group(1): tuple(map(int, m.group(2).split(','))) for m in re.finditer(r"'(\d+:\d+)': \[([^\]]+)\]", (ROOT / 'mobile/src/mushaf/generated/ayahMarkerInk.ts').read_text(encoding='utf-8'))}
recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in recs: pages[r['page_number']].append(r)

p1 = TTFont(f'{FONTS}/p1.ttf'); c1 = p1.getBestCmap(); g1 = p1.getGlyphSet()
BAS = []
for cp in range(0xFB51, 0xFB55):
    pen = InkPen(g1); g1[c1[cp]].draw(pen); BAS += pen.ys
BAS_HI = max(BAS)

def slots(lines):
    """surahOpeningSlots (mobile/src/mushaf/surahOpenings.ts), on {line: [records]}."""
    used = sorted(lines); out = []
    def empty_above(ln):
        n = 0; l = ln - 1
        while l >= 1 and l not in lines: n += 1; l -= 1
        return n
    for ln in used:
        first = lines[ln][0]; s, a = KEYS[first['verse_id'] - 1]
        if a != 1 or first['position_in_verse'] != 1: continue
        e = empty_above(ln)
        if e == 0: continue
        if s in (1, 9): out.append((ln - 1, 'heading', s))
        elif e >= 2: out += [(ln - 2, 'heading', s), (ln - 1, 'basmala', s)]
        else: out.append((ln - 1, 'basmala', s))
    last = used[-1]; trailing = 15 - last
    if trailing > 0:
        s, _ = KEYS[lines[last][-1]['verse_id'] - 1]; nxt = s + 1
        if nxt <= 114:
            out.append((last + 1, 'heading', nxt))
            if trailing >= 2 and nxt != 9: out.append((last + 2, 'basmala', nxt))
    return sorted(out)

entries = []
for page in range(1, 605):
    f = TTFont(f'{FONTS}/p{page}.ttf'); cmap = f.getBestCmap(); gs = f.getGlyphSet(); hm = f['hmtx']
    hhea = f['hhea']
    lines = defaultdict(list)
    for r in sorted(pages[page], key=lambda r: r['position_in_page']): lines[r['line_number']].append(r)
    adv = {ln: sum(hm[cmap[ord(c)]][0] for r in ws for c in r['text']) for ln, ws in lines.items()}
    def medallion_top(ln):
        top = None
        for r in lines[ln]:
            if r['char_type_name'] == 'end':
                s, a = KEYS[r['verse_id'] - 1]; _, x0, x1, y0, y1 = RINGS[f'{s}:{a}']
                t = (y0 + y1) / 2 + (y1 - y0) * MARKER_SCALE / 2
                top = t if top is None else max(top, t)
        return None if top is None else round(top)
    def ink(ln):
        lo, hi = 0.0, 0.0
        for r in lines[ln]:
            if r['char_type_name'] == 'end':
                s, a = KEYS[r['verse_id'] - 1]; _, x0, x1, y0, y1 = RINGS[f'{s}:{a}']
                c, half = (y0 + y1) / 2, (y1 - y0) * MARKER_SCALE / 2
                lo, hi = min(lo, c - half), max(hi, c + half)
            for ch in r['text']:
                pen = InkPen(gs); gs[cmap[ord(ch)]].draw(pen)
                if pen.ys: lo, hi = min(lo, min(pen.ys)), max(hi, max(pen.ys))
        return round(lo), round(hi)
    sl = slots(lines)
    kinds = {ln: k for ln, k, _ in sl}
    used = list(lines) + [ln for ln, _, _ in sl]
    for ln, kind, surah in sl:
        if kind != 'heading': continue
        above = {'kind': 'line', 'lowUnits': ink(ln - 1)[0]} if ln - 1 in lines else {'kind': kinds.get(ln - 1, 'none')}
        if ln + 1 in lines: below = {'kind': 'line', 'highUnits': ink(ln + 1)[1], 'medallionTopUnits': medallion_top(ln + 1)}
        elif kinds.get(ln + 1) == 'basmala': below = {'kind': 'basmala', 'highUnits': round(BAS_HI)}
        else: below = {'kind': 'none'}
        entries.append({'page': page, 'line': ln, 'surah': surah, 'opening': page <= 2,
                        'sizePerTextWidth': round(OPENING if page <= 2 else FIT / (max(adv.values()) / UPM), 6),
                        'usedLines': [min(used), max(used)], 'hhea': [hhea.ascent, -hhea.descent], 'above': above, 'below': below})
def entry(e):
    parts = [f"line: {e['line']}", f"surah: {e['surah']}"]
    if e['above']['kind'] == 'line': parts.append(f"above: {e['above']['lowUnits']}")
    b = e['below']
    if b['kind'] == 'basmala': parts.append(f"below: {{ kind: 'basmala', high: {b['highUnits']} }}")
    elif b['kind'] == 'line':
        med = '' if b['medallionTopUnits'] is None else f", medallionTop: {b['medallionTopUnits']}"
        parts.append(f"below: {{ kind: 'line', high: {b['highUnits']}{med} }}")
    return '{ ' + ', '.join(parts) + ' }'
by_page = defaultdict(list)
for e in entries: by_page[e['page']].append(e)
body = [
    '// GENERATED by tools/mushaf-audit/generate_heading_neighbours.py — do not edit; verify with --check.',
    '// The real ink next to every Surah heading (QPC V1 page fonts and Content Sync layout, read 2026-10-12): the lowest ink',
    "// of the line above (`above`) and the highest of the row below (`below`), in font units from that row's own baseline",
    '// (+ up); medallions at MARKER_SCALE of their ring. Used by mushaf/surahHeadingPlacement.ts.',
    'export type SurahHeadingNeighbours = { line: number; surah: number; above?: number; below?: { kind: \'basmala\' | \'line\'; high: number; medallionTop?: number } };',
    'export const SURAH_HEADING_NEIGHBOURS: Readonly<Record<number, readonly SurahHeadingNeighbours[]>> = {',
] + [f"  {p}: [{', '.join(entry(e) for e in es)}]," for p, es in sorted(by_page.items())] + ['};', '']
text = '\n'.join(body)
fixture = ROOT / 'mobile/tests/fixtures/headingNeighbours.json'  # the same data plus each page's size, for the tests
fixture_text = json.dumps(entries, indent=0)
out = ROOT / 'mobile/src/mushaf/generated/surahHeadingNeighbours.ts'
if '--check' in sys.argv:
    same = out.exists() and out.read_text(encoding='utf-8') == text and fixture.exists() and fixture.read_text(encoding='utf-8') == fixture_text
    print('surahHeadingNeighbours.ts and the test fixture', 'match its sources' if same else 'DIFFERS from its sources')
    sys.exit(0 if same else 1)
fixture.write_text(fixture_text, encoding='utf-8')
out.write_text(text, encoding='utf-8', newline='\n')
print('headings', len(entries), 'mid-page (a Quran line above)', sum(1 for e in entries if e['above']['kind'] == 'line'))
