"""Measure ayah timing for a whole-surah recording by locating each per-ayah clip of the same recording inside it.

For surah s: downloads <surah base>/sss.mp3 and <clip base>/sssaaa.mp3 for every ayah, then, in canonical order:
  1. Coarse: the whole clip is located (features.py) in [previous end - 2 s, previous end + max(30 s, 3 x clip)]
     (ayah 1: the first 90 s). `score` is that match, `second` the best other match >= 2 s away in the window.
  2. Piecewise: the clip is cut into 3 s chunks; each is located on its own within +-1 s of where the previous chunk
     ends (chunk 0: +-1.5 s of the coarse match). Silent chunks (more than 60% of frames 25 dB or more below the
     clip's 95th-percentile energy) are skipped: their position says nothing. This checks that the whole clip, in order, is
     present in the surah file, and gives the ayah's start (chunk 0) and end (last chunk) without depending on any
     difference in speed or pause length between the two files.
Writes <out>/<s>.json: {surah, duration_ms, ayahs: [{ayah, start_ms, end_ms, voiced_start_ms, voiced_end_ms, clip_ms,
  score, second, gap_ms, chunks: [[clip_ms, surah_ms, score] ...], quiet: [[clip ms, clip ms] ...]}]}  (gap: start - previous end; skipped chunks are not listed)

Used where MP3Quran has no usable timing but EveryAyah has per-ayah files cut from the same recording (established
per surah by this very check): the files serve only as a reference to measure the MP3Quran file; the app never
plays them. tools/quran-audio/README.md, "Measured timing".

usage: python -I -X utf8 align_everyayah.py <surah base url> <clip base url> <ayah_counts.json> <out dir> <work dir> [surahs]
  e.g. https://cdn.mp3quran.net/audio/ali-hudhaifi/r1/ https://everyayah.com/data/Hudhaify_128kbps/
  Network: each surah file once, plus every clip (about 1 GB for a whole recording at 128 kbps); work files are
  deleted after each surah.
"""
import sys, os, json, urllib.request, concurrent.futures as cf, shutil, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import feats, locate  # noqa: E402  (puts ../pylib on the path)
import numpy as np  # noqa: E402

SURAH_BASE, CLIP_BASE, COUNTS, OUT, WORK = sys.argv[1:6]
counts = json.load(open(COUNTS))
surahs = [int(x) for x in sys.argv[6].split(',')] if len(sys.argv) > 6 else range(1, 115)
os.makedirs(OUT, exist_ok=True)
CH = 300  # chunk: 3 s of 10 ms frames


def dl(url, path):
    for i in range(6):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'QuranHeals-audit/1.0'})
            with urllib.request.urlopen(req, timeout=180) as r, open(path, 'wb') as f:
                shutil.copyfileobj(r, f)
            return path
        except Exception:
            if i == 5:
                raise
            time.sleep(2 + 3 * i)


def best(X, T, lo, hi):
    lo = max(0, lo); hi = min(len(X), hi)
    if hi - lo < len(T):
        return None, None
    r = locate(X[lo:hi], T); k = int(np.argmax(r))
    return lo + k, float(r[k])


for s in surahs:
    of = os.path.join(OUT, f'{s}.json')
    if os.path.exists(of):
        continue
    wd = os.path.join(WORK, str(s)); os.makedirs(wd, exist_ok=True)
    n = counts[s - 1]
    sf = dl(f'{SURAH_BASE}{s:03d}.mp3', os.path.join(wd, 'surah.mp3'))
    with cf.ThreadPoolExecutor(8) as ex:
        clips = list(ex.map(lambda a: dl(f'{CLIP_BASE}{s:03d}{a:03d}.mp3', os.path.join(wd, f'{a:03d}.mp3')), range(1, n + 1)))
    X, dur, _ = feats(sf)
    prev_end = 0; rows = []
    for a, cfile in enumerate(clips, 1):
        T, td, edb = feats(cfile); L = len(T)
        row = {'ayah': a, 'start_ms': None, 'end_ms': None, 'clip_ms': round(td * 1000), 'score': None, 'second': None, 'gap_ms': None, 'chunks': []}
        lo = 0 if a == 1 else prev_end // 10 - 200
        hi = (9000 if a == 1 else prev_end // 10 + max(3000, 3 * L)) + L
        lo = max(0, lo); hi = min(len(X), hi)
        if hi - lo <= L:
            rows.append(row); continue
        r = locate(X[lo:hi], T); i = int(np.argmax(r))
        far = np.abs(np.arange(len(r)) - i) > 200
        row['score'] = round(float(r[i]), 3)
        row['second'] = round(float(np.max(np.where(far, r, -1))), 3) if far.any() else None
        coarse = lo + i
        # Piecewise.
        quiet = edb < np.percentile(edb, 95) - 25
        expected = coarse; first = last = None; chunks = []
        for c0 in range(0, L, CH):
            c1 = min(L, c0 + CH)
            if c1 - c0 < 100:
                break
            if quiet[c0:c1].mean() > 0.6:
                expected += c1 - c0
                continue
            pad = 150 if first is None else 100
            pos, sc = best(X, T[c0:c1], expected - pad, expected + pad + (c1 - c0))
            if pos is None:
                break
            chunks.append([c0 * 10, pos * 10, round(sc, 3)])
            if first is None:
                first = pos - c0
            last = pos + (c1 - c0)
            expected = pos + (c1 - c0)
        row['chunks'] = chunks
        if first is not None:
            # start/end: where the clip's first and last frames map (its own leading/trailing silence included);
            # voiced_*: where its first and last non-quiet frames map (each through the nearest located chunk).
            def mapped(f):
                c = [ch for ch in chunks if ch[0] // 10 <= f] or chunks[:1]
                return c[-1][1] // 10 + (f - c[-1][0] // 10)
            voiced = np.flatnonzero(~quiet)
            start = first; end = mapped(L)
            row['start_ms'] = start * 10; row['end_ms'] = end * 10
            row['voiced_start_ms'] = mapped(int(voiced[0])) * 10 if len(voiced) else None
            row['voiced_end_ms'] = mapped(int(voiced[-1]) + 1) * 10 if len(voiced) else None
            row['gap_ms'] = None if a == 1 else start * 10 - prev_end
            prev_end = end * 10
        # The clip's quiet stretches (>= 150 ms), in clip ms: a pause that is shorter in the surah file explains a
        # chunk sitting earlier than expected (refine-results.mjs).
        q = np.concatenate([[0], quiet.astype(int), [0]])
        edges = np.flatnonzero(np.diff(q))
        row['quiet'] = [[int(qa) * 10, int(qb) * 10] for qa, qb in zip(edges[::2], edges[1::2]) if qb - qa >= 15]
        rows.append(row)
    json.dump({'surah': s, 'duration_ms': round(dur * 1000), 'ayahs': rows}, open(of, 'w'))
    cs = [c[2] for x in rows for c in x['chunks']]
    print(s, n, 'chunks', len(cs), 'min chunk', min(cs) if cs else None, 'p1', round(float(np.percentile(cs, 1)), 3) if cs else None, flush=True)
    shutil.rmtree(wd, ignore_errors=True)
