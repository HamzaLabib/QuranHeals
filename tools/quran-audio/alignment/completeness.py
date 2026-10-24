"""Completeness evidence from forced alignments (align_mms.py, star config) of whole-surah files.
For each ayah: aligned length per Arabic letter and mean character probability. An ayah missing from the audio has no
audio to occupy, so CTC squeezes it into a few frames: very few ms per letter, low score. Reports, per file, the ayahs
that look absent ("collapsed": < 25 ms/letter, or < 40 ms/letter with score < 0.25), runs of them, the audio before the
first ayah and after the last, and the share of the file the ayahs cover.
usage: python -I completeness.py <quran-uthmani.txt> <align dir> <out.json>
"""
import json, os, re, sys

LETTER = re.compile('[ء-يٱ]')
q = {}
for line in open(sys.argv[1], encoding='utf-8'):
    p = line.rstrip('\n').split('|')
    if len(p) == 3 and p[0].isdigit():
        q[(int(p[0]), int(p[1]))] = len(LETTER.findall(p[2]))

out = {}
for f in sorted(os.listdir(sys.argv[2])):
    if not f.endswith('.json'):
        continue
    a = json.load(open(os.path.join(sys.argv[2], f), encoding='utf-8'))
    surah = a['surah']
    text_surah = surah
    m = re.search(r'as(\d+)', f)
    if m:
        text_surah = int(m.group(1))
    rows = []
    for x in a['ayahs']:
        letters = q.get((text_surah, x['ayah']), 1)
        ms = x['end_ms'] - x['start_ms']
        rows.append({'ayah': x['ayah'], 'ms_per_letter': round(ms / letters, 1), 'score': x['score'], 'start': x['start_ms'], 'end': x['end_ms']})
    collapsed = [r['ayah'] for r in rows if r['ms_per_letter'] < 25 or (r['ms_per_letter'] < 40 and r['score'] < 0.25)]
    runs, run = [], []
    for k in collapsed:
        if run and k == run[-1] + 1:
            run.append(k)
        else:
            if run:
                runs.append(run)
            run = [k]
    if run:
        runs.append(run)
    mpl = sorted(r['ms_per_letter'] for r in rows)
    scores = sorted(r['score'] for r in rows)
    first, last = rows[0], rows[-1]
    covered = sum(r['end'] - r['start'] for r in rows)
    out[f[:-5]] = {
        'surah': surah, 'ayahs': len(rows), 'duration_s': round(a['duration_ms'] / 1000),
        'median_ms_per_letter': mpl[len(mpl) // 2], 'median_score': scores[len(scores) // 2], 'min_score': scores[0],
        'collapsed': len(collapsed), 'collapsed_runs': [f'{r[0]}-{r[-1]}' if len(r) > 1 else str(r[0]) for r in runs],
        'before_first_ayah_s': round(first['start'] / 1000, 1), 'after_last_ayah_s': round((a['duration_ms'] - last['end']) / 1000, 1),
        'ayah_coverage_pct': round(100 * covered / a['duration_ms']),
        'missing_in_alignment': a.get('missing', []),
    }
json.dump(out, open(sys.argv[3], 'w', encoding='utf-8'), indent=1)
for k, v in out.items():
    print(f"{k:28} {v['ayahs']:3} ayahs {v['duration_s']:5}s  med {v['median_ms_per_letter']:6} ms/letter  score med {v['median_score']:.2f} min {v['min_score']:.2f}  collapsed {v['collapsed']:3} {','.join(v['collapsed_runs'][:6])}  pre {v['before_first_ayah_s']}s post {v['after_last_ayah_s']}s cover {v['ayah_coverage_pct']}%")
