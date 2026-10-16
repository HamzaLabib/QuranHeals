import json, sqlite3, collections, difflib, re
d = json.load(open('kfgqpc-hafs-v18.json', encoding='utf-8'))
k = {(int(x['sora']), int(x['aya_no'])): x['aya_text'] for x in d}
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]  # the repository root
db = sqlite3.connect(REPO / 'mobile/assets/quran/quran.sqlite')
t = {(s, a): x for s, a, x in db.execute('select surah,ayah,arabic_text from verses')}
# Compare per word, on the consonant skeleton: words whose letters match are aligned mark by mark in order.
LET = re.compile(r'[\u0621-\u063A\u0641-\u064A\u0671]')
def skel(w): return ''.join(LET.findall(w)).replace('\u0649', '\u064A')
partner = {'\u0652': collections.Counter(), '\u06DF': collections.Counter()}
words_cmp = unaligned = 0
for key in t:
    tw = t[key].split(' ')
    if key[1] == 1 and key[0] not in (1, 9): tw = tw[4:]
    kw = re.sub(r'[\u0660-\u0669\u06DE]', '', k[key].replace('\u00a0', ' ')).split()
    tw = [w for w in tw if LET.search(w)]; kw = [w for w in kw if LET.search(w)]
    sm = difflib.SequenceMatcher(None, [skel(w) for w in tw], [skel(w) for w in kw], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal': unaligned += i2 - i1; continue
        for a, b in zip(tw[i1:i2], kw[j1:j2]):
            words_cmp += 1
            # Walk letter by letter; compare each letter's mark set.
            def clusters(w):
                out = []; 
                for ch in w:
                    if LET.match(ch) or ch in '\u0640': out.append([ch, ''])
                    elif out: out[-1][1] += ch
                return out
            ca, cb = clusters(a), clusters(b)
            ca = [c for c in ca if c[0] != '\u0640']; cb = [c for c in cb if c[0] != '\u0640']
            if len(ca) != len(cb): continue
            for (la, ma), (lb, mb) in zip(ca, cb):
                for m in ('\u0652', '\u06DF'):
                    if m in ma:
                        got = '\u06E1' if '\u06E1' in mb else '\u0652' if '\u0652' in mb else 'none:' + ' '.join(f'{ord(c):04X}' for c in mb)
                        partner[m][got] += 1
print('words compared', words_cmp, 'unaligned words', unaligned)
for m, c in partner.items(): print(f'Tanzil U+{ord(m):04X} ->', dict(c.most_common(8)))
