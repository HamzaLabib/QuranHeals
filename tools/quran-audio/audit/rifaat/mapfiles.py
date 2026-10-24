"""Which labelled collection recording (archive.org way2llh22, titles give surah + ayah range) does each stretch of
each MP3Quran Rifaat file come from?  20 s pieces every 40 s, located with audit/features.py (re-encoding-robust
log-band features; same audio scores ~0.8-1, other audio < 0.6) in the candidate collection files for that surah."""
import json, os, sys, glob
sys.path.insert(0, sys.argv[1] + '/audit')
from features import feats, locate
import numpy as np
A, W, OUT = sys.argv[2], sys.argv[3], sys.argv[4]
# collection files that may contain each surah (file-name prefix, plus the multi-surah recordings that list it)
CAND = {1: ['01_'], 10: ['10-'], 11: ['11-'], 12: ['12-'], 17: ['17-'], 18: ['18-'], 19: ['19-'], 20: ['20-'], 48: ['48-'],
        54: ['54-'], 55: ['55-'], 56: ['54-1_alkmr_1-32_alwak3a', '55-2_'], 69: ['55-1_alrhmn_1-78_walhaka'], 72: ['72-'],
        73: ['72-1_algn1-28_walmzml', '73-'], 75: ['75-'], 76: ['75-', '76-'], 77: ['75-1_alkeama_1-40_walansan_1-31_w'], 78: ['78_'],
        79: ['78_'], 81: ['78_'], 82: ['82-'], 83: ['82-'], 85: ['82-', '54-1_alkmr_1-32_m3_albrwg'], 86: ['86-'], 87: ['87_'],
        88: ['87_'], 89: ['87_'], 96: ['96-', '73-1_almzml1-20_aldhe'], 98: ['96-'], 100: ['96-']}
files = sorted(os.path.basename(p) for p in glob.glob(W + '/*.mp3') + glob.glob(W + '/*.MP3'))
cache = {}
def F(name):
    if name not in cache:
        X, d, _ = feats(os.path.join(W, name)); cache[name] = (X[::2].astype(np.float32), d)  # 20 ms rows
    return cache[name]
res = json.load(open(OUT)) if os.path.exists(OUT) else {}
for s in [int(x) for x in sys.argv[5].split(',')]:
    if str(s) in res: continue
    X, dur, _ = feats(f'{A}/rifaat_{s}.mp3'); X = X[::2].astype(np.float32)
    cands = [f for f in files if any(f.startswith(p) for p in CAND[s])]
    pieces = []
    for t0 in np.arange(0, max(1, dur - 20), 40):
        T = X[int(t0 * 50):int((t0 + 20) * 50)]
        best = (None, -1, None)
        for c in cands:
            Y, cd = F(c)
            if len(Y) <= len(T): continue
            r = locate(Y, T); i = int(np.argmax(r))
            if r[i] > best[1]: best = (c, float(r[i]), i / 50)
        pieces.append({'t': float(t0), 'file': best[0], 'score': round(best[1], 3), 'at': None if best[2] is None else round(best[2], 2)})
    res[str(s)] = {'durationS': round(dur, 1), 'candidates': cands, 'pieces': pieces}
    good = [p for p in pieces if p['score'] >= 0.7]
    print(s, f'{dur:.0f}s', len(pieces), 'pieces;', len(good), 'matched >=0.7;', sorted({p['file'] for p in good}), flush=True)
    json.dump(res, open(OUT, 'w'), indent=1)
    cache.clear()
