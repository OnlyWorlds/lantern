"""Lantern's app icons from the OnlyWorlds globe (the Captain, h37 #3660: the logo for now; a
Lantern mark later is Seethe's). Run: python walk/icons.py art/owlogo.png public preview.png"""
import sys
from PIL import Image

src, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
BG = (16, 18, 24, 255)  # --lan-bg, the manifest's background_color
logo = Image.open(src).convert('RGBA')
logo = logo.crop(logo.getbbox())


def make(size, share):
    """A square of Lantern's ground, the globe centred at `share` of its width."""
    im = Image.new('RGBA', (size, size), BG)
    side = round(size * share)
    g = logo.resize((side, side), Image.LANCZOS)
    im.alpha_composite(g, ((size - side) // 2, (size - side) // 2))
    return im.convert('RGB')


# any: the globe large; maskable: inside the 80% safe circle (a launcher may cut to a circle).
sets = {
    'icon-192.png': make(192, 0.80),
    'icon-512.png': make(512, 0.80),
    'icon-180.png': make(180, 0.76),
    'icon-512-maskable.png': make(512, 0.70),
}
for name, im in sets.items():
    im.save(f'{out}/{name}', optimize=True)
    print(name, im.size)

# The first screen's mark: the globe alone, on no ground, at 3x its 64px place (Seethe h37 #3743:
# the old lantern glyph read as a bin).
mark = logo.resize((192, 192), Image.LANCZOS)
mark.save(f'{out}/ow-globe.png', optimize=True)
print('ow-globe.png', mark.size)

# A preview: each icon, and the maskable one cut to a circle as Android may show it.
m = sets['icon-512-maskable.png'].convert('RGBA')
mask = Image.new('L', (512, 512), 0)
from PIL import ImageDraw
ImageDraw.Draw(mask).ellipse((0, 0, 511, 511), fill=255)
circ = Image.new('RGBA', (512, 512), (128, 128, 128, 255))
circ.paste(m, (0, 0), mask)
sheet = Image.new('RGBA', (1536, 512), (128, 128, 128, 255))
sheet.paste(sets['icon-512.png'], (0, 0))
sheet.paste(m, (512, 0))
sheet.alpha_composite(circ, (1024, 0))
sheet.save(preview)
