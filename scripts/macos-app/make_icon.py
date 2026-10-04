"""Draw the City Map app icon → scripts/macos-app/AppIcon.png (1024×1024).

PURPOSE   One-off generator for the Dock / Finder icon. The PNG it writes is committed,
          so build-app.sh needs only macOS's own `sips` + `iconutil` — Pillow is needed
          only when you want to redraw the icon.
FLOW      main() → draw_icon() → PNG
STYLE     The map's own dark palette (frontend CSS): #0d1117 / #161b22 background,
          #30363d street grid, #58a6ff river, #f0b429 location pin.

Run:  python3 scripts/macos-app/make_icon.py      (needs Pillow: pip3 install pillow)
"""

from pathlib import Path  # OO file paths, cross-platform

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).with_name("AppIcon.png")
SIZE = 1024
# Apple's macOS icon grid: the rounded tile is 824 px inside a 1024 canvas, corner ≈ 185.
TILE, INSET, RADIUS = 824, 100, 185

BG_TOP, BG_BOTTOM = (22, 27, 34), (13, 17, 23)  # #161b22 → #0d1117
GRID = (48, 54, 61)  # #30363d
AVENUE = (72, 79, 88)
RIVER = (88, 166, 255)  # #58a6ff
PIN = (240, 180, 41)  # #f0b429
PIN_HOLE = (13, 17, 23)


# O(p) time, O(p) space — p = pixels in the 1024×1024 canvas (fixed size)
def draw_icon() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Background tile: vertical gradient clipped to the rounded square.
    tile = Image.new("RGBA", (TILE, TILE))
    tdraw = ImageDraw.Draw(tile)
    # O(s) time, O(1) space — s = TILE rows
    for y in range(TILE):
        t = y / (TILE - 1)
        # O(1) time, O(1) space — c = 3 colour channels
        tdraw.line([(0, y), (TILE, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))

    # Street grid — a city block pattern, with two wider avenues.
    step = TILE // 7
    # O(k) time, O(1) space — k = 6 grid lines per axis
    for i in range(1, 7):
        w = 14 if i in (2, 5) else 6
        colour = AVENUE if i in (2, 5) else GRID
        tdraw.line([(i * step, 0), (i * step, TILE)], fill=colour, width=w)
        tdraw.line([(0, i * step), (TILE, i * step)], fill=colour, width=w)

    # River: a smooth curve across the lower-left — sampled points, drawn thick.
    # O(w) time, O(w) space — w = TILE / 8 sample points
    pts = [(x, int(TILE * 0.78 - 140 * ((x / TILE) - 0.15) ** 2 * 4)) for x in range(-20, TILE + 20, 8)]
    tdraw.line(pts, fill=RIVER, width=34, joint="curve")

    mask = Image.new("L", (TILE, TILE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE - 1, TILE - 1], RADIUS, fill=255)
    canvas.paste(tile, (INSET, INSET), mask)

    # Location pin: circle head + triangular tail, with a soft drop shadow.
    cx, cy, r = SIZE // 2 + 40, SIZE // 2 - 70, 170
    tip = (cx, cy + int(r * 2.05))
    pin = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pin)
    pdraw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PIN)
    pdraw.polygon([(cx - int(r * 0.86), cy + int(r * 0.5)), (cx + int(r * 0.86), cy + int(r * 0.5)), tip], fill=PIN)
    pdraw.ellipse([cx - r // 2.6, cy - r // 2.6, cx + r // 2.6, cy + r // 2.6], fill=PIN_HOLE)

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 150), mask=pin.split()[3].point(lambda a: 255 if a else 0))
    shadow = shadow.transform(shadow.size, Image.AFFINE, (1, 0, -10, 0, 1, -18)).filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(pin)
    return canvas


# O(p) time, O(p) space — p = pixels in the 1024×1024 canvas
def main() -> None:
    draw_icon().save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
