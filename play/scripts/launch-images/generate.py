#!/usr/bin/env python3
"""
Builds the installed app's launch screens for iPhone and iPad (#949) from the Universe logo (#981).

iOS ignores the manifest for its launch screen: it shows an `apple-touch-startup-image` whose media query matches the
screen exactly, else a blank one. Each image is Universe ink with the logo exactly where the page's own loading
screen (#boot-splash in index.html) puts it: 36px tall, its middle 10px above the middle of the page. The installed
app's status bar is see-through (#969), so the page starts at the very top of the screen and the middle is the middle
of the whole screen. So the picture holds still from the tap until the game.

universe-logo.png is docs/brand/bawes-universe-white.svg cut to the logo itself (the viewBox "24 20 634 104" that
index.html uses), drawn 400px tall on a transparent ground.

Run from play/ with Pillow installed, then paste what it prints into index.html:
    python3 scripts/launch-images/generate.py
"""
import os

from PIL import Image

INK = (0x14, 0x12, 0x1E)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "public", "static", "images", "launch")
LOGO = os.path.join(HERE, "universe-logo.png")
LOGO_HEIGHT = 36  # css px, as #boot-splash svg
ABOVE_MIDDLE = 10  # css px: the 16px gap and 4px bar sit under the logo, centred as one column

# (width, height, pixel ratio, status bar height) of each screen held upright, in css px. The status bar height is
# kept for reference: the page runs under it since #969, so it no longer moves the logo.
SCREENS = [
    # iPhone
    (440, 956, 3, 62),  # 16 Pro Max, 17 Pro Max
    (420, 912, 3, 62),  # Air
    (402, 874, 3, 62),  # 16 Pro, 17, 17 Pro
    (430, 932, 3, 59),  # 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    (393, 852, 3, 59),  # 14 Pro, 15, 15 Pro, 16
    (428, 926, 3, 47),  # 12 Pro Max, 13 Pro Max, 14 Plus
    (390, 844, 3, 47),  # 12, 12 Pro, 13, 13 Pro, 14, 16e
    (375, 812, 3, 47),  # X, XS, 11 Pro (44), 12 mini, 13 mini (50)
    (414, 896, 3, 44),  # XS Max, 11 Pro Max
    (414, 896, 2, 48),  # XR, 11
    (414, 736, 3, 20),  # 6 Plus to 8 Plus
    (375, 667, 2, 20),  # 6 to 8, SE 2nd and 3rd generation
    (320, 568, 2, 20),  # SE 1st generation
    # iPad
    (1032, 1376, 2, 24),  # Pro 13" (M4)
    (1024, 1366, 2, 24),  # Pro 12.9", Air 13"
    (834, 1210, 2, 24),  # Pro 11" (M4)
    (834, 1194, 2, 24),  # Pro 11"
    (820, 1180, 2, 24),  # Air 10.9" and 11", iPad 10th generation and later
    (834, 1112, 2, 20),  # Air 3rd generation, Pro 10.5"
    (810, 1080, 2, 20),  # iPad 7th to 9th generation
    (768, 1024, 2, 20),  # mini 5th generation and older iPads
    (744, 1133, 2, 24),  # mini 6th generation and later
]


def logo(ratio):
    source = Image.open(LOGO).convert("RGBA")
    height = LOGO_HEIGHT * ratio
    width = round(source.width * height / source.height)
    return source.resize((width, height), Image.LANCZOS)


def on_ink(image, width, height, centre_x, centre_y):
    canvas = Image.new("RGBA", (width, height), INK + (255,))
    canvas.alpha_composite(image, (round(centre_x - image.width / 2), round(centre_y - image.height / 2)))
    # A few dozen colours: ink, white and the edges between them. Keeps each file a few kB.
    return canvas.convert("RGB").quantize(colors=64, method=Image.Quantize.MEDIANCUT)


def save(image, name):
    image.save(os.path.join(OUT, name), "PNG", optimize=True)


def main():
    links = []
    marks = {}
    for width, height, ratio, _status_bar in SCREENS:
        mark = marks.setdefault(ratio, logo(ratio))
        kind = "ipad" if width >= 744 else "iphone"
        for orientation in ("portrait", "landscape"):
            w, h = (width, height) if orientation == "portrait" else (height, width)
            # The page starts at y=0, under the see-through status bar, in either orientation.
            centre_y = h / 2 - ABOVE_MIDDLE
            name = f"{kind}-{width}x{height}@{ratio}x-{orientation}.png"
            save(on_ink(mark, w * ratio, h * ratio, w * ratio / 2, centre_y * ratio), name)
            links.append(
                f'<link rel="apple-touch-startup-image" media="screen and (device-width: {width}px) and '
                f"(device-height: {height}px) and (-webkit-device-pixel-ratio: {ratio}) and "
                f'(orientation: {orientation})" href="/static/images/launch/{name}" />'
            )

    print("\n".join(links))


if __name__ == "__main__":
    main()
