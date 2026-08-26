"""Generate the app icons: a three-spoke steering wheel on the brand navy.

Drawn at 8x and downsampled, so the curves stay clean at 32 px.
Every icon is a full opaque square — iOS and Android apply their own
mask, and a pre-rounded icon with transparent corners renders badly
as an apple-touch-icon.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import math
from PIL import Image, ImageDraw

OUT = _os.path.join(_ROOT, "icons")
_os.makedirs(OUT, exist_ok=True)

SS = 8                     # supersampling factor
TOP = (31, 122, 224)       # brand blue
BOT = (8, 30, 58)          # brand navy
WHITE = (255, 255, 255, 255)


def background(px):
    """Smooth diagonal blue -> navy gradient (bilinear upscale of a 2x2)."""
    mid = tuple(round((TOP[c] + BOT[c]) / 2) for c in range(3))
    g = Image.new("RGB", (2, 2))
    g.putpixel((0, 0), TOP)     # top-left
    g.putpixel((1, 0), mid)
    g.putpixel((0, 1), mid)
    g.putpixel((1, 1), BOT)     # bottom-right
    return g.resize((px, px), Image.BICUBIC)


def wheel(px, scale):
    """Steering wheel centred on a transparent square of `px`, outer
    diameter = scale * px."""
    layer = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = px / 2
    R = px * scale / 2               # outer radius
    ring = px * scale * 0.125        # ring thickness
    hub = px * scale * 0.165         # hub radius
    spoke = px * scale * 0.105       # spoke thickness

    inner = R - ring / 2             # centreline of the ring

    # spokes first, so the ring and hub sit cleanly on top
    for deg in (180, 0, 90):         # left, right, bottom (classic 3-spoke)
        a = math.radians(deg)
        x2, y2 = c + math.cos(a) * inner, c + math.sin(a) * inner
        d.line([c, c, x2, y2], fill=WHITE, width=round(spoke))

    d.ellipse([c - inner, c - inner, c + inner, c + inner],
              outline=WHITE, width=round(ring))
    d.ellipse([c - hub, c - hub, c + hub, c + hub], fill=WHITE)
    return layer


def build(size, scale, name):
    px = size * SS
    img = background(px).convert("RGBA")
    img.alpha_composite(wheel(px, scale))
    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    img.save(_os.path.join(OUT, name), optimize=True)
    print("wrote icons/" + name, img.size)


# "any" icons and the iOS home-screen icon: wheel fills most of the tile
build(192, 0.70, "icon-192.png")
build(512, 0.70, "icon-512.png")
build(180, 0.70, "apple-touch-icon.png")
build(32, 0.78, "favicon-32.png")

# maskable: keep the mark inside the 80% safe zone so no mask can clip it
build(512, 0.50, "maskable-512.png")
