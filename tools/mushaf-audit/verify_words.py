"""Word-by-word verification record of the QPC V1 Mushaf, all 604 pages (one record per word occurrence).

  python tools/mushaf-audit/verify_words.py <fonts dir> <records-*.json.gz> <out dir> [--ppem 62]

Inputs stay outside the repository (Quran Foundation content and fonts); so does the output, which holds the
glyph codes. Per word occurrence (page order, as the app draws it):

  text      The ayah's words against the verified Tanzil text (mobile/assets/quran/quran.sqlite), with the
            reader's rule (Basmala of ayah 1 on its own line, four documented joined pairs). PASS when the
            ayah's count matches, with the Tanzil word this occurrence stands for.
  glyph     Every glyph code is in its own page's font (QCF_P{page}; no fallback is possible) and draws ink.
  spelling  Whether the glyph's outline spells that Tanzil word, letter by letter and mark by mark. There is
            no machine-readable correspondence between QPC V1 glyph outlines and Unicode letters, so this
            is UNVERIFIED unless compared with an authentic image of the same 1405 AH print (see the README).
  render    The word rasterised from its real outlines at --ppem pixels per em (62 ≈ a 20.6-pt line on a 3×
            iPhone), then cut to its native Text frame: 'before' (the advance × the line box: the frame
            the app used until 2026-10-12) and 'after' (the advance ± QCF_V1_INK_OVERFLOW_EM × the line
            box ± QCF_V1_INK_ROOM_V_EM), the latter also shrunk by SNAP_PX device pixels on every side for
            pixel snapping and antialiasing. PASS when no ink pixel falls outside; the pixels each frame
            would lose are recorded, and lineBoxEdgeRiskBefore counts ink within SNAP_PX of the former
            line box's top or bottom. This models how iOS and Android clip a Text to its frame; it is not
            a capture of a device.
  fragment  REVIEW: a tiny contour stored far (> 0.5 em) from its word's advance (a few in the fonts).
  separator For ayah ends: the medallion drawn is the approved ornament with this ayah's number, over
            the marker glyph's own ring.
  native    UNVERIFIED for every word until checked on a device.
"""
import gzip, json, re, sqlite3, sys, csv
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

FONTS, RECORDS, OUT = sys.argv[1], sys.argv[2], Path(sys.argv[3])
PPEM = int(sys.argv[sys.argv.index('--ppem') + 1]) if '--ppem' in sys.argv else 62
ROOT = Path(__file__).resolve().parents[2]
MARKERS_TS = (ROOT / 'mobile/src/mushaf/ayahMarkers.ts').read_text(encoding='utf-8')
PAD_EM = float(re.search(r'QCF_V1_INK_OVERFLOW_EM = ([\d.]+);', MARKERS_TS).group(1))
PAD_V_EM = float(re.search(r'QCF_V1_INK_ROOM_V_EM = ([\d.]+);', MARKERS_TS).group(1))
SNAP_PX = 1.5  # device-pixel snapping of the frame and baseline, plus antialiasing past the outline
UPM, ASC, DESC = 2048, 2541, 1378  # QCF_V1_METRICS: the line box every glyph's Text gets (page 237's own line is shorter)
PAUSE = re.compile(r'^[ۖ-ۜ۞۩]+$')
JOINED = {'2:181': ('بَعْدَ', 'مَا'), '8:6': ('بَعْدَ', 'مَا'), '13:37': ('بَعْدَ', 'مَا'), '37:130': ('إِلْ', 'يَاسِينَ')}


def tanzil_words():
    db = sqlite3.connect(ROOT / 'mobile/assets/quran/quran.sqlite')
    rows = db.execute('SELECT verse_key, surah, ayah, arabic_text FROM verses ORDER BY surah, ayah').fetchall()
    basmala = rows[0][3].split()
    variants = [basmala, [basmala[0][:1] + 'ّ' + basmala[0][1:], *basmala[1:]]]
    out = {}
    for key, surah, ayah, text in rows:
        own = [t for t in text.split() if not PAUSE.match(t)]
        if ayah == 1 and surah not in (1, 9) and any(own[:len(v)] == v for v in variants):
            own = own[len(basmala):]
        pair = JOINED.get(key)
        if pair:
            for i in range(len(own) - 1):
                if (own[i], own[i + 1]) == pair:
                    own = own[:i] + [own[i] + ' ' + own[i + 1]] + own[i + 2:]
                    break
        out[key] = own
    return [r[0] for r in rows], out


def page_records(args):
    page, words, verse_keys, tanzil, marker_art = args
    from fontTools.ttLib import TTFont
    from fontTools.pens.basePen import BasePen
    from PIL import Image, ImageDraw, ImageChops
    import hashlib

    class Pen(BasePen):
        def __init__(self, gs):
            super().__init__(gs); self.contours, self.cur = [], []
        def _moveTo(self, p): self.cur = [p]
        def _lineTo(self, p): self.cur.append(p)
        def _qCurveToOne(self, a, b):
            p0 = self.cur[-1]
            for i in range(1, 9):
                t = i / 8; u = 1 - t
                self.cur.append((u * u * p0[0] + 2 * u * t * a[0] + t * t * b[0], u * u * p0[1] + 2 * u * t * a[1] + t * t * b[1]))
        def _curveToOne(self, a, b, c):
            p0 = self.cur[-1]
            for i in range(1, 9):
                t = i / 8; u = 1 - t
                self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t ** 3 * c[0], u ** 3 * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * c[1]))
        def _closePath(self):
            pts = self.cur
            area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2 if len(pts) > 2 else 0
            if abs(area) > 1: self.contours.append(pts)
            self.cur = []
        _endPath = _closePath

    path = f'{FONTS}/p{page}.ttf'
    font_sha = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    font = TTFont(path)
    cmap, gs, hmtx = font.getBestCmap(), font.getGlyphSet(), font['hmtx']
    family = font['name'].getDebugName(1)
    s = PPEM / UPM
    out = []
    counters = defaultdict(int)
    for w in words:
        key = verse_keys[w['verse_id'] - 1]
        surah, ayah = map(int, key.split(':'))
        rec = {'page': page, 'line': w['line_number'], 'positionInPage': w['position_in_page'], 'surah': surah, 'ayah': ayah,
               'positionInAyah': w['position_in_verse'], 'kind': w['char_type_name'], 'glyphCodes': [f'U+{ord(c):04X}' for c in w['text']],
               'font': {'family': f'QCF_P{page:03d}', 'nameTable': family, 'sha256': font_sha}, 'findings': []}
        # text
        if w['char_type_name'] == 'word':
            counters[key] += 1
            expected = tanzil.get(key, [])
            n = counters[key]
            rec['expectedTanzilWord'] = expected[n - 1] if n <= len(expected) else None
            rec['text'] = 'PASS' if rec['expectedTanzilWord'] is not None else 'FAIL'
        else:
            rec['expectedTanzilWord'] = None
            rec['text'] = 'PASS'  # ayah end; its position (last of the ayah) is checked below
        # glyph + outlines
        x, contours, missing = 0, [], []
        for ch in w['text']:
            name = cmap.get(ord(ch))
            if name is None:
                missing.append(f'U+{ord(ch):04X}'); continue
            pen = Pen(gs); gs[name].draw(pen)
            contours += [[(x + a, b) for a, b in c] for c in pen.contours]
            x += hmtx[name][0]
        adv = x
        rec['glyph'] = 'FAIL' if missing or not contours else 'PASS'
        if missing: rec['findings'].append(f'glyph codes not in the page font: {missing}')
        rec['spelling'] = 'UNVERIFIED'
        # fragments
        for c in contours:
            xs, ys = [p[0] for p in c], [p[1] for p in c]
            far = max(-max(xs), min(xs) - adv)
            if far > 0.5 * UPM and max(xs) - min(xs) < 0.06 * UPM and max(ys) - min(ys) < 0.06 * UPM:
                rec['findings'].append(f'detached fragment {round(far / UPM, 2)} em from the word ({round(max(xs) - min(xs))}×{round(max(ys) - min(ys))} units)')
        rec['fragment'] = 'REVIEW' if any(f.startswith('detached') for f in rec['findings']) else 'PASS'
        # raster
        if contours:
            lo = min(min(p[0] for p in c) for c in contours); hi = max(max(p[0] for p in c) for c in contours)
            ylo = min(min(p[1] for p in c) for c in contours); yhi = max(max(p[1] for p in c) for c in contours)
            x0, x1 = min(lo, 0) - 64, max(hi, adv) + 64
            y0, y1 = min(ylo, -DESC) - 64, max(yhi, ASC) + 64
            W, H = int((x1 - x0) * s) + 2, int((y1 - y0) * s) + 2
            tr = lambda a, b: ((a - x0) * s, (y1 - b) * s)
            mask = Image.new('1', (W, H), 0)
            for c in contours:
                m2 = Image.new('1', (W, H), 0); ImageDraw.Draw(m2).polygon([tr(*p) for p in c], fill=1)
                mask = ImageChops.logical_xor(mask, m2)
            mask = mask.convert('L')  # 0 / 255 (1-bit invert is unreliable in Pillow)
            total = sum(mask.histogram()[1:])
            def lost(left, right, top=ASC, bottom=-DESC, shrink=0.0):
                frame = Image.new('L', (W, H), 0)
                (fx0, fy0), (fx1, fy1) = tr(left, top), tr(right, bottom)
                ImageDraw.Draw(frame).rectangle([fx0 + shrink, fy0 + shrink, fx1 - shrink, fy1 - shrink], fill=255)
                return sum(ImageChops.subtract(mask, frame).histogram()[1:])
            before = lost(0, adv)
            room = (-PAD_EM * UPM, adv + PAD_EM * UPM, ASC + PAD_V_EM * UPM, -DESC - PAD_V_EM * UPM)
            after = max(lost(*room), lost(*room, shrink=SNAP_PX))
            # The former frame's vertical edges alone, with snapping: what a pixel-snapped line box could shave off.
            rec['lineBoxEdgeRiskBefore'] = lost(-10 * UPM, adv + 10 * UPM, ASC, -DESC, SNAP_PX)
            # Where the former frame's lost ink lies: below / above the baseline, left / right of the advance.
            if before:
                base_y = tr(0, 0)[1]
                cut = ImageChops.subtract(mask, (lambda f: (ImageDraw.Draw(f).rectangle([tr(0, ASC), tr(adv, -DESC)], fill=255), f)[1])(Image.new('L', (W, H), 0)))
                bw, bh = cut.size
                below = sum(cut.crop((0, int(base_y), bw, bh)).histogram()[1:])
                left = sum(cut.crop((0, 0, int(tr(0, 0)[0]), bh)).histogram()[1:])
                rec['lostWhere'] = {'belowBaseline': below, 'aboveBaseline': before - below, 'left': left, 'right': before - left}
            rec['inkPixels'] = total
            rec['renderBefore'] = {'lostPixels': before, 'result': 'FAIL' if before else 'PASS'}
            rec['render'] = 'PASS' if after == 0 else 'FAIL'
            rec['renderAfter'] = {'lostPixels': after}
            if before: rec['findings'].append(f'before 2026-10-12: {before} of {total} ink pixels outside the native Text frame (clipped on iOS/Android)')
            if after: rec['findings'].append(f'{after} ink pixels outside the corrected frame')
        else:
            rec['render'] = 'FAIL'
        # separators
        if w['char_type_name'] == 'end':
            number = marker_art.get(ayah)
            rec['separator'] = 'PASS' if number == ayah else 'FAIL'
            rec['separatorNumber'] = number
        rec['native'] = 'UNVERIFIED'
        out.append(rec)
    return page, out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    keys, tanzil = tanzil_words()
    art = (ROOT / 'mobile/src/mushaf/generated/ayahMarkerArtwork.ts').read_text(encoding='utf-8')
    numbers = [int(n) for n in re.findall(r'"ayah": (\d+),', art)]  # the artwork's numbers, in order: entry n is ayah n
    marker_art = {i + 1: n for i, n in enumerate(numbers)}
    records = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2]
    by_page = defaultdict(list)
    for r in records: by_page[r['page_number']].append(r)
    jobs = [(p, sorted(by_page[p], key=lambda r: r['position_in_page']), keys, tanzil, marker_art) for p in range(1, 605)]
    results = {}
    with Pool() as pool:
        for page, recs in pool.imap_unordered(page_records, jobs, chunksize=4):
            results[page] = recs
            if len(results) % 50 == 0: print(f'{len(results)} pages', flush=True)
    # ayah-level text check: as many word occurrences as Tanzil words, one end, last
    per_ayah = defaultdict(list)
    for p in range(1, 605):
        for r in results[p]: per_ayah[(r['surah'], r['ayah'])].append(r)
    for (surah, ayah), recs in per_ayah.items():
        key = f'{surah}:{ayah}'
        words = [r for r in recs if r['kind'] == 'word']
        ok = len(words) == len(tanzil[key]) and recs[-1]['kind'] == 'end' and sum(r['kind'] == 'end' for r in recs) == 1
        if not ok:
            for r in recs: r['text'] = 'FAIL'; r['findings'].append(f'ayah {key}: {len(words)} words vs Tanzil {len(tanzil[key])}')
    statuses = ('text', 'glyph', 'spelling', 'fragment', 'render', 'native')
    edge_words = [(r['page'], r['line'], r['positionInPage']) for p in range(1, 605) for r in results[p] if r.get('lineBoxEdgeRiskBefore')]
    summary = {'pages': 604, 'lines': 0, 'words': 0, 'glyphs': 0, 'separators': 0, 'ayahs': len(per_ayah), 'ppem': PPEM, 'padEm': PAD_EM,
               'counts': {k: defaultdict(int) for k in (*statuses, 'separator', 'renderBefore')}}
    with gzip.open(OUT / 'words.jsonl.gz', 'wt', encoding='utf-8') as f, open(OUT / 'pages.csv', 'w', newline='', encoding='utf-8') as pc:
        cw = csv.writer(pc)
        cw.writerow(['page', 'lines', 'words', 'glyphs', 'separators', 'text_pass', 'glyph_pass', 'render_pass', 'render_fail', 'clipped_before_fix', 'fragment_review', 'spelling_unverified', 'native_unverified'])
        for p in range(1, 605):
            recs = results[p]
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
                for k in statuses: summary['counts'][k][r[k]] += 1
                summary['counts']['renderBefore'][r.get('renderBefore', {}).get('result', 'n/a')] += 1
                if 'separator' in r: summary['counts']['separator'][r['separator']] += 1
            lines = len({r['line'] for r in recs})
            glyphs = sum(len(r['glyphCodes']) for r in recs)
            seps = sum(r['kind'] == 'end' for r in recs)
            summary['lines'] += lines; summary['words'] += len(recs); summary['glyphs'] += glyphs; summary['separators'] += seps
            c = lambda k, v: sum(r[k] == v for r in recs)
            cw.writerow([p, lines, len(recs), glyphs, seps, c('text', 'PASS'), c('glyph', 'PASS'), c('render', 'PASS'), c('render', 'FAIL'),
                         sum(r.get('renderBefore', {}).get('result') == 'FAIL' for r in recs), c('fragment', 'REVIEW'), c('spelling', 'UNVERIFIED'), c('native', 'UNVERIFIED')])
    summary['counts'] = {k: dict(v) for k, v in summary['counts'].items()}
    summary['lineBoxEdgeRiskBefore'] = {'words': len(edge_words), 'pages': sorted({p for p, _, _ in edge_words})}
    json.dump(summary, open(OUT / 'summary.json', 'w', encoding='utf-8'), indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    if '--page' in sys.argv:  # one page, for checking
        page = int(sys.argv[sys.argv.index('--page') + 1])
        keys, tanzil = tanzil_words()
        records = [r for r in json.loads(gzip.open(RECORDS).read()) if r.get('record_type') == 'mushaf_word' and r.get('mushaf_id') == 2 and r['page_number'] == page]
        for r in page_records((page, sorted(records, key=lambda r: r['position_in_page']), keys, tanzil, {n: n for n in range(1, 287)}))[1][:3]:
            print(json.dumps(r, ensure_ascii=False))
    else:
        main()
