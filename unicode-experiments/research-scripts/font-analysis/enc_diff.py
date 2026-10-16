import json, sqlite3, collections, difflib, re
d = json.load(open('kfgqpc-hafs-v18.json', encoding='utf-8'))
k = {(int(x['sora']), int(x['aya_no'])): x['aya_text'] for x in d}
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]  # the repository root
db = sqlite3.connect(REPO / 'mobile/assets/quran/quran.sqlite')
t = {(s, a): x for s, a, x in db.execute('select surah,ayah,arabic_text from verses')}
def clean_k(s):
    s = s.replace('\u00a0', ' ')
    s = re.sub(r'[\u0660-\u0669]+', '', s)  # inline ayah number
    s = s.replace('\u06de', '')
    return re.sub(r' +', ' ', s).strip()
ops = collections.Counter(); ex = collections.defaultdict(list); same = 0
for key in sorted(t):
    a, b = t[key], clean_k(k[key])
    if key[1] == 1 and key[0] not in (1, 9):
        a = ' '.join(a.split(' ')[4:])
    if a == b: same += 1; continue
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal': continue
        kk = (tag, ' '.join(f'{ord(c):04X}' for c in a[i1:i2]), ' '.join(f'{ord(c):04X}' for c in b[j1:j2]))
        ops[kk] += 1
        if len(ex[kk]) < 2: ex[kk].append(f'{key[0]}:{key[1]}')
print('identical', same, 'of', len(t))
for kk, n in ops.most_common(45): print(n, kk, ex[kk])
print('distinct ops', len(ops))
