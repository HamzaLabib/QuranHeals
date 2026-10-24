"""Summarise tf_verify.py outputs: per file, the windows where the expected text beats the control by >= MARGIN
(confirmed windows), the ayahs they cover, their order, and the gaps (ayahs never confirmed).
usage: python tf_summary.py <margin> <tf.json>...   (ayah counts from the file name's surah)"""
import json, sys, re
N = {1: 7, 55: 78, 72: 28, 73: 20, 75: 40, 76: 31, 78: 40, 79: 46, 82: 19, 83: 36, 85: 22, 86: 17, 87: 19, 88: 26, 89: 30, 96: 19, 98: 8, 100: 11}
M = float(sys.argv[1]); out = {}
for f in sys.argv[2:]:
    s = int(re.search(r'(\d+)\.json$', f).group(1)); w = json.load(open(f))
    rel = lambda x: x.get('rel', x.get('lp')); crel = lambda x: x.get('controlRel', x.get('controlLp'))
    conf = [x for x in w if rel(x) - crel(x) >= M]
    seq = [(x['t'], x['span'][0], x['span'][1]) for x in conf]
    back = [(a, b) for a, b in zip(seq, seq[1:]) if b[1] < a[1] - 1]
    # a return to an earlier ayah (start below the previous window's start): repetition by the reciter, or overlap noise
    returns = [(a[0], b[0], b[1]) for a, b in zip(seq, seq[1:]) if b[1] < a[1] and not b[1] < a[1] - 1]
    cov = sorted({k for _, a, b in seq for k in range(a, b + 1)})
    n = N.get(s); miss = [k for k in range(1, n + 1) if k not in cov] if n else []
    out[s] = {'windows': len(w), 'confirmed': len(conf), 'ayahsConfirmed': cov, 'notConfirmed': miss, 'backwardSteps': len(back), 'returnsByOne': returns,
              'first': seq[0][1] if seq else None, 'last': seq[-1][2] if seq else None}
    print(f"{s:>3}: {len(conf):3d}/{len(w):3d} windows confirmed; ayahs {len(cov)}/{n}; not confirmed {miss}; backward steps {len(back)} {back[:4]}; returns by one {returns}")
    print('      ' + ' '.join(f"{t:.0f}:{a}" + (f"-{b}" if b != a else '') for t, a, b in seq))
json.dump(out, open('tf/summary.json', 'w'), indent=1)
