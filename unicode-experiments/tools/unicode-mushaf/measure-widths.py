#!/usr/bin/env python3
"""Measures every word group of the verified Tanzil text in a Quran font with
HarfBuzz (the shaper Android and Chrome use), for the Unicode Mushaf prototype.

    python tools/unicode-mushaf/measure-widths.py <font.ttf> <outTs> --name NAME
        [--display kfgqpc|dk] [--elongation N] [--fallback <font.ttf> --fallback-chars 06EB,06E3]

A word group is one Tanzil word token plus the standalone pause marks that
follow it, joined by their original spaces — exactly the text the reader
draws as one unit (mobile/src/mushaf/unicode/words.ts, wordGroups). Each
group is written as `width` or `width:index[:first[:next]]`, comma-separated
per verse in reading order: the shaped advance in thousandths of an em, and
where the group may be elongated with kashida — `index` is the character
offset at which tatweels (U+0640) may be inserted, `first` the width the first
one adds there (it may also switch the letter's joining form) and `next` each
further one (measured in context; either is left out when it is the tatweel's
own advance, FONT_METRICS.tatweelEm). A group drawn in the fallback font ends
in `f` (its width in the fallback font's em; never elongated). With
--elongation N (a font that elongates the letter before a run of tatweels and
draws the tatweels as nothing: QH Old Madina, build-madina-font.py), a group
whose kashida point does so is written `width:index~runs`: its extra width
with n = 1..N tatweels there, as '.'-separated base-36 runs "<step>x<count>"
(trailing zeros left out); and a group with narrower forms (the font's
stylistic set ss13) ends in `!` and its narrow width. The Basmala tokens
Tanzil prefixes to 112 first ayahs are measured as groups too (the reader
draws them as the Basmala line).

--display kfgqpc: KFGQPC's fonts (v18 and later) follow KFGQPC's own encoding,
in which the two sukun signs swap code points with Tanzil's: Tanzil's U+0652
(the Madina Mushaf's head-of-khah sukun) is KFGQPC's U+06E1, and Tanzil's
U+06DF (the round zero of a silent letter) is KFGQPC's U+0652 — verified on
every occurrence against KFGQPC's own text (docs/unicode-mushaf/).
--display dk: DigitalKhatt fonts draw a standalone pause sign (U+06D6-U+06DC,
a mark there) over the word it follows only when attached to it: the space
before it is not drawn. Both are the same functions as
mobile/src/mushaf/unicode/encoding.ts; widths are measured on the drawn text.

--fallback: groups containing any of --fallback-chars (signs the primary
font cannot draw) are measured in, and drawn with, the fallback font.

Kashida points (conservative, one per group, its last legal connection):
after a dual-joining letter and all its marks, before a letter that joins
to it (dual- or right-joining); never inside lam-alef, never next to an
existing tatweel (Tanzil's carriers of dagger alef and hamza), never before
hamza, a small waw/yeh or a space. Each point is checked by shaping the
group with 1, 2 and 3 tatweels: no .notdef, every tatweel widens it, and
from the second on each adds the same width.

Audits the font against the text, failing on any problem: every character
mapped, no .notdef glyph, and every combining mark inside a word mapped to a
GDEF mark glyph. Requires uharfbuzz and fontTools.
"""
import argparse
import hashlib
import io
import os
import re
import sqlite3
import sys
import unicodedata

import uharfbuzz as hb
from fontTools.ttLib import TTFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PAUSE = re.compile('^[ۖ-ۜ۞۩]+$')
TATWEEL = 'ـ'
# Arabic joining types (Unicode ArabicShaping.txt) for the letters of the Tanzil text.
DUAL = set('بتثجحخسشصضطظعغفقكلمنهيئىٮڡٯ')
RIGHT = set('اأإآٱدذرزوؤة')
ALEFS = set('اأإآٱ')
KFGQPC_SWAP = {'ْ': 'ۡ', '۟': 'ْ'}
DK_PAUSE = re.compile(' (?=[ۖ-ۜ]+(?: |$))')
DISPLAYS = {
    'kfgqpc': lambda s: ''.join(KFGQPC_SWAP.get(c, c) for c in s),
    'dk': lambda s: DK_PAUSE.sub('', s),
}
B36 = '0123456789abcdefghijklmnopqrstuvwxyz'


def b36(n):
    sign, n, out = ('-' if n < 0 else ''), abs(n), ''
    while True:
        n, r = divmod(n, 36)
        out = B36[r] + out
        if n == 0:
            return sign + out


def groups_of(text):
    groups = []
    for token in text.split(' '):
        if PAUSE.match(token) and groups:
            groups[-1] += ' ' + token
        else:
            groups.append(token)
    return groups


def is_mark(ch):
    return unicodedata.category(ch) == 'Mn'


def kashida_point(group):
    """The character offset after which tatweels may go, or -1 (the last legal connection in the group's first word)."""
    word = group.split(' ')[0]
    best = -1
    i = 0
    while i < len(word):
        x = word[i]
        j = i + 1
        while j < len(word) and is_mark(word[j]):
            j += 1
        if j < len(word) and x in DUAL:
            y = word[j]
            if (y in DUAL or y in RIGHT) and not (x == 'ل' and y in ALEFS) and y != TATWEEL:
                best = j
        i = j
    return best


class Shaper:
    def __init__(self, path):
        self.raw = open(path, 'rb').read()
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.tt = TTFont(io.BytesIO(self.raw))
        self.upm = self.tt['head'].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.font = hb.Font(hb.Face(self.raw))

    def shape(self, text, features=None):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.font, buf, features or {})
        return buf

    def advance(self, text, features=None):
        buf = self.shape(text, features)
        if any(g.codepoint == 0 for g in buf.glyph_infos):
            raise SystemExit(f'.notdef in «{text}»')
        return sum(p.x_advance for p in buf.glyph_positions)

    def unattached_marks(self, text):
        """Combining marks inside a word that the font maps to a non-mark glyph (GDEF class other than 3). KFGQPC v18
        maps U+06DF, U+06EB and U+06E3 to a 1,442-unit placeholder circle, class 1; HarfBuzz merges it into the base
        letter's cluster, so it cannot be told from the shaped clusters. Standalone pause and sajdah signs (their own
        token after a space) may be spacing glyphs by design."""
        table = self.tt['GDEF'].table if 'GDEF' in self.tt else None
        gdef = table.GlyphClassDef.classDefs if table is not None and table.GlyphClassDef else {}
        problems = []
        for ch in set(''.join(token for token in text.split(' ') if not PAUSE.match(token))):
            if is_mark(ch) and (self.cmap.get(ord(ch)) is None or gdef.get(self.cmap.get(ord(ch))) != 3):
                problems.append(f'U+{ord(ch):04X}')
        return sorted(problems)

    def em(self, units):
        return round(units * 1000 / self.upm)

    def metrics(self):
        hhea = self.tt['hhea']
        return f"{{ sha256: '{self.sha}', unitsPerEm: {self.upm}, ascent: {hhea.ascent}, descent: {-hhea.descent}, spaceEm: {self.em(self.advance(' ')) / 1000}, tatweelEm: {self.em(self.advance(TATWEEL)) / 1000} }}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('font')
    parser.add_argument('out')
    parser.add_argument('--name', required=True)
    parser.add_argument('--display', choices=sorted(DISPLAYS))
    parser.add_argument('--elongation', type=int, default=0)
    parser.add_argument('--fallback')
    parser.add_argument('--fallback-chars', default='')
    args = parser.parse_args()

    primary = Shaper(args.font)
    fallback = Shaper(args.fallback) if args.fallback else None
    fallback_chars = {chr(int(c, 16)) for c in args.fallback_chars.split(',') if c}
    drawn = DISPLAYS.get(args.display, lambda s: s)

    db = sqlite3.connect(os.path.join(REPO, 'mobile/assets/quran/quran.sqlite'))
    rows = db.execute('SELECT verse_key, arabic_text FROM verses ORDER BY surah, ayah').fetchall()
    if len(rows) != 6236:
        raise SystemExit(f'{len(rows)} verses')
    plain = primary.em(primary.advance(TATWEEL))
    lines, unusable, unattached, fallbacks = [], [], [], []
    groups_total = kashidas = elongated = 0
    for key, text in rows:
        cells = []
        for g in groups_of(text):
            if fallback and fallback_chars & set(g):
                if fallback.unattached_marks(g):
                    raise SystemExit(f'{key} «{g}»: the fallback font cannot attach {fallback.unattached_marks(g)}')
                cells.append(f'{fallback.em(fallback.advance(g))}f')
                fallbacks.append(f'{key} «{g}»')
                continue
            d = drawn(g)
            for ch in d:
                if ch != ' ' and ord(ch) not in primary.cmap:
                    raise SystemExit(f'{key}: U+{ord(ch):04X} not in the font')
            bad = primary.unattached_marks(d)
            if bad:
                unattached.append(f'{key} «{g}» {bad}')
            base = primary.advance(d)
            w = primary.em(base)
            cell = str(w)
            k = kashida_point(g)  # within the first word, where both displays leave offsets unchanged
            calligraphic = False
            if k > 0 and args.elongation:
                # A font that elongates the letter before a run of tatweels (QH Old Madina): the tatweels draw nothing,
                # and the group's width at n = 1..N tatweels is recorded as '~' increments.
                tatweel_gid = primary.tt.getGlyphID(primary.cmap[0x0640])
                shaped = primary.shape(d[:k] + TATWEEL + d[k:])
                calligraphic = all(info.codepoint != tatweel_gid for info in shaped.glyph_infos)
            if calligraphic:
                widths = [base] + [primary.advance(d[:k] + TATWEEL * n + d[k:]) for n in range(1, args.elongation + 1)]
                steps = [primary.em(widths[n]) - primary.em(widths[n - 1]) for n in range(1, len(widths))]
                while steps and steps[-1] == 0:
                    steps.pop()
                cell = f'{w}:{k}'
                if steps:
                    elongated += 1
                    # Run-length: consecutive steps within 2 thousandths of an em of the run's first are one run
                    # "<step>x<count>" (their mean; the error never exceeds 2/1000 em per level).
                    runs = []
                    for x in steps:
                        if runs and abs(x - runs[-1][0]) <= 2:
                            runs[-1][1].append(x)
                        else:
                            runs.append([x, [x]])
                    cell += '~' + '.'.join(b36(round(sum(v) / len(v))) + (f'x{b36(len(v))}' if len(v) > 1 else '') for _, v in runs)
            elif k > 0:
                one, two, three = (primary.advance(d[:k] + TATWEEL * n + d[k:]) - base for n in (1, 2, 3))
                if one <= 0 or two - one <= 0 or abs((three - two) - (two - one)) > 2:
                    unusable.append(f'{key} «{g}» +1:{one} +2:{two} +3:{three}')
                else:
                    kashidas += 1
                    first, nxt = primary.em(one), primary.em(two - one)
                    # The usual case (both gains are the tatweel's own advance) is written short.
                    cell = f'{w}:{k}' if first == plain and nxt == plain else f'{w}:{k}:{first}' if nxt == plain else f'{w}:{k}:{first}:{nxt}'
            if args.elongation:
                # The font's narrower letter forms (stylistic set ss13), for lines wider than the measure.
                narrow = primary.em(primary.advance(d, {'ss13': True}))
                if narrow < w:
                    cell += f'!{narrow}'
            cells.append(cell)
        groups_total += len(cells)
        lines.append(','.join(cells))
    if unattached:
        for u in unattached[:20]:
            print('  unattached mark:', u)
        raise SystemExit(f'{len(unattached)} groups have marks the font cannot attach: use --display or --fallback')

    name = args.name
    names = primary.tt['name']
    notes = ''
    if args.display:
        notes += f"\n// Drawn with the display encoding '{args.display}' (mobile/src/mushaf/unicode/encoding.ts)."
    if args.elongation:
        notes += f"\n// '~' runs: extra width with 1..{args.elongation} tatweels at the kashida point, which this font draws as the letter's own longer\n// form (calligraphic elongation); {elongated} groups elongate so. '!': width with the font's narrow forms (ss13)."
    if fallback:
        fn = fallback.tt['name']
        notes += f"\n// Groups ending in \"f\" ({len(fallbacks)}: {'; '.join(fallbacks)}) are drawn in {fn.getDebugName(4)} ({fn.getDebugName(5)}),\n// SHA-256 {fallback.sha}: the primary font cannot draw their signs ({', '.join(sorted(f'U+{ord(c):04X}' for c in fallback_chars))})."
    body = f'''// GENERATED by tools/unicode-mushaf/measure-widths.py — do not edit.
// HarfBuzz (uharfbuzz {hb.__version__}) advance widths of every word group (a Tanzil word and the pause marks after it) of the
// verified Tanzil text in {names.getDebugName(4)} ({names.getDebugName(5)}), SHA-256 {primary.sha}.{notes}
// Measured on the Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, CC BY 3.0 — used
// verbatim, unchanged (https://tanzil.net); full notice: mobile/assets/quran/TANZIL-NOTICE.txt. No Quran text is stored here.
// Per verse in reading order (verse index 0 = 1:1), comma-separated groups: "width" or "width:index[:first[:next]]" —
// the advance in thousandths of an em, the character offset where kashida tatweels may be inserted, the width the first
// adds and each further one adds, left out when equal to tatweelEm (tools/unicode-mushaf/measure-widths.py documents
// the rules). Development builds only.

export const {name}_FONT_METRICS = {primary.metrics()} as const;
{f"export const {name}_FALLBACK_METRICS = {fallback.metrics()} as const;" if fallback else ''}
export const {name}_DISPLAY_ENCODING = {repr(args.display) if args.display else 'null'};

export const {name}_GROUP_WIDTHS: readonly string[] = [
{chr(10).join('"' + l + '",' for l in lines)}
];
'''
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    for u in unusable[:5]:
        print('  kashida point refused:', u)
    print(f'kashida points: {kashidas} of {groups_total} groups ({len(unusable)} refused by the shaping check); {elongated} elongate; {len(fallbacks)} fallback groups')
    print(f'{args.out}: {groups_total} groups, {len(body) // 1024} KB, upm {primary.upm}')


if __name__ == '__main__':
    sys.exit(main())
