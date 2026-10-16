import sys
from PIL import Image, ImageDraw, ImageFont
raw, out, page, names, y0, y1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4].split(','), int(sys.argv[5]), int(sys.argv[6])
labels = {'qcf': 'QCF V1', 'hafs': 'KFGQPC v18', 'hafsPlus': 'A: KFGQPC enhanced', 'madina': 'B: QH Old Madina', 'madinaCalligraphic': 'C: QH Old Madina calligraphic', 'amiri': 'Amiri'}
crops = [Image.open(f'{raw}/p{page:03d}-{n}.png').convert('RGB').crop((0, y0, 995, y1)) for n in names]
f = ImageFont.truetype('arial.ttf', 26)
c = Image.new('RGB', (995, sum(i.height + 36 for i in crops)), 'white'); d = ImageDraw.Draw(c); y = 0
for n, im in zip(names, crops):
    d.text((6, y + 4), labels[n], fill='red', font=f); c.paste(im, (0, y + 36)); y += im.height + 36
c.save(out); print(out, c.size)
