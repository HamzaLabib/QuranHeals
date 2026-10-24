"""Are two sources' files of a surah the SAME PERFORMANCE? (surah-sources/fetch.mjs caches.)

For each surah both sources have: 10 s pieces of source A, one every 30 s (at least 5), are each located in source B's
file (../audit/features.py: log-spectral features, robust to bitrate and sample rate). Same performance: (almost) every
piece found (score >= 0.7) at a near-constant lag (the pieces' lags within 1.5 s of their median), in order. Writes per
surah: pieces, found, the median score, the lag spread and the verdict 'same' | 'different' | 'partly' (some pieces
found: an edit, a cut, or a different take of part of the surah).

usage: python -I -X utf8 compare.py <source A dir> <source B dir> <out.json> [surahs]
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'audit'))
from features import feats, locate  # noqa: E402  (puts ../pylib on the path)
import numpy as np  # noqa: E402

PIECE, STEP, FOUND = 1000, 3000, 0.7  # 10 ms frames


def main():
    a_dir, b_dir, outp = sys.argv[1:4]
    want = set(int(x) for x in sys.argv[4].split(',')) if len(sys.argv) > 4 else None
    out = json.load(open(outp, encoding='utf8')) if os.path.exists(outp) else {}
    for name in sorted(f for f in os.listdir(a_dir) if f.endswith('.mp3') and len(f) == 7):
        s = int(name[:3])
        if (want and s not in want) or str(s) in out or not os.path.exists(os.path.join(b_dir, name)):
            continue
        A, da, _ = feats(os.path.join(a_dir, name))
        B, db, _ = feats(os.path.join(b_dir, name))
        step = min(STEP, max(1, (len(A) - PIECE) // 5))
        starts = list(range(0, max(1, len(A) - PIECE), step))
        rows = []
        for st in starts:
            T = A[st:st + PIECE]
            if len(T) < PIECE // 2 or len(B) <= len(T):
                continue
            r = locate(B, T)
            i = int(np.argmax(r))
            rows.append([st * 10, i * 10, round(float(r[i]), 3)])
        found = [x for x in rows if x[2] >= FOUND]
        lags = np.array([x[1] - x[0] for x in found]) if found else np.array([0])
        spread = float(np.max(np.abs(lags - np.median(lags)))) if found else None
        ordered = all(found[k][1] > found[k - 1][1] for k in range(1, len(found)))
        share = len(found) / max(1, len(rows))
        verdict = 'same' if share >= 0.95 and spread is not None and spread <= 1500 and ordered else 'different' if share <= 0.1 else 'partly'
        out[str(s)] = {'durationA': round(da * 1000), 'durationB': round(db * 1000), 'pieces': len(rows), 'found': len(found), 'medianScore': round(float(np.median([x[2] for x in rows])), 3) if rows else None,
                       'lagMedianMs': int(np.median(lags)), 'lagSpreadMs': None if spread is None else int(spread), 'ordered': ordered, 'verdict': verdict, 'notFound': [x[0] for x in rows if x[2] < FOUND][:20]}
        print(s, out[str(s)]['verdict'], f"{len(found)}/{len(rows)}", out[str(s)]['lagSpreadMs'], flush=True)
        with open(outp, 'w', encoding='utf8') as f:
            json.dump(out, f)


if __name__ == '__main__':
    main()
