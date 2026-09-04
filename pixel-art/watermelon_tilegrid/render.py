"""Renders a preview PNG purely by reading watermelon_grid_data.py back -
no shape math, no shading, no anti-aliasing here. Each grid cell becomes one
flat-colored NxN block. This is the "render a preview from that grid" step,
kept fully separate from generate_grid.py so the image can never be the
source of truth - the data module is.
"""
import sys

sys.path.insert(0, r"C:\Users\Reina\.claude\skills\pixel-art-studio\scripts")
from pixelstudio import Sprite

from watermelon_grid_data import GRID_ROWS, GRID_COLS, WATERMELON_ROWS, WATERMELON_LEGEND, WATERMELON_PALETTE

s = Sprite(GRID_COLS, GRID_ROWS)

for row, line in enumerate(WATERMELON_ROWS):
    for col, ch in enumerate(line):
        key = WATERMELON_LEGEND[ch]
        if key is None:
            continue
        s.px(col, row, WATERMELON_PALETTE[key])

s.preview("preview.png", scale=14, grid=True)
s.save_silhouette("silhouette.png", scale=8)
s.save_swatch("swatch.png")
s.save_png("watermelon_tilegrid_master.png", scale=1)
s.save_png("watermelon_tilegrid_display.png", scale=14)
s.stats()
