"""Pause test for candidate boundary times: fetch +-4 s of a CBR MP3 by byte range, decode, compute a 20 ms energy
envelope (smoothed over 100 ms) and report, for each candidate time, the min envelope within +-300 ms as a ratio of
the window median (the audit's pause test: < 0.35), plus the pauses (>= 100 ms below 0.35) in the window.
usage: python -I -X utf8 pause_check.py <cases.json> [out.json]
  cases: [{label, url, bitrate_kbps, first_byte, size, t: [ms, ...]}]; out: [{label, ratios: [...], pauses: [[a, b]...]}]"""
import os, sys, json, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pylib'))
import miniaudio  # noqa: E402
import numpy as np  # noqa: E402
W, FR = 4000, 20
results = []
for c in json.load(open(sys.argv[1], encoding='utf8')):
    ts = c['t']; lo = max(0, min(ts) - W); hi = max(ts) + W
    br = c['bitrate_kbps']; a = int(c['first_byte'] + lo * br / 8); b = min(c['size'] - 1, int(c['first_byte'] + hi * br / 8))
    req = urllib.request.Request(c['url'], headers={'Range': f'bytes={a}-{b}', 'User-Agent': 'QuranHeals-audit/1.0'})
    raw = urllib.request.urlopen(req, timeout=60).read()
    d = miniaudio.decode(raw, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=8000)
    x = np.asarray(d.samples); n = 8000 * FR // 1000
    e = np.sqrt(np.array([np.mean(x[i:i+n]**2) for i in range(0, len(x) - n, n)])) + 1e-6
    sm = np.convolve(e, np.ones(5) / 5, 'same'); med = np.median(sm)
    out, ratios = [], []
    for t in ts:
        k = int((t - lo) / FR); w = sm[max(0, k - 15):k + 16]
        out.append(f'{t}ms:{w.min()/med:.2f}'); ratios.append(round(float(w.min() / med), 3))
    # pauses: runs where sm < 0.35*med
    runs, start = [], None
    for i, v in enumerate(sm < 0.35 * med):
        if v and start is None: start = i
        if not v and start is not None: runs.append((lo + start * FR, lo + i * FR)); start = None
    pauses = [[p, q] for p, q in runs if q - p >= 100]
    results.append({'label': c['label'], 'ratios': ratios, 'pauses': pauses})
    print(c['label'], ' '.join(out), ' pauses:', ' '.join(f'{p}-{q}' for p, q in pauses))
if len(sys.argv) > 2:
    json.dump(results, open(sys.argv[2], 'w', encoding='utf8'))
