import sys
from fontTools.ttLib import TTFont
for p in sys.argv[1:]:
    f = TTFont(p)
    n = f['name']
    print('==', p.split('/')[-1], 'tables:', sorted(f.keys()))
    for nid in (0,1,3,4,5,7,8,9,11,13,14):
        r = n.getName(nid,3,1,0x409) or n.getName(nid,1,0,0)
        if r: print(f'  {nid}:', str(r)[:300].replace('\n',' '))
    print('  upm', f['head'].unitsPerEm, 'hhea', f['hhea'].ascent, f['hhea'].descent, 'typo', f['OS/2'].sTypoAscender, f['OS/2'].sTypoDescender, 'win', f['OS/2'].usWinAscent, f['OS/2'].usWinDescent, 'fsType', f['OS/2'].fsType, 'glyphs', f['maxp'].numGlyphs)
