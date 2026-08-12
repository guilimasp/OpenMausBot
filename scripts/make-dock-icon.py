#!/usr/bin/env python3
"""Pad the app icon to the macOS icon grid, at build time.

Upstream's artwork fills its 1024x1024 canvas edge to edge, so the app
renders visibly larger than every other icon in the Dock. Apple's grid puts
the body at 824x824 inside the canvas.

This is applied during the build rather than committed, so this fork never
edits a file upstream owns — that is what keeps every future rebase
conflict-free. It is also self-disabling: once upstream ships a padded
icon (see milind-soni/OpenMausBot#33), the artwork is already inside the
grid and this exits without touching anything.

    python3 scripts/make-dock-icon.py <outdir>

writes <outdir>/icon.icns and <outdir>/app-icon.png, or exits 3 when the
padding is already there and the build should use upstream's files as-is.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

BODY_RATIO = 824 / 1024
ALREADY_PADDED = 0.90  # artwork narrower than this is already inside a grid
SOURCE = Path("build/icon-1024.png")
VARIANTS = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = Path(sys.argv[1])
    if not SOURCE.exists():
        print(f"{SOURCE} not found — run from the repo root", file=sys.stderr)
        return 2

    art = Image.open(SOURCE).convert("RGBA")
    box = art.getchannel("A").getbbox()
    filled = (box[2] - box[0]) / art.width
    if filled < ALREADY_PADDED:
        print(f"icon already sits at {filled:.0%} of its canvas — leaving it alone")
        return 3

    canvas = art.width
    body = round(canvas * BODY_RATIO)
    padded = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    offset = (canvas - body) // 2
    padded.paste(art.resize((body, body), Image.LANCZOS), (offset, offset))

    out.mkdir(parents=True, exist_ok=True)
    padded.save(out / "app-icon.png")
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for name, size in VARIANTS:
            padded.resize((size, size), Image.LANCZOS).save(iconset / name)
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(out / "icon.icns")],
            check=True,
        )
    print(f"padded the icon from {filled:.0%} to {BODY_RATIO:.0%} of the canvas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
