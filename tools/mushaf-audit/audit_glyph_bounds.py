"""Audit of QCF V1 glyph ink against the renderer's boxes, all 604 pages.

For every page: its own font (Quran Foundation CDN, downloaded for this audit only) and its words and
lines (the local Content Sync snapshot). Reproduces QpcV1PageText's layout at a page 1000 units wide
(proportional, so the results hold at any size):
  - font size: the widest line's advance fills the text area (FIT 0.985), as the measuring pass does;
  - 15 rows of equal pitch; each glyph's Text box centred in its row; baseline from the CSS/half-leading
    model (the same one cssBaseline uses, and the one iOS/Android follow when the box is centred);
  - a glyph's ink: its glyf bounding box (yMin..yMax), the exact outline extremes.
Checks, per glyph and per line:
  1. ink outside the OLD Text box (lineHeight 1.3 em) -> clipped by a native Text view;
  2. ink outside the NEW Text box (the font's own ascent + descent);
  3. first/last line ink outside the inner frame (text area + its inset), i.e. touching the border;
  4. a line's ink reaching the next line's ink (bounding boxes; a conservative overlap check).
"""
import gzip, json, sys
from collections import defaultdict
from fontTools.ttLib import TTFont

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FIT = 0.985
W = 1000.0
# pageGeometry.ts at width 1000 (tile 1/20, text insets 25/593 and 10/593, frame 29 tiles).
def text_area(tiles_down=29):
    tile = W / 20
    inner_w, inner_h = W - 2 * tile, W * tiles_down / 20 - 2 * tile
    inset_x, inset_y = W * 25 / 593, W * 10 / 593
    return inner_w - 2 * inset_x, inner_h - 2 * inset_y, inset_y

records = json.loads(gzip.open(RECORDS).read())
words = defaultdict(lambda: defaultdict(list))
for r in records:
    if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2:
        words[r['page_number']][r['line_number']].append((r['position_in_line'], r['text'], r['char_type_name']))

summary = {'pages': 0, 'glyphs': 0, 'oldClippedGlyphs': 0, 'oldClippedAbove': 0, 'oldClippedBelow': 0, 'pagesWithOldClipping': 0,
           'newClippedGlyphs': 0, 'boundaryProblems': [], 'lineOverlaps': [], 'lineCounts': defaultdict(int),
           'worstAboveEm': 0, 'worstBelowEm': 0, 'metrics': set(), 'missingGlyphs': 0}
worst_examples = []
per_page = {}
for layout_name, tiles in [('traditional', 29), ('taller33', 33), ('taller35', 35)]:
    pass  # (pitch-only variants are evaluated below for line overlaps)

for page in range(1, 605):
    font = TTFont(f'{FONTS}/p{page}.ttf')
    upm = font['head'].unitsPerEm
    asc, desc = font['hhea'].ascent, -font['hhea'].descent
    summary['metrics'].add((upm, asc, desc))
    cmap = font.getBestCmap(); glyf = font['glyf']; hmtx = font['hmtx']
    lines = words[page]
    summary['lineCounts'][len(lines)] += 1
    def ink(ch):
        name = cmap.get(ord(ch))
        if name is None:
            return None
        g = glyf[name]
        adv = hmtx[name][0]
        if g.numberOfContours == 0:
            return (0, 0, adv)
        return (g.yMin, g.yMax, adv)
    # Font size: the widest line's total advance fills the text area.
    tw, th, inset_y = text_area()
    widths = {}
    for ln, ws in lines.items():
        total = 0
        for _, ch, _kind in ws:
            for c in ch:
                i = ink(c)
                if i is None:
                    summary['missingGlyphs'] += 1
                    continue
                total += i[2]
        widths[ln] = total
    size = tw * FIT / (max(widths.values()) / upm)   # font size in page units
    em = size / upm
    old_box, new_box = 1.3 * upm, asc + desc
    old_top = (old_box - (asc + desc)) / 2 + asc     # baseline below the old box top (font units)
    page_clipped = 0
    line_ext = {}
    for ln, ws in sorted(lines.items()):
        lo, hi = 0, 0
        for pos, ch, kind in sorted(ws):
            for c in ch:
                i = ink(c)
                if i is None:
                    continue
                y0, y1, _ = i
                summary['glyphs'] += 1
                above = y1 - old_top
                below = -y0 - (old_box - old_top)
                if above > 0 or below > 0:
                    summary['oldClippedGlyphs'] += 1
                    page_clipped += 1
                    if above > 0: summary['oldClippedAbove'] += 1
                    if below > 0: summary['oldClippedBelow'] += 1
                    worst_examples.append((max(above, below) / upm, page, ln, pos, 'above' if above >= below else 'below', hex(ord(c))))
                    summary['worstAboveEm'] = max(summary['worstAboveEm'], above / upm)
                    summary['worstBelowEm'] = max(summary['worstBelowEm'], below / upm)
                if y1 > asc or -y0 > desc:
                    summary['newClippedGlyphs'] += 1
                lo, hi = min(lo, y0), max(hi, y1)
        line_ext[ln] = (lo, hi)
    if page_clipped:
        summary['pagesWithOldClipping'] += 1
    # Placement: rows of pitch th/15; baseline = row centre + (asc - desc)/2 em (half-leading model).
    for tiles in (29, 33, 35):
        tw2, th2, inset_y2 = text_area(tiles)
        pitch = th2 / 15
        def baseline(ln):
            return (ln - 0.5) * pitch + (asc - desc) / 2 * em
        for ln, (lo, hi) in line_ext.items():
            top, bottom = baseline(ln) - hi * em, baseline(ln) - lo * em
            # The inner frame rule lies inset_y outside the text area.
            if top < -inset_y2 or bottom > th2 + inset_y2:
                summary['boundaryProblems'].append({'page': page, 'line': ln, 'tiles': tiles, 'top': round(top, 2), 'bottom': round(bottom - th2, 2)})
            nxt = line_ext.get(ln + 1)
            if nxt:
                gap = (baseline(ln + 1) - nxt[1] * em) - bottom
                if gap < 0:
                    summary['lineOverlaps'].append({'page': page, 'line': ln, 'tiles': tiles, 'overlapEm': round(-gap / size, 3)})
    per_page[page] = {'size': round(size, 2), 'oldClippedGlyphs': page_clipped}

worst_examples.sort(reverse=True)
summary['metrics'] = sorted(summary['metrics'])
summary['lineCounts'] = dict(summary['lineCounts'])
summary['worstExamples'] = [{'em': round(e, 3), 'page': p, 'line': l, 'positionInLine': pos, 'where': w, 'glyph': g} for e, p, l, pos, w, g in worst_examples[:25]]
summary['pages'] = 604
from collections import Counter
summary['overlapsByLayout'] = dict(Counter(o['tiles'] for o in summary['lineOverlaps']))
summary['overlapPagesTraditional'] = dict(Counter(o['page'] for o in summary['lineOverlaps'] if o['tiles'] == 29).most_common(15))
summary['overlapPagesTraditionalCount'] = len({o['page'] for o in summary['lineOverlaps'] if o['tiles'] == 29})
summary['overlapMaxEmExcl12'] = max([o['overlapEm'] for o in summary['lineOverlaps'] if o['tiles'] == 29 and o['page'] > 2] or [0])
summary['lineOverlapCount'] = len(summary['lineOverlaps']); summary['lineOverlaps'] = summary['lineOverlaps'][:30]
summary['boundaryProblemCount'] = len(summary['boundaryProblems']); summary['boundaryProblems'] = summary['boundaryProblems'][:30]
summary['fontSizeRange'] = [min(v['size'] for v in per_page.values()), max(v['size'] for v in per_page.values())]
json.dump({'summary': summary, 'perPage': per_page}, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in summary.items() if k not in ('worstExamples', 'boundaryProblems', 'lineOverlaps')}, indent=1))
print('worst', summary['worstExamples'][:8])
print('boundary', summary['boundaryProblemCount'], summary['boundaryProblems'][:6])
print('overlaps', summary['lineOverlapCount'], summary['lineOverlaps'][:8])
