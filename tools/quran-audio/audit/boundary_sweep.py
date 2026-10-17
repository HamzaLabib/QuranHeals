"""Full boundary sweep, step 2. For every boundary of every job (boundary-sweep-prep.mjs), fetch +-3 s of the CBR file by byte range,
decode, and measure a 20 ms RMS envelope smoothed over 100 ms, relative to the window median:
  near  = min ratio within +-300 ms of the boundary (the audit's pause test: near < 0.35)
  at    = ratio at the boundary itself
  runs  = pauses in the window (ratio < 0.35 for >= 100 ms), as [start, end] ms relative to the boundary
Appends one JSON line per boundary to <out.jsonl>; finished (id, surah, ayah) are skipped on a re-run.
The classification (pause / displaced / unconfirmed) is made by refine-results.mjs from this output.
usage: python -I -X utf8 boundary_sweep.py <jobs.json> <out.jsonl> [threads]
Network: one byte range of about 6 s per boundary from cdn.mp3quran.net (58,670 boundaries on 2026-10-17: ~3 GB).
"""
import sys, json, os, time, urllib.request, concurrent.futures as cf, threading
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402
import numpy as np  # noqa: E402
JOBS, OUT = sys.argv[1], sys.argv[2]
THREADS = int(sys.argv[3]) if len(sys.argv) > 3 else 16
W, FR = 3000, 20
done = set()
if os.path.exists(OUT):
    for l in open(OUT, encoding='utf8'):
        try: d = json.loads(l); done.add((d['id'], d['s'], d['a']))
        except Exception: pass
lock = threading.Lock(); out = open(OUT, 'a', encoding='utf8')
def fetch(url, a, b):
    for i in range(6):
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={a}-{b}', 'User-Agent': 'QuranHeals-audit/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r: return r.read()
        except Exception:
            if i == 5: raise
            time.sleep(1 + 2 * i)
def measure(job, ayah, t):
    t0 = max(0, t - W); br = job['kbps']
    a = int(job['first'] + t0 * br / 8); b = min(job['size'] - 1, int(job['first'] + (t + W) * br / 8))
    d = miniaudio.decode(fetch(job['url'], a, b), output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=8000)
    x = np.asarray(d.samples, dtype=np.float32); n = 160
    m = len(x) // n
    if m < 20: return {'id': job['id'], 's': job['surah'], 'a': ayah, 't': t, 'err': 'short'}
    e = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1)) + 1e-6
    sm = np.convolve(e, np.ones(5) / 5, 'same'); med = float(np.median(sm)); r = sm / med
    c = int((t - t0) / FR); w = r[max(0, c - 15):c + 16]
    runs, st = [], None
    for i, v in enumerate(r < 0.35):
        if v and st is None: st = i
        if (not v or i == len(r) - 1) and st is not None:
            en = i if not v else i + 1
            if (en - st) * FR >= 100: runs.append([t0 + st * FR - t, t0 + en * FR - t])
            st = None
    return {'id': job['id'], 's': job['surah'], 'a': ayah, 't': t, 'near': round(float(w.min()), 3), 'at': round(float(r[min(c, len(r) - 1)]), 3), 'runs': runs}
def run(item):
    job, ayah, t = item
    try: res = measure(job, ayah, t)
    except Exception as ex: res = {'id': job['id'], 's': job['surah'], 'a': ayah, 't': t, 'err': str(ex)[:100]}
    with lock: out.write(json.dumps(res) + '\n'); out.flush()
items = [(j, a, t) for j in json.load(open(JOBS, encoding='utf8')) for a, t in j['boundaries'] if (j['id'], j['surah'], a) not in done]
print('to do', len(items), flush=True)
with cf.ThreadPoolExecutor(THREADS) as ex:
    for k, _ in enumerate(ex.map(run, items)):
        if k % 5000 == 0: print(k, flush=True)
print('finished', flush=True)
