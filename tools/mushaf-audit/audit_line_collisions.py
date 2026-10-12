"""Word-level collision audit between neighbouring lines, all 604 pages (Traditional, 29 tiles, and
Taller heights: 33 tiles, the iPhone 393, and 35, the cap). Words are placed as QpcV1PageText lays them out: right to left, justified
(space-between) across the text area, at the size the widest line gives; baseline centred in each row.
A collision is two words in adjacent lines whose x ranges overlap AND whose glyph bounding boxes
overlap vertically. Bounding boxes are conservative (the outlines themselves may still clear), so each
hit is then checked on the actual outlines: both glyphs are rasterised at their positions and the
overlapping ink pixels counted."""
import gzip, json, sys
from collections import defaultdict
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FIT, W, OPENING_SIZE, WORD_GAP = 0.985, 1000.0, 0.0692, 0.033
def text_area(tiles):
    tile = W / 20
    inner_w, inner_h = W - 2 * tile, W * tiles / 20 - 2 * tile
    inset_y = W * 10 / 593
    return inner_w - 2 * W * 25 / 593, inner_h - 2 * inset_y - 2 * W * 10 / 593

records = json.loads(gzip.open(RECORDS).read())
words = defaultdict(lambda: defaultdict(list))
for r in records:
    if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2:
        words[r['page_number']][r['line_number']].append((r['position_in_page'], r['text'], r['char_type_name']))

try:
    from PIL import Image, ImageDraw
except ImportError:
    Image = None

def outline_overlap(font_path, ch_a, pos_a, ch_b, pos_b, em, pxPerUnit=0.25):
    """Rasterise both glyph outlines (page units) and count shared ink pixels."""
    from PIL import ImageFont
    size_px = int(round(em * 2048 * pxPerUnit * 4))
    f = ImageFont.truetype(font_path, size_px)
    scale = size_px / (em * 2048)  # px per page unit
    xs = [pos_a[0], pos_b[0], pos_a[0] + pos_a[2], pos_b[0] + pos_b[2]]
    ys = [pos_a[1], pos_b[1]]
    x0, y0 = min(xs) - 5, min(ys) - em * 2048 * 1.5
    wpx = int((max(xs) - x0 + 10) * scale); hpx = int((max(ys) + em * 2048 * 1.5 - y0) * scale)
    imgs = []
    for ch, (x, baseline, _) in ((ch_a, pos_a), (ch_b, pos_b)):
        im = Image.new('L', (max(wpx, 1), max(hpx, 1)), 0)
        d = ImageDraw.Draw(im)
        # Pillow has no RAQM here; reverse the presentation forms to rasterise Android's RTL glyph order.
        d.text(((x - x0) * scale, (baseline - y0) * scale), ch[::-1], font=f, fill=255, anchor='ls')
        imgs.append(im)
    a, b = imgs[0].load(), imgs[1].load()
    shared = 0
    for yy in range(imgs[0].height):
        for xx in range(imgs[0].width):
            if a[xx, yy] > 128 and b[xx, yy] > 128:
                shared += 1
    return shared

result = {'byLayout': {}}
for tiles in range(29, 36):
    tw, th = text_area(tiles)
    pitch = th / 15
    bbox_hits, ink_hits, examples = 0, 0, []
    for page in range(1, 605):
        path = f'{FONTS}/p{page}.ttf'
        font = TTFont(path)
        upm = font['head'].unitsPerEm; asc, desc = font['hhea'].ascent, -font['hhea'].descent
        cmap, glyf, hmtx = font.getBestCmap(), font['glyf'], font['hmtx']
        def metrics(ch):
            n = cmap[ord(ch)]; g = glyf[n]
            return (hmtx[n][0], (g.xMin, g.xMax, g.yMin, g.yMax) if g.numberOfContours else (0, 0, 0, 0))
        lines = {ln: [(text, kind) for _, text, kind in sorted(ws)] for ln, ws in words[page].items()}
        adv = {ln: [sum(metrics(c)[0] for c in text) for text, _ in ws] for ln, ws in lines.items()}
        size = tw * OPENING_SIZE if page <= 2 else tw * FIT / (max(sum(a) for a in adv.values()) / upm)
        em = size / upm
        pitch = text_area(29)[1] / 15 if page <= 2 else th / 15
        placed = {}
        for ln, ws in lines.items():
            widths = [a * em for a in adv[ln]]
            gap = WORD_GAP * size if page <= 2 else (tw - sum(widths)) / (len(ws) - 1) if len(ws) > 1 else 0
            x_right = (tw + sum(widths) + gap * (len(ws) - 1)) / 2 if page <= 2 else tw
            baseline = (ln - 0.5) * pitch + (asc - desc) / 2 * em
            boxes = []
            for (ch, kind), w in zip(ws, widths):
                left = x_right - w
                x, x_lo, x_hi, y_lo, y_hi = 0, float('inf'), float('-inf'), float('inf'), float('-inf')
                for c in reversed(ch):
                    advance, bounds = metrics(c)
                    gx0, gx1, gy0, gy1 = bounds
                    x_lo, x_hi = min(x_lo, x + gx0), max(x_hi, x + gx1)
                    y_lo, y_hi = min(y_lo, gy0), max(y_hi, gy1)
                    x += advance
                boxes.append((left + x_lo * em, left + x_hi * em, baseline - y_hi * em, baseline - y_lo * em, ch, baseline, kind, left, w))
                x_right = left - gap
            placed[ln] = boxes
        for ln, boxes in placed.items():
            for upper in boxes:
                for lower in placed.get(ln + 1, []):
                    if upper[6] == 'end' or lower[6] == 'end':
                        continue
                    if upper[1] <= lower[0] or lower[1] <= upper[0]:
                        continue
                    overlap = upper[3] - lower[2]
                    if overlap > 0:
                        bbox_hits += 1
                        shared = outline_overlap(path, upper[4], (upper[7], upper[5], upper[8]), lower[4], (lower[7], lower[5], lower[8]), em) if Image else -1
                        if shared > 0:
                            ink_hits += 1
                            if len(examples) < 20:
                                examples.append({'page': page, 'line': ln, 'sharedPx': shared, 'bboxOverlapEm': round(overlap / size, 3)})
    result['byLayout'][tiles] = {'bboxHits': bbox_hits, 'inkCollisions': ink_hits, 'examples': examples}
    print(tiles, result['byLayout'][tiles]['bboxHits'], result['byLayout'][tiles]['inkCollisions'], examples[:6], flush=True)
json.dump(result, open(OUT, 'w'), indent=1)
