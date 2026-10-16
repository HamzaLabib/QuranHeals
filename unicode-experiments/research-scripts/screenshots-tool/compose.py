import sys
from PIL import Image, ImageDraw, ImageFont
raw, out, page = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4].split(',')
labels = {'qcf': 'QCF V1 (reference)', 'hafs': 'KFGQPC v18 (first prototype)', 'hafsPlus': 'A: KFGQPC enhanced', 'madina': 'B: QH Old Madina', 'madinaCalligraphic': 'Before: C (calligraphic)', 'madinaNatural': 'After: C2 (natural fitting)', 'amiri': 'Amiri Quran'}
ims = [Image.open(f'{raw}/p{int(page):03d}-{n}.png').convert('RGB') for n in names]
h = max(i.height for i in ims); w = sum(i.width for i in ims) + 20 * (len(ims) - 1)
canvas = Image.new('RGB', (w, h + 70), 'white'); d = ImageDraw.Draw(canvas)
try: f = ImageFont.truetype('arial.ttf', 34)
except Exception: f = None
x = 0
for n, im in zip(names, ims):
    canvas.paste(im, (x, 70)); d.text((x + 10, 15), labels.get(n, n), fill='black', font=f); x += im.width + 20
canvas.save(out)
print(out, canvas.size)
