"""
Prep a phone photo of a spindle so it can sit behind the 2D stock.

Convention: the whole image maps to the stock rectangle (width = stock size,
height = stock length, headstock at the top). Units inches.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "reference" / "leg-reference-photo.jpeg"
DST = ROOT / "reference" / "leg-overlay-3.5x29.5.png"

# Physical size we are mapping onto.
STOCK_SIZE_IN = 3.5
STOCK_LENGTH_IN = 29.5
PX_PER_IN = 100

# Measured on the source JPEG (479 x 1747):
# - Near corner / turned centerline sits at x = 241.
# - First oak pixels of the pommel top: y = 127.
# - Contact shadow under the foot: y ~= 1386.
AXIS_X = 241
TOP_Y = 125
FOOT_Y = 1384


def main():
    src = Image.open(SRC).convert("RGB")
    height_px = FOOT_Y - TOP_Y
    width_px = height_px * STOCK_SIZE_IN / STOCK_LENGTH_IN
    left = int(round(AXIS_X - width_px / 2))
    right = int(round(AXIS_X + width_px / 2))
    crop = src.crop((left, TOP_Y, right, FOOT_Y))

    out_w = int(round(STOCK_SIZE_IN * PX_PER_IN))
    out_h = int(round(STOCK_LENGTH_IN * PX_PER_IN))
    out = crop.resize((out_w, out_h), Image.Resampling.LANCZOS)
    out.save(DST, "PNG", dpi=(PX_PER_IN, PX_PER_IN))
    print(
        f"crop=({left},{TOP_Y},{right},{FOOT_Y}) {crop.size} -> {out.size} "
        f"@ {PX_PER_IN} dpi ({STOCK_SIZE_IN} x {STOCK_LENGTH_IN} in) -> {DST.name}"
    )


if __name__ == "__main__":
    main()
