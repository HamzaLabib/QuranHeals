"""The vertical ink of every line on Mushaf pages 1 and 2, and of the Basmala (2026-10-12).

  python tools/mushaf-audit/generate_opening_ink.py <fonts dir> <records-*.json.gz>

Writes mobile/tests/fixtures/openingPagesInk.json: for each line of pages 1-2, the lowest and highest ink (contours of
every letter and mark that enclose area) in font units from the line's baseline, and the same for the Basmala's four
glyphs (page 1's font). Checked by mobile/tests/openingPages.test.ts (the text inside the ornamental circle).
"""
import gzip, json, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS = sys.argv[1], sys.argv[2]
ROOT = Path(__file__).resolve().parents[2]

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

recs = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
out = {}
for page in (1, 2):
    f = TTFont(f'{FONTS}/p{page}.ttf'); cm = f.getBestCmap(); gs = f.getGlyphSet()
    lines = defaultdict(lambda: [0, 0])
    for r in recs:
        if r['page_number'] != page: continue
        for ch in r['text']:
            pen = InkPen(gs); gs[cm[ord(ch)]].draw(pen)
            if pen.ys:
                l = lines[r['line_number']]; l[0] = min(l[0], min(pen.ys)); l[1] = max(l[1], max(pen.ys))
    out[page] = {ln: [round(v[0]), round(v[1])] for ln, v in sorted(lines.items())}
p1 = TTFont(f'{FONTS}/p1.ttf'); c1 = p1.getBestCmap(); g1 = p1.getGlyphSet()
ys = []
for cp in range(0xFB51, 0xFB55):
    pen = InkPen(g1); g1[c1[cp]].draw(pen); ys += pen.ys
out['basmala'] = [round(min(ys)), round(max(ys))]
(ROOT / 'mobile/tests/fixtures/openingPagesInk.json').write_text(json.dumps(out, indent=0), encoding='utf-8')
print(out)
