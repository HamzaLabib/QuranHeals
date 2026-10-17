"""Acoustic check of MP3Quran ayah boundaries.

For sampled ayah boundaries, fetch a byte range around the stated time (files are CBR, so byte offset = first_frame +
t * bitrate / 8), decode it and test whether a pause (low-energy region) lies near the stated boundary. Ayah midpoints
are measured the same way as a control.

usage: python -I acoustic.py <mp3q dir> <out json> [per_surah]
"""
import json, os, sys, random, urllib.request, concurrent.futures as cf, math, array

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402

D, OUT = sys.argv[1], sys.argv[2]
PER_SURAH = int(sys.argv[3]) if len(sys.argv) > 3 else 3
WIN_MS, FRAME_MS, NEAR_MS = 3000, 40, 300
audit = json.load(open(os.path.join(D, 'audit.json'), encoding='utf8'))
random.seed(7)


def fetch(url, a, b):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}', 'User-Agent': 'QuranHeals-audit/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == 3:
                raise


def energies(pcm, sr, ch):
    n = int(sr * FRAME_MS / 1000) * ch
    out = []
    for i in range(0, len(pcm) - n, n):
        seg = pcm[i:i + n]
        out.append(math.sqrt(sum(s * s for s in seg[::4]) / max(1, len(seg[::4]))) + 1e-6)
    return out


def probe(fi, t_ms):
    """Returns (ratio_near, offset_of_min_ms): min energy within +-NEAR_MS of t over the window median."""
    br, first, size = fi['bitrate'], fi['first'], fi['size']
    t0 = max(0, t_ms - WIN_MS)
    a = int(first + t0 * br / 8)
    b = min(size - 1, int(first + (t_ms + WIN_MS) * br / 8))
    if b - a < 2000:
        return None
    raw = fetch(fi['url'], a, b)
    try:
        dec = miniaudio.decode(raw, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1)
    except Exception:
        return None
    e = energies(dec.samples, dec.sample_rate, 1)
    if len(e) < 20:
        return None
    # the decoded window starts at t0 (frame-accurate to ~26 ms)
    centre = int((t_ms - t0) / FRAME_MS)
    lo, hi = max(0, centre - NEAR_MS // FRAME_MS), min(len(e), centre + NEAR_MS // FRAME_MS + 1)
    if lo >= hi:
        return None
    srt = sorted(e)
    med = srt[len(srt) // 2]
    near = e[lo:hi]
    m = min(near)
    return m / med, (lo + near.index(m) - centre) * FRAME_MS


results = {}
for rec in audit:
    if not rec.get('timingRead'):
        continue
    mid = rec['moshafId']
    jobs = []
    for s in range(1, 115):
        fi = rec['files'].get(str(s))
        if not fi or fi.get('vbrTag') == 'Xing' or not fi.get('bitrate'):
            continue
        tpath = os.path.join(D, 'timing', f'{mid}_{s}.json')
        tj = json.load(open(tpath, encoding='utf8'))
        ay = [x for x in tj if x['ayah'] > 0]
        if len(ay) < 2:
            continue
        idx = random.sample(range(1, len(ay)), min(PER_SURAH, len(ay) - 1))
        for k in idx:
            jobs.append((s, ay[k]['ayah'], 'boundary', int(ay[k]['start_time'])))
            mid_t = (int(ay[k]['start_time']) + int(ay[k]['end_time'])) // 2
            jobs.append((s, ay[k]['ayah'], 'control', mid_t))
    out = []

    def run(j):
        s, a, kind, t = j
        try:
            p = probe(rec['files'][str(s)], t)
        except Exception as ex:
            return (s, a, kind, t, None, str(ex))
        return (s, a, kind, t, p, None)

    with cf.ThreadPoolExecutor(8) as ex:
        for r in ex.map(run, jobs):
            out.append(r)
    b = [r[4][0] for r in out if r[2] == 'boundary' and r[4]]
    c = [r[4][0] for r in out if r[2] == 'control' and r[4]]
    pct = lambda xs, th: round(100 * sum(1 for x in xs if x < th) / max(1, len(xs)), 1)
    summ = {'boundaries': len(b), 'controls': len(c), 'pause_at_boundary_pct': pct(b, 0.15), 'pause_at_control_pct': pct(c, 0.15),
            'median_ratio_boundary': round(sorted(b)[len(b) // 2], 3) if b else None, 'median_ratio_control': round(sorted(c)[len(c) // 2], 3) if c else None}
    by_surah = {}
    for r in out:
        if r[2] == 'boundary' and r[4]:
            by_surah.setdefault(r[0], []).append(r[4][0])
    summ['surahs_with_no_pause_boundaries'] = sorted(s for s, xs in by_surah.items() if all(x >= 0.15 for x in xs) and len(xs) >= 2)
    results[mid] = {'summary': summ, 'samples': out}
    print(mid, rec['reciter'], json.dumps(summ, ensure_ascii=False), flush=True)
    json.dump(results, open(OUT, 'w', encoding='utf8'), ensure_ascii=False)
