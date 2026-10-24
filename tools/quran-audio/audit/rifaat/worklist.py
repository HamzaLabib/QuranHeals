"""Human-assisted timing worklist for a recording whose content the teacher-forced check confirmed (tf_verify.py).
For every ayah transition k -> k+1 it gives the time bracket the evidence allows - from the last confirmed window that
holds only ayahs <= k to the end of the first confirmed window holding k+1 (narrowed to one window when a window's
best span is k..k+1) - and the pauses inside it (digital-silence runs >= 200 ms and dips >= 300 ms more than 30 dB
below the file's median level), longest first. It places NO boundary: a listener chooses (or rejects) each one by ear.
Transitions with no confirmed window on one side are marked 'unbracketed' (the listener searches the whole gap).
usage: python -I worklist.py <audio> <tf.json> <ayah count> <margin> <out.json>"""
import json, sys, numpy as np, miniaudio
audio, tfp, n, M, outp = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
SR = 16000
x = np.asarray(miniaudio.decode_file(audio, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=1, sample_rate=SR).samples, dtype=np.float32)
dur = len(x) / SR
# pauses at 10 ms resolution
fr = x[:len(x) // 160 * 160].reshape(-1, 160)
zero = (np.abs(fr) < 1e-5).all(1); db = 10 * np.log10((fr ** 2).mean(1) + 1e-12)
med = np.median(db[~zero]) if (~zero).any() else -40
quiet = zero | (db < med - 30)
pauses = []
e = np.flatnonzero(np.diff(np.r_[0, quiet.astype(np.int8), 0]))
for a, b in zip(e[::2], e[1::2]):
    L = (b - a) * 10
    if (zero[a:b].all() and L >= 200) or L >= 300:
        pauses.append({'from_ms': int(a * 10), 'to_ms': int(b * 10), 'ms': int(L), 'kind': 'digital silence' if zero[a:b].all() else 'quiet dip'})
w = json.load(open(tfp))
rel = lambda q: q.get('rel', q.get('lp')); crel = lambda q: q.get('controlRel', q.get('controlLp'))
conf = [q for q in w if rel(q) - crel(q) >= M]
rows = []
for k in range(0, n):  # transition into ayah k+1 (k = 0: start of ayah 1)
    before = [q for q in conf if q['span'][1] <= k]
    after = [q for q in conf if q['span'][0] >= k + 1]
    both = [q for q in conf if q['span'][0] <= k < q['span'][1]]
    if both:
        lo, hi, how = both[0]['t'], both[-1]['t'] + 30, 'window spanning both ayahs'
    else:
        lo = before[-1]['t'] if before else 0.0
        hi = min(after[0]['t'] + 30, dur) if after else dur
        how = 'between confirmed windows' if before and after else 'unbracketed (no confirmed window on one side)'
    if after and lo > after[0]['t'] + 30 or before and hi < before[-1]['t']:
        how = 'CONFLICT (order evidence contradicts)'
    inside = sorted([p for p in pauses if lo * 1000 <= p['from_ms'] and p['to_ms'] <= hi * 1000], key=lambda p: -p['ms'])
    rows.append({'ayah': k + 1, 'bracket_s': [round(lo, 1), round(hi, 1)], 'evidence': how, 'pauseCandidates': inside[:6], 'pausesInBracket': len(inside)})
out = {'audio': audio.split('/')[-1], 'durationS': round(dur, 1), 'margin': M, 'rule': __doc__.split('usage')[0].strip(), 'starts': rows,
       'placedBoundaries': 0}
json.dump(out, open(outp, 'w'), indent=1)
for r in rows: print(f"ayah {r['ayah']:3d} starts in {r['bracket_s'][0]:7.1f}-{r['bracket_s'][1]:7.1f}s ({r['evidence']}); {r['pausesInBracket']} pauses; longest " + ', '.join(f"{p['from_ms']/1000:.1f}s/{p['ms']}ms" for p in r['pauseCandidates'][:3]))
