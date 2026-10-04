"""Render the Arena logo (same geometry as logo.svg) to PNG at the sizes we publish.

    python web/make-logo.py

Writes web/logo.png (512), web/logo-110.png (Marketplace minimum) and web/favicon.png (64).
Drawn with Pillow at 8x and downsampled, so no SVG renderer is needed.
"""
import math
import os
from PIL import Image, ImageDraw

TEAL, WHITE, AMBER = (15, 118, 110, 255), (255, 255, 255, 255), (251, 191, 36, 255)
HERE = os.path.dirname(os.path.abspath(__file__))


def render(size):
    s = size * 8 / 110.0                      # 8x supersample; all coordinates are in the 110-unit viewBox
    px = lambda v: v * s
    img = Image.new('RGBA', (size * 8, size * 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, px(110) - 1, px(110) - 1], radius=px(24), fill=TEAL)

    # Open ring: centre (55,55), radius 38, stroke 7, gap of about 56 degrees at the top.
    cx, cy, r, w = 55, 55, 38, 7
    gap = math.degrees(math.asin(17.8 / 38))  # half-gap, from the SVG end points (72.8, 21.4) / (37.2, 21.4)
    start, end = -90 + gap, 270 - gap         # Pillow angles: 0 = east, clockwise
    d.arc([px(cx - r - w / 2), px(cy - r - w / 2), px(cx + r + w / 2), px(cy + r + w / 2)], start, end, fill=WHITE, width=int(round(px(w))))
    for a in (start, end):                    # round caps
        ex, ey = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        d.ellipse([px(ex - w / 2), px(ey - w / 2), px(ex + w / 2), px(ey + w / 2)], fill=WHITE)

    d.ellipse([px(55 - 8), px(19 - 8), px(55 + 8), px(19 + 8)], fill=AMBER)
    for x, y, h in ((31, 56, 24), (48, 42, 38), (65, 64, 16)):
        d.rounded_rectangle([px(x), px(y), px(x + 14), px(y + h)], radius=px(2.5), fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


for name, size in (('logo.png', 512), ('logo-110.png', 110), ('favicon.png', 64)):
    render(size).save(os.path.join(HERE, name), optimize=True)
    print(name, size)
