"""Where is the nearest pause relative to each stated ayah boundary? (systematic shift vs. reverb)

usage: python -I -X utf8 offsets.py <mp3q dir> <out json> <moshafId,...> [per_surah] [surahs]
"""
import json, os, sys, random, urllib.request, concurrent.futures as cf, math

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402

D, OUT, IDS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
PER = int(sys.argv[4]) if len(sys.argv) > 4 else 4
SURAHS = [int(x) for x in sys.argv[5].split(',')] if len(sys.argv) > 5 else list(range(1, 115))
WIN, FR = 4000, 20
audit = {r['moshafId']: r for r in json.load(open(os.path.join(D, 'audit.json'), encoding='utf8'))}
random.seed(11)


def fetch(url, a, b):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}', 'User-Agent': 'QuranHeals-audit/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == 3:
                raise


def profile(fi, t):
    br, first, size = fi['bitrate'], fi['first'], fi['size']
    t0 = max(0, t - WIN)
    a, b = int(first + t0 * br / 8), min(size - 1, int(first + (t + WIN) * br / 8))
    dec = miniaudio.decode(fetch(fi['url'], a, b), output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1)
    n = int(dec.sample_rate * FR / 1000)
    s = dec.samples
    e = [math.sqrt(sum(x * x for x in s[i:i + n:3]) / max(1, len(s[i:i + n:3]))) + 1e-6 for i in range(0, len(s) - n, n)]
    return e, int((t - t0) / FR)


def analyse(fi, t):
    e, c = profile(fi, t)
    med = sorted(e)[len(e) // 2]
    # smooth over 100 ms so a single quiet frame inside a word is not a pause
    k = 5
    sm = [sum(e[max(0, i - k // 2):i + k // 2 + 1]) / len(e[max(0, i - k // 2):i + k // 2 + 1]) for i in range(len(e))]
    lo, hi = max(0, c - 2000 // FR), min(len(sm), c + 2000 // FR)
    seg = sm[lo:hi]
    m = min(seg)
    off = (lo + seg.index(m) - c) * FR
    near = min(sm[max(0, c - 300 // FR):c + 300 // FR + 1])
    return {'ratio_near': near / med, 'deepest_off_ms': off, 'deepest_ratio': m / med}


res = {}
for mid in IDS:
    rec = audit[mid]
    jobs = []
    for s in SURAHS:
        fi = rec['files'].get(str(s))
        if not fi or fi.get('vbrTag') == 'Xing':
            continue
        tj = json.load(open(os.path.join(D, 'timing', f'{mid}_{s}.json'), encoding='utf8'))
        ay = [x for x in tj if x['ayah'] > 0]
        if len(ay) < 2:
            continue
        for k in random.sample(range(1, len(ay)), min(PER, len(ay) - 1)):
            jobs.append((s, ay[k]['ayah'], int(ay[k]['start_time'])))

    def run(j):
        try:
            return (*j, analyse(rec['files'][str(j[0])], j[2]))
        except Exception as ex:
            return (*j, {'error': str(ex)})

    with cf.ThreadPoolExecutor(8) as ex:
        out = list(ex.map(run, jobs))
    res[mid] = out
    offs = [o[3]['deepest_off_ms'] for o in out if 'deepest_off_ms' in o[3]]
    near_ok = sum(1 for o in out if o[3].get('ratio_near', 9) < 0.25)
    hist = {}
    for v in offs:
        b = int(round(v / 250.0) * 250)
        hist[b] = hist.get(b, 0) + 1
    print(mid, rec['reciter'], 'n', len(out), 'pause<0.25 within 300ms:', near_ok, 'deepest-offset hist:', dict(sorted(hist.items())), flush=True)
json.dump(res, open(OUT, 'w', encoding='utf8'), ensure_ascii=False)
