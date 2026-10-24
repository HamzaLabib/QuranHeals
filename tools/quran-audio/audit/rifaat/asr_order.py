"""From the Whisper turbo windows of one file: which ayahs are recognisably recited, when, and in what order.
A window counts only if its transcript (Whisper hallucinations removed) shares >= 45 % of its letter trigrams with
one ayah AND that ayah beats the best ayah anywhere else in the Quran (so common phrases do not count)."""
import json, re, sys
DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
HALLU = ['موسيقى', 'اشتركوا في القناة', 'ترجمة', 'نانسي قنقر', 'شكرا للمشاهدة', 'المترجم']
def norm(t):
    t = DIAC.sub('', t)
    for a, b in (('ٱ', 'ا'), ('أ', 'ا'), ('إ', 'ا'), ('آ', 'ا'), ('ى', 'ي'), ('ة', 'ه'), ('ؤ', 'و'), ('ئ', 'ي')): t = t.replace(a, b)
    return re.sub('[^ء-ي]', '', t)
tri = lambda s: {s[i:i + 3] for i in range(len(s) - 2)}
Q = {}
for line in open(sys.argv[1], encoding='utf8'):
    p = line.rstrip('\n').split('|')
    if len(p) == 3 and p[0].isdigit(): Q[(int(p[0]), int(p[1]))] = tri(norm(p[2]))
out = {}
for f in sys.argv[3:]:
    s = int(re.search(r'_(\d+)\.json', f).group(1))
    seq = []
    for w in json.load(open(f, encoding='utf8'))['windows']:
        text = w['text']
        for h in HALLU: text = text.replace(h, ' ')
        t = tri(norm(text))
        if len(t) < 10: continue
        scored = sorted(((len(t & a) / len(t), k) for k, a in Q.items() if a), reverse=True)[:5]
        best, key = scored[0]
        # the window's best match must be unambiguous (another ayah elsewhere scoring nearly as well is not evidence)
        rival = next((sc for sc, k in scored[1:] if k[0] != key[0] or abs(k[1] - key[1]) > 2), 0)
        if best >= 0.45 and best - rival >= 0.08:
            seq.append([w['from_s'], key[0], key[1], round(best, 2)])
    same = [x for x in seq if x[1] == s]
    other = sorted({x[1] for x in seq if x[1] != s})
    n = max(k[1] for k in Q if k[0] == s)
    out[s] = {'windows': seq, 'ayahsRecognised': sorted({x[2] for x in same}), 'ayahCount': n, 'otherSurahs': other,
              'inOrder': all(same[i][2] >= same[i - 1][2] - 1 for i in range(1, len(same)))}
    print(f"{s:3d}: {len(same)} windows in surah {s} -> ayahs {out[s]['ayahsRecognised']} of {n}; in order {out[s]['inOrder']}; other surahs {other}; seq " + ' '.join(f"{x[0]}s:{x[1]}:{x[2]}" for x in seq)[:400])
json.dump(out, open(sys.argv[2], 'w'), indent=1)
