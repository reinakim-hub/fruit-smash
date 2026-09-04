"""Watermelon map DATA generator - not an illustration tool.

This writes the actual tile grid (chars -> legend -> palette, exactly the
shape of the game's own *_static_map.js files) as a plain Python module.
Every cell decision below is a flat, simple integer-cell membership test -
no per-pixel shading, no anti-aliasing, no organic jitter - so every shape
lands exactly on the tile grid by construction. The renderer (render.py)
only ever reads this generated data back; it does no shape math itself.
"""

GRID_ROWS = 40
GRID_COLS = 40

# ---------------------------------------------------------------------------
# Exactly 7 playable colors (plus null/background) - 3 green rind/stripe
# shades, 1 pale rind, 2 red/pink flesh shades, 1 dark seed. Flat colors
# only: no highlight/shade tiers layered on top of these.
# ---------------------------------------------------------------------------
LEGEND = {
    ".": None,
    "D": "rindDark",
    "M": "rindMid",
    "L": "rindLight",
    "C": "rindCream",
    "F": "flesh",
    "P": "fleshPink",
    "K": "seed",
}

PALETTE = {
    "rindDark": "#1d6b35",
    "rindMid": "#3f9e4c",
    "rindLight": "#8ecf58",
    "rindCream": "#eef0a8",
    "flesh": "#ef4b46",
    "fleshPink": "#f9a8a8",
    "seed": "#241209",
}

grid = [["." for _ in range(GRID_COLS)] for _ in range(GRID_ROWS)]


def set_cell(row, col, ch):
    if 0 <= row < GRID_ROWS and 0 <= col < GRID_COLS:
        grid[row][col] = ch


def get_cell(row, col):
    if 0 <= row < GRID_ROWS and 0 <= col < GRID_COLS:
        return grid[row][col]
    return None


# ---------------------------------------------------------------------------
# Whole melon: ~18x20 cells, a simple ellipse, filled with 3 BIG stripe
# bands (dark/mid/light/mid/dark) - no shading, one flat color per band.
# ---------------------------------------------------------------------------
MX, MY, RX, RY = 16, 17, 9, 10  # bounding box ~19x21 cells


def melon_local(row, col):
    return (col - MX) / RX, (row - MY) / RY


def in_melon(row, col):
    nx, ny = melon_local(row, col)
    return nx * nx + ny * ny <= 1.0


STRIPE_BOUNDS = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]
STRIPE_CHARS = ["D", "M", "L", "M", "D"]


def stripe_char(row, col):
    nx, _ = melon_local(row, col)
    for i in range(len(STRIPE_BOUNDS) - 1):
        if STRIPE_BOUNDS[i] <= nx <= STRIPE_BOUNDS[i + 1]:
            return STRIPE_CHARS[i]
    return STRIPE_CHARS[-1]


# Diagonal cut: everything past this line (up/right) is the flesh wedge cut
# into the melon's own body.
CUT_C = 2


def is_wedge_cut(row, col):
    return (col - MX) - (row - MY) > CUT_C


RING = 1  # rind ring thickness in cells, along the melon's own outer edge
# and along the internal cut line.


def dist_to_melon_edge_cells(row, col):
    nx, ny = melon_local(row, col)
    r = (nx * nx + ny * ny) ** 0.5
    if r < 1e-6:
        return 999
    return (1.0 - r) * min(RX, RY)


def dist_to_cut_line_cells(row, col):
    return abs((col - MX) - (row - MY) - CUT_C) / (2 ** 0.5)


for row in range(GRID_ROWS):
    for col in range(GRID_COLS):
        if not in_melon(row, col):
            continue
        if is_wedge_cut(row, col):
            continue  # painted in the flesh pass below
        set_cell(row, col, stripe_char(row, col))

for row in range(GRID_ROWS):
    for col in range(GRID_COLS):
        if not in_melon(row, col) or not is_wedge_cut(row, col):
            continue
        if dist_to_melon_edge_cells(row, col) < RING or dist_to_cut_line_cells(row, col) < RING:
            set_cell(row, col, "C")
        else:
            set_cell(row, col, "F")

# One clean rectangular pink patch (a large simple cluster, not a gradient)
# in the wedge's flesh.
for row in range(5, 9):
    for col in range(19, 24):
        if get_cell(row, col) == "F":
            set_cell(row, col, "P")

# A handful of chunky 2-cell seed marks - not dozens of single-pixel dots.
WEDGE_SEED_BLOCKS = [(9, 20), (11, 23), (7, 24), (10, 17)]
for (row, col) in WEDGE_SEED_BLOCKS:
    for (dr, dc) in [(0, 0), (0, 1)]:
        if get_cell(row + dr, col + dc) in ("F", "P"):
            set_cell(row + dr, col + dc, "K")

# ---------------------------------------------------------------------------
# Front slice: ~20x10 cells, a simple half-ellipse (dome) - rind only along
# the curved top edge, flat flesh-colored bottom edge (the cut face).
# ---------------------------------------------------------------------------
SX, SY, SRX, SRY = 29, 33, 10, 10  # dome spans rows (SY-SRY..SY), cols (SX-SRX..SX+SRX)


def slice_local(row, col):
    return (col - SX) / SRX, (row - SY) / SRY


def in_slice(row, col):
    if row > SY:
        return False  # only the upper half - this is the dome/slice
    nx, ny = slice_local(row, col)
    return nx * nx + ny * ny <= 1.0


for row in range(GRID_ROWS):
    for col in range(GRID_COLS):
        if not in_slice(row, col):
            continue
        nx, ny = slice_local(row, col)
        r = (nx * nx + ny * ny) ** 0.5
        edge_cells = (1.0 - r) * min(SRX, SRY)
        if row < SY and edge_cells < RING:
            set_cell(row, col, "C")
        else:
            set_cell(row, col, "F")

# One clean rectangular pink patch on the slice too.
for row in range(25, 28):
    for col in range(22, 27):
        if get_cell(row, col) == "F":
            set_cell(row, col, "P")

SLICE_SEED_BLOCKS = [(26, 21), (29, 25), (31, 30), (27, 33), (30, 20)]
for (row, col) in SLICE_SEED_BLOCKS:
    for (dr, dc) in [(0, 0), (0, 1)]:
        if get_cell(row + dr, col + dc) in ("F", "P"):
            set_cell(row + dr, col + dc, "K")

# ---------------------------------------------------------------------------
# 1-2 tiny leaf accents only - small solid blocks reusing the rind greens
# (no separate leaf color; stays inside the 7-color budget).
# ---------------------------------------------------------------------------
LEAF_A = [(25, 3), (26, 3), (26, 4), (27, 4)]
for (row, col) in LEAF_A:
    if get_cell(row, col) == ".":
        set_cell(row, col, "M")

LEAF_B = [(21, 26), (21, 27), (22, 27)]
for (row, col) in LEAF_B:
    if get_cell(row, col) == ".":
        set_cell(row, col, "D")

# ---------------------------------------------------------------------------
# Emit the grid as an actual game-map-shaped Python module - the map DATA,
# not a rendered image.
# ---------------------------------------------------------------------------
ROWS = ["".join(r) for r in grid]

if __name__ == "__main__":
    with open("watermelon_grid_data.py", "w") as f:
        f.write('"""Watermelon tile-grid map data - generated, hand-tunable.\n')
        f.write('40x40, max 7 playable colors, large simple clusters only."""\n\n')
        f.write("GRID_ROWS = %d\n" % GRID_ROWS)
        f.write("GRID_COLS = %d\n\n" % GRID_COLS)
        f.write("WATERMELON_ROWS = [\n")
        for r in ROWS:
            f.write("    %r,\n" % r)
        f.write("]\n\n")
        f.write("WATERMELON_LEGEND = {\n")
        for ch, key in LEGEND.items():
            f.write("    %r: %r,\n" % (ch, key))
        f.write("}\n\n")
        f.write("WATERMELON_PALETTE = {\n")
        for key, hexv in PALETTE.items():
            f.write("    %r: %r,\n" % (key, hexv))
        f.write("}\n")

    # Print a quick color-count summary as a sanity check on the "large
    # simple clusters" requirement - a real illustration would have far more
    # distinct small runs; this should read as a handful of big regions.
    from collections import Counter
    counts = Counter(ch for row in grid for ch in row if ch != ".")
    print("cell counts by legend char:", dict(counts))
    print("distinct playable colors:", len(set(LEGEND[ch] for ch in counts)))
    print("wrote watermelon_grid_data.py")
