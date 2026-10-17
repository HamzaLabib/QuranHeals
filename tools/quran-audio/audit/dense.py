"""Per-surah acoustic check: for every surah of each read, up to K boundaries (all of them for short surahs), each
tested for a pause (smoothed energy < THRESH x window median) within +-NEAR ms of the stated boundary.

usage: python -I -X utf8 persurah.py <mp3q dir> <out json> <moshafId,...> [K]
"""
import json, os, sys, random, urllib.request, concurrent.futures as cf, math

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402

D, OUT, IDS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
K = int(sys.argv[4]) if len(sys.argv) > 4 else 6
WIN, FR, NEAR, THRESH = 3000, 20, 300, 0.35
audit = {r['moshafId']: r for r in json.load(open(os.path.join(D, 'audit.json'), encoding='utf8'))}
random.seed(29)
prev = json.load(open(OUT, encoding='utf8')) if os.path.exists(OUT) else {}


def fetch(url, a, b):
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}', 'User-Agent': 'QuranHeals-audit/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == 4:
                raise


def near_ratio(fi, t):
    br, first, size = fi['bitrate'], fi['first'], fi['size']
    t0 = max(0, t - WIN)
    a, b = int(first + t0 * br / 8), min(size - 1, int(first + (t + WIN) * br / 8))
    dec = miniaudio.decode(fetch(fi['url'], a, b), output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1)
    n = int(dec.sample_rate * FR / 1000)
    s = dec.samples
    e = [math.sqrt(sum(x * x for x in s[i:i + n:3]) / max(1, len(s[i:i + n:3]))) + 1e-6 for i in range(0, len(s) - n, n)]
    sm = [sum(e[max(0, i - 2):i + 3]) / len(e[max(0, i - 2):i + 3]) for i in range(len(e))]
    med = sorted(sm)[len(sm) // 2]
    c = int((t - t0) / FR)
    w = sm[max(0, c - NEAR // FR):c + NEAR // FR + 1]
    return min(w) / med if w else None


WEAK = json.load(open(os.path.join(D, "weak_pairs.json")))
for mid in IDS:
    if str(mid) in prev:
        continue
    rec = audit[mid]
    jobs = []
    for s in WEAK.get(str(mid), []):
        fi = rec['files'].get(str(s))
        if not fi or not fi.get('bitrate'):
            continue
        tj = json.load(open(os.path.join(D, 'timing', f'{mid}_{s}.json'), encoding='utf8'))
        ay = [x for x in tj if x['ayah'] > 0]
        if len(ay) < 2:
            continue
        ks = range(1, len(ay)) if len(ay) - 1 <= K else random.sample(range(1, len(ay)), K)
        for k in ks:
            jobs.append((s, ay[k]['ayah'], int(ay[k]['start_time']), fi.get('vbrTag') == 'Xing'))

    def run(j):
        s, a, t, vbr = j
        if vbr:
            return (s, a, t, None, 'vbr')
        try:
            return (s, a, t, near_ratio(rec['files'][str(s)], t), None)
        except Exception as ex:
            return (s, a, t, None, str(ex)[:80])

    with cf.ThreadPoolExecutor(10) as ex:
        out = list(ex.map(run, jobs))
    per = {}
    for s, a, t, r, err in out:
        d = per.setdefault(s, {'n': 0, 'pause': 0, 'errors': 0, 'fails': []})
        if r is None:
            d['errors'] += 1
            continue
        d['n'] += 1
        if r < THRESH:
            d['pause'] += 1
        else:
            d['fails'].append([a, round(r, 2)])
    prev[str(mid)] = per
    weak = {s: f"{d['pause']}/{d['n']}" for s, d in per.items() if d['n'] and d['pause'] < math.ceil(0.8 * d['n'])}
    tot = sum(d['pause'] for d in per.values()), sum(d['n'] for d in per.values())
    print(mid, rec['reciter'], 'total', tot, 'weak surahs', weak, flush=True)
    json.dump(prev, open(OUT, 'w', encoding='utf8'))
