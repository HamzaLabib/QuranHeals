"""Provenance segments: consecutive matched pieces (score >= 0.8, strict) of one MP3Quran file that sit at a consistent
position in ONE collection recording (offset change <= 6 s + 6 % of elapsed time: tape-speed differences between
transfers). Ar-Rahman's refrain and Rifaat's repeated phrases make isolated matches unreliable, so only runs of >= 3
pieces count. Output: per file, the segments (file time -> collection file and time) and the time they cover."""
import json, sys
m = json.load(open(sys.argv[1], encoding='utf8')); out = {}
for s in sorted(m, key=int):
    ps = [p for p in m[s]['pieces'] if p['score'] >= 0.8]
    segs = []
    for p in ps:
        o = p['at'] - p['t']
        for g in segs:
            q = g[-1]
            if q['file'] == p['file'] and 0 < p['t'] - q['t'] <= 200 and abs((q['at'] - q['t']) - o) <= 6 + 0.06 * (p['t'] - q['t']): g.append(p); break
        else: segs.append([p])
    segs = [g for g in segs if len(g) >= 3]
    segs.sort(key=lambda g: g[0]['t'])
    cov = sum(g[-1]['t'] + 20 - g[0]['t'] for g in segs)
    out[s] = {'durationS': m[s]['durationS'], 'coveredS': cov, 'segments': [{'from': g[0]['t'], 'to': g[-1]['t'] + 20, 'file': g[0]['file'], 'at': g[0]['at'], 'atEnd': g[-1]['at'] + 20, 'pieces': len(g), 'speed': round((g[-1]['at'] - g[0]['at']) / max(1, g[-1]['t'] - g[0]['t']), 3)} for g in segs]}
    print(f"{s:>3} {m[s]['durationS']:6.0f}s covered {cov:5.0f}s ({cov / m[s]['durationS']:.0%})")
    for g in out[s]['segments']: print(f"      {g['from']:6.0f}-{g['to']:6.0f}s  <- {g['file'][:62]} @ {g['at']:.0f}-{g['atEnd']:.0f}s  ({g['pieces']} pieces, speed {g['speed']})")
json.dump(out, open(sys.argv[2], 'w'), indent=1)
