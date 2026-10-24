"""Clock-free measurement (Phase 4.4 seek lab). For each burst: find where the pause cut the captured audio, match a
short slice just before the cut against the decoded source (local mapping, immune to capture drop-outs), and compare
the source position at the cut with the player's own reported position at the pause. For a fresh extractor seek, the
start error equals that (true - label) offset, which stays constant while the burst plays. A per-run constant (the
emulator's position-vs-output latency) is removed using the run's unseeked first burst, whose true error is 0."""
import json, re, sys, wave
import numpy as np, miniaudio
LAB, B, MLLT, CBR, OUT = sys.argv[1:6]
SR = 16000
def load_run(run):
    w = wave.open(f'{run}/cap.wav'); csr = w.getframerate()
    cap = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, 2).mean(1) / 32768
    blocks = json.load(open(f'{run}/cap.times.json'))['blocks']
    bn = np.array([b[0] for b in blocks], float); bt = np.array([b[1] for b in blocks], float)
    slope, icpt = np.polyfit(bt, bn, 1)
    logs = [(int(m[1]), m[2], m[3], int(m[4])) for m in re.finditer(r'log (\d+) (play|pause)\|([\w-]+)\|(\d+)', open(f'{run}/server.log').read())]
    return cap[::3], (lambda ms: (slope * ms + icpt) / 3), logs
cache = {}
def source(tid):
    kind, rest = tid.split('_', 1); rid, s = rest.rsplit('_', 1)
    path = {'orig': f'{B}/_audio/{rid}_{s}.mp3', 'hls': f'{B}/_audio/{rid}_{s}.mp3', 'hlslocal': f'{B}/_audio/{rid}_{s}.mp3', 'mllt': f'{MLLT}/{rid}_{s}.mp3', 'cbr': f'{CBR}/{rid}_{s}.mp3'}[kind]
    if path not in cache:
        d = miniaudio.decode_file(path, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR)
        cache[path] = np.asarray(d.samples, dtype=np.float32)
    return cache[path]
def locate(seg, src, guess, span):
    lo = max(0, int((guess - span) * SR)); hi = min(len(src), int((guess + span) * SR) + len(seg)); ref = src[lo:hi]
    if len(ref) <= len(seg): return None, 0
    n = 1 << int(np.ceil(np.log2(len(ref) + len(seg))))
    c = np.fft.irfft(np.fft.rfft(ref, n) * np.conj(np.fft.rfft(seg, n)), n)[:len(ref) - len(seg) + 1]
    cs = np.concatenate([[0.0], np.cumsum(ref.astype(np.float64) ** 2)]); e = np.sqrt((cs[len(seg):] - cs[:-len(seg)]) * np.sum(seg ** 2)) + 1e-9
    k = int(np.argmax(c / e)); return (lo + k) / SR, float((c / e)[k])
out = {}
for run in sys.argv[6:]:
    cap, h2c, logs = load_run(run)
    plays = {}
    for ms, kind, tid, k in logs: plays.setdefault((tid, k), {})[kind] = ms
    for tid in sorted({t for t, _ in plays}):
        res = json.load(open(f'{run}/results/{tid}.json'))['seeks']; src = source(tid); rows = []
        for k, sk in enumerate(res):
            p = plays.get((tid, k))
            if not p or 'pause' not in p: continue
            c1 = int(h2c(p['pause']))
            win = cap[c1:c1 + int(1.5 * SR)]
            db = 20 * np.log10(np.sqrt(np.convolve(win ** 2, np.ones(80) / 80, 'same')) + 1e-9)
            loud = np.flatnonzero(db > -45)
            if not len(loud) or loud[-1] >= len(win) - int(0.3 * SR): rows.append(None); continue
            cut = c1 + loud[-1]
            seg = cap[cut - int(0.45 * SR): cut - int(0.1 * SR)]
            guess = sk['reportedAfterMs'] / 1000 - 0.45
            pos, corr = locate(seg, src, guess, 9)
            if pos is None or corr < 0.7: rows.append(None); continue
            src_cut_ms = (pos + 0.45) * 1000
            j = int(src_cut_ms / 1000 * SR)
            if np.sqrt(np.mean(src[max(0, j - 160):j] ** 2)) < 3e-3: rows.append(None); continue  # cut fell in a silence: ambiguous
            rows.append({'target': sk['targetMs'], 'offsetMs': round(src_cut_ms - sk['reportedAfterMs'], 1), 'corr': round(corr, 2)})
        base = rows[0]['offsetMs'] if rows and rows[0] else None
        assumed = base is None
        if assumed: base = 95.0  # median of the runs whose first burst calibrated (79.7-111.1 ms): +-20 ms uncertainty
        out[tid] = {'run': run.split('/')[-1], 'baselineMs': base, 'baselineAssumed': assumed, 'rows': [None if r is None or base is None else {**r, 'errorMs': round(r['offsetMs'] - base, 1)} for r in rows[1:]]}
        print(tid, out[tid]['run'], 'baseline', base, '(assumed)' if assumed else '', [r['errorMs'] if r else 'n/a' for r in out[tid]['rows']])
json.dump(out, open(OUT, 'w'), indent=1)
