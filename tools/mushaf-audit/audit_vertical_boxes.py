"""Vertical room of every Quran line in its glyph Text boxes, all 604 pages (2026-10-12).

  python tools/mushaf-audit/audit_vertical_boxes.py <fonts dir> <records-*.json.gz> <report.json>

A native Text paints only inside its frame. Per line, from the real outlines (contours that enclose area):
the deepest ink below the baseline and the highest above it, against the Text box:
  - 'fontLine': QCF_V1_LINE_BOX_EM (the font's hhea line), Full-Screen's box and Normal's until 2026-10-12;
  - 'normal':   QCF_V1_NORMAL_LINE_BOX_EM (the font's line + QCF_V1_NORMAL_BOX_MARGIN_EM above and below).
The glyph is centred in either box (baseline (asc - desc) / 2 below its centre). Pages whose font sets
USE_TYPO_METRICS (1 and 565) are also checked with their glyphs set lower by the most a platform honouring
the OS/2 metrics could place them: half the line difference plus the OS/2 line gap.
Slack is converted to device pixels at each iPhone's Normal-Mode letter size (3× screens; the iPhone SE's
2×), from the page's own font size (its widest line fills the text area, as QpcV1PageText measures it).
PASS: at least SNAP_PX device pixels of slack at the top and bottom of every line.
"""
import gzip, json, re, sys
from collections import defaultdict
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT = Path(__file__).resolve().parents[2]
TS = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
MARGIN_EM = float(re.search(r'QCF_V1_NORMAL_BOX_MARGIN_EM = ([\d.]+);', TS).group(1))
UPM, ASC, DESC = 2048, 2541, 1378  # QCF_V1_METRICS: the box every page's glyphs get
FIT, SNAP_PX = 0.985, 1.5
# Normal-Mode page widths (pt) and screen scales: iPhone SE (2×), iPhone 393, iPhone Pro Max 440.
DEVICES = {'iPhoneSE-320': (314, 2), 'iPhone-393': (387, 3), 'iPhoneProMax-440': (434, 3)}


class InkPen(BasePen):
    def __init__(self, gs):
        super().__init__(gs); self.ys, self.cur = [], []
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
            self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * c[0], u ** 3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * c[1]))
    def _closePath(self):
        pts = self.cur
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2 if len(pts) > 2 else 0
        if abs(area) > 1: self.ys += [p[1] for p in pts]
        self.cur = []
    _endPath = _closePath


def text_width(page_width):
    tile = page_width / 20
    return page_width - 2 * tile - 2 * page_width * 25 / 593


records = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
pages = defaultdict(list)
for r in records: pages[r['page_number']].append(r)

boxes = {'fontLine': 0.0, 'normal': MARGIN_EM * UPM}
result = {'pages': 604, 'lines': 0, 'glyphs': 0, 'snapPx': SNAP_PX, 'marginEm': MARGIN_EM, 'devices': {}, 'typoMetricsPages': [], 'tightest': {}}
worst = {b: {d: [] for d in DEVICES} for b in boxes}
for page in range(1, 605):
    font = TTFont(f'{FONTS}/p{page}.ttf')
    os2, cmap, gs, hmtx = font['OS/2'], font.getBestCmap(), font.getGlyphSet(), font['hmtx']
    shift = 0.0
    if os2.fsSelection & 128:  # USE_TYPO_METRICS: the lowest a platform could set this page's glyphs
        # TextKit bottom-aligns a line in a taller box and React Native centres it on the font's own line height; on the
        # OS/2 line (ascender + descender + gap) the baseline sits typo_line / 2 − descender below the box's centre,
        # against (ASC − DESC) / 2 on the hhea line. The OS/2 gap is added once more, as a bound.
        desc_t = -os2.sTypoDescender
        typo_line = os2.sTypoAscender + desc_t + os2.sTypoLineGap
        shift = max(0.0, (typo_line / 2 - desc_t) - (ASC - DESC) / 2 + os2.sTypoLineGap)
        result['typoMetricsPages'].append({'page': page, 'shiftUnits': round(shift, 1)})
    cache = {}
    lines = defaultdict(lambda: [0.0, 0.0, 0])
    widths = defaultdict(int)
    for r in sorted(pages[page], key=lambda r: r['position_in_page']):
        for ch in r['text']:
            name = cmap[ord(ch)]
            if name not in cache:
                pen = InkPen(gs); gs[name].draw(pen); cache[name] = (min(pen.ys, default=0), max(pen.ys, default=0))
            lo, hi = cache[name]
            l = lines[r['line_number']]
            l[0], l[1], l[2] = min(l[0], lo), max(l[1], hi), l[2] + 1
            widths[r['line_number']] += hmtx[name][0]
            result['glyphs'] += 1
    result['lines'] += len(lines)
    widest = max(widths.values())
    for device, (page_width, scale) in DEVICES.items():
        font_size = text_width(page_width) * FIT / (widest / UPM) if page > 2 else text_width(page_width) * 0.0692
        px = font_size / UPM * scale  # device pixels per font unit
        for box, margin in boxes.items():
            for ln, (lo, hi, _) in lines.items():
                bottom = (DESC + margin + lo - shift) * px   # slack under the deepest ink
                top = (ASC + margin - hi + shift) * px       # slack over the highest ink
                worst[box][device].append((min(bottom, top), page, ln, 'bottom' if bottom < top else 'top', round(bottom, 2), round(top, 2)))

for box in boxes:
    for device in DEVICES:
        rows = sorted(worst[box][device])
        fails = [r for r in rows if r[0] < SNAP_PX]
        result['devices'].setdefault(device, {})[box] = {
            'linesChecked': len(rows),
            'linesUnderSnap': len(fails),
            'pagesUnderSnap': sorted({r[1] for r in fails}),
            'minSlackPx': round(rows[0][0], 2),
            'tightest': [{'page': p, 'line': l, 'edge': e, 'bottomPx': b, 'topPx': t} for _, p, l, e, b, t in rows[:6]],
        }
json.dump(result, open(OUT, 'w', encoding='utf-8'), indent=1)
print(json.dumps({k: v for k, v in result.items() if k != 'tightest'}, indent=1))
