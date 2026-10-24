"""Canonical Tanzil Uthmani text (backend/data/quran/quran-uthmani.txt) -> romanized word lists for MMS forced alignment."""
import re, unicodedata
import uroman as ur
_u = ur.Uroman()
MAP = {'\u0671': '\u0627', '\u0670': '\u0627', '\u06E5': '\u0648', '\u06E6': '\u064A', '\u0640': ''}
DROP = re.compile('[\u06D6-\u06DC\u06DE-\u06E4\u06E7-\u06ED\u08F0-\u08FF]')  # pause/annotation marks, small high letters
def normalize(t):
    t = ''.join(MAP.get(c, c) for c in t)
    return DROP.sub('', t)
def romanize_word(w):
    r = _u.romanize_string(normalize(w)).lower()
    r = re.sub(r"[^a-z']", '', r)
    return r
def load_quran(path):
    q = {}
    for line in open(path, encoding='utf-8'):
        p = line.rstrip('\n').split('|')
        if len(p) == 3 and p[0].isdigit() and p[1].isdigit():
            q[(int(p[0]), int(p[1]))] = p[2]
    return q
if __name__ == '__main__':
    import sys
    q = load_quran(sys.argv[1])
    print(len(q))
    for k in [(1, 1), (1, 2), (112, 1), (18, 1), (36, 1)]:
        print(k, q[k], '->', [romanize_word(w) for w in q[k].split()])
