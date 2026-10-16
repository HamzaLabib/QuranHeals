import sys, io, collections
import uharfbuzz as hb
from fontTools.ttLib import TTFont
SRC = sys.argv[1]
fonts = sys.argv[2:]
verses = []
for line in open(SRC, encoding='utf-8'):
    parts = line.rstrip('\n').split('|', 2)
    if len(parts) == 3 and parts[0].isdigit(): verses.append((int(parts[0]), int(parts[1]), parts[2]))
print('verses', len(verses))
for path in fonts:
    tt = TTFont(path)
    cmap = tt.getBestCmap()
    buf = io.BytesIO(); tt.flavor = None; tt.save(buf)
    face = hb.Face(buf.getvalue()); font = hb.Font(face)
    dotted = cmap.get(0x25CC)
    dotted_gid = tt.getGlyphID(dotted) if dotted else None
    missing_chars = collections.Counter()
    notdef_verses, dotted_verses = [], []
    for s, a, t in verses:
        for ch in set(t):
            if ord(ch) not in cmap and ch not in ' ': missing_chars[f'U+{ord(ch):04X}'] += 1
        b = hb.Buffer(); b.add_str(t); b.guess_segment_properties()
        hb.shape(font, b, {})
        gids = [g.codepoint for g in b.glyph_infos]
        if 0 in gids: notdef_verses.append(f'{s}:{a}')
        if dotted_gid is not None and dotted_gid in gids and '◌' not in t: dotted_verses.append(f'{s}:{a}')
    print('==', path.split('/')[-1])
    print('  chars missing from cmap:', dict(missing_chars) or 'none')
    print('  verses with .notdef:', len(notdef_verses), notdef_verses[:8])
    print('  verses with inserted dotted circle:', len(dotted_verses), dotted_verses[:8], '(font has no U+25CC)' if dotted_gid is None else '')
