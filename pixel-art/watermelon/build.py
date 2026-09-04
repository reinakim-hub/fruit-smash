import sys
import math

sys.path.insert(0, r"C:\Users\Reina\.claude\skills\pixel-art-studio\scripts")
from pixelstudio import Sprite

# ---------------------------------------------------------------------------
# Canvas matches the game's own tile grid exactly (COLS x ROWS in level.js) -
# 1 sprite pixel = 1 board tile, so this can later be sliced straight into a
# WATERMELON_STATIC_ROWS-style char grid with zero rescaling.
# ---------------------------------------------------------------------------
W, H = 36, 34

PAL = {
    "outline": "#12321c",
    "rindDark": "#1d6b35",
    "rindDarkShade": "#124a24",
    "rindLight": "#8ecf58",
    "rindLightShade": "#6bb041",
    "rindHighlight": "#c3ea8f",
    "rindCream": "#e9f0c9",
    "flesh": "#f2635f",
    "fleshDark": "#c73f3d",
    "fleshHighlight": "#f8a9a0",
    "seed": "#2b1710",
    "stem": "#6b4423",
    "stemHighlight": "#8b5a2b",
    "leafDark": "#1d6b35",
    "leafLight": "#4fa84f",
}

s = Sprite(W, H, palette=list(PAL.values()))


def px(x, y, color, only=None):
    s.px(x, y, PAL[color], only=only)


# ---------------------------------------------------------------------------
# Main melon body: an ellipse with vertical-ish stripes that follow the
# curvature (projected so they read as running "over" the round body rather
# than as flat vertical bars), a diagonal wedge cut out of the top-right
# revealing flesh in place, and 3-tier shading (highlight/base/shade) driven
# by a light source up and to the left.
# ---------------------------------------------------------------------------
MX, MY, RX, RY = 13.5, 18.0, 11.5, 13.5
NUM_STRIPES = 7
LIGHT_X, LIGHT_Y = MX - RX * 0.55, MY - RY * 0.6

# Diagonal cut boundary (melon-local coords): everything past this line
# (up and to the right) is the flesh wedge sliced into the melon's own body.
CUT_A, CUT_B, CUT_C = 1.0, 1.0, 9.0  # cut where A*(x-MX) - B*(y-MY) > C
CUT_LINE_NORM = math.hypot(CUT_A, CUT_B)


def dist_to_cut_line(x, y):
    return abs(CUT_A * (x - MX) - CUT_B * (y - MY) - CUT_C) / CUT_LINE_NORM


def melon_local(x, y):
    return (x - MX) / RX, (y - MY) / RY


def in_melon(x, y):
    nx, ny = melon_local(x, y)
    return nx * nx + ny * ny <= 1.0


def is_wedge_cut(x, y):
    return CUT_A * (x - MX) - CUT_B * (y - MY) > CUT_C


def stripe_index(x, y):
    nx, ny = melon_local(x, y)
    # Project onto a "cylinder" so stripes narrow toward top/bottom instead
    # of staying flat vertical bars - reads as wrapping around a round body.
    k = math.sqrt(max(0.0, 1.0 - min(0.98, ny * ny)))
    coord = nx / k if k > 0.05 else nx / 0.05
    coord = max(-1.4, min(1.4, coord))
    return math.floor((coord + 1.4) / (2.8 / NUM_STRIPES))


def light_dist(x, y):
    return math.hypot((x - LIGHT_X) / RX, (y - LIGHT_Y) / RY)


for y in range(H):
    for x in range(W):
        if not in_melon(x, y):
            continue
        if is_wedge_cut(x, y):
            continue  # painted later, as flesh
        stripe_on = stripe_index(x, y) % 2 == 0
        d = light_dist(x, y)
        if stripe_on:
            color = "rindHighlight" if d < 0.42 else ("rindLight" if d < 0.95 else "rindLightShade")
        else:
            color = "rindHighlight" if d < 0.30 else ("rindDark" if d < 0.95 else "rindDarkShade")
        px(x, y, color)

# ---- Flesh wedge cut into the melon's own body (top-right) ----
RIND_RING = 1.6  # rind ring thickness, measured back from the melon's own silhouette


def dist_to_melon_edge(x, y):
    nx, ny = melon_local(x, y)
    r = math.hypot(nx, ny)
    if r < 1e-6:
        return 999
    # Approx real-space distance to the ellipse boundary along the radial ray.
    return (1.0 - r) * min(RX, RY)


for y in range(H):
    for x in range(W):
        if not in_melon(x, y) or not is_wedge_cut(x, y):
            continue
        edge = dist_to_melon_edge(x, y)
        cut_edge = dist_to_cut_line(x, y)
        if edge < RIND_RING or cut_edge < RIND_RING:
            px(x, y, "rindCream")
        else:
            d = light_dist(x, y)
            px(x, y, "fleshHighlight" if d < 0.35 else ("flesh" if d < 0.85 else "fleshDark"))

# Seeds scattered through the cut wedge's flesh, away from the rind ring.
WEDGE_SEEDS = [
    (20, 8), (22, 7), (24, 9), (21, 11), (25, 12), (23, 14), (26, 15),
    (19, 13), (24, 5), (18, 9),
]
for (x, y) in WEDGE_SEEDS:
    if 0 <= x < W and 0 <= y < H:
        px(x, y, "seed", only=PAL["flesh"])
        px(x, y, "seed", only=PAL["fleshDark"])

# ---- Stem ----
# A solid 3x3 block (not a thin 1-2px sprig) so its center pixel has all 4
# orthogonal neighbors opaque and survives the outline pass below as real
# stem color, instead of the whole nub being swallowed into the outline.
for y in range(1, 5):
    for x in range(15, 18):
        px(x, y, "stem")
px(16, 2, "stemHighlight")

# ---------------------------------------------------------------------------
# Foreground slice: a circular wedge (pie-slice) sitting in front, tucked
# against the melon's lower-right - rind only along the outer arc, flesh
# everywhere inside, seeds, and the same light-driven shading tiers.
# ---------------------------------------------------------------------------
TX, TY = 17.0, 25.0  # the slice's pointed tip - placed inside the melon so
# the two shapes overlap with no gap; the melon is painted first, so only
# the portion of the sector outside the melon's own silhouette ever shows.
SL = 18.0  # sector radius (tip to outer rind)
ANG_START, ANG_END = math.radians(-52), math.radians(28)  # opens toward lower-right


def sector_angle(x, y):
    return math.atan2(y - TY, x - TX)


def in_slice(x, y):
    r = math.hypot(x - TX, y - TY)
    if r > SL:
        return False
    a = sector_angle(x, y)
    return ANG_START <= a <= ANG_END


SLICE_LIGHT_X, SLICE_LIGHT_Y = TX - SL * 0.3, TY - SL * 0.75

for y in range(H):
    for x in range(W):
        if not in_slice(x, y):
            continue
        r = math.hypot(x - TX, y - TY)
        edge = SL - r
        d = math.hypot((x - SLICE_LIGHT_X), (y - SLICE_LIGHT_Y)) / SL
        if edge < 1.7:
            color = "rindHighlight" if d < 0.35 else ("rindLight" if d < 0.8 else "rindDarkShade")
        elif edge < 3.0:
            px(x, y, "rindCream")
            continue
        else:
            color = "fleshHighlight" if d < 0.3 else ("flesh" if d < 0.75 else "fleshDark")
        px(x, y, color)

SLICE_SEEDS = [
    (10, 22), (13, 21), (16, 20), (19, 21), (22, 23), (24, 26),
    (12, 25), (15, 26), (18, 27), (21, 28), (9, 25), (25, 22),
]
for (x, y) in SLICE_SEEDS:
    px(x, y, "seed", only=PAL["flesh"])
    px(x, y, "seed", only=PAL["fleshDark"])
    px(x, y, "seed", only=PAL["fleshHighlight"])

# ---------------------------------------------------------------------------
# Small leaf sprigs echoing the reference's leaf clusters, tucked into the
# empty corners so they never crowd the fruit itself. Each sprig is a
# chunky little diamond (not a 1px-thin line) so a real interior survives
# the outline pass below instead of being swallowed entirely by it.
# ---------------------------------------------------------------------------
LEAF_SHAPE = [
    (1, 0, "leafDark"),
    (0, 1, "leafDark"), (1, 1, "leafLight"), (2, 1, "leafDark"),
    (0, 2, "leafDark"), (1, 2, "leafLight"), (2, 2, "leafLight"), (3, 2, "leafDark"),
    (1, 3, "leafDark"), (2, 3, "leafDark"),
]


def stamp_leaf(ox, oy, flip_x=False):
    for (dx, dy, color) in LEAF_SHAPE:
        x = ox + ((3 - dx) if flip_x else dx)
        y = oy + dy
        if 0 <= x < W and 0 <= y < H:
            px(x, y, color, only="empty")


# Bottom-left corner, clear of the melon's lower-left curve.
stamp_leaf(0, 27)
stamp_leaf(2, 29, flip_x=True)
# Top-right corner, clear of the melon and the flesh wedge.
stamp_leaf(29, 1)
stamp_leaf(31, 4, flip_x=True)

# ---------------------------------------------------------------------------
# Selective outline: dashed-free full outline (this is a static preview
# image, not a game mask) so the silhouette reads crisply at tile scale.
# ---------------------------------------------------------------------------
s.outline(PAL["outline"], where="inside")

s.preview("preview.png", scale=18, grid=True)
s.save_silhouette("silhouette.png", scale=10)
s.save_swatch("swatch.png")
s.save_png("watermelon_master.png", scale=1)
s.save_png("watermelon_display.png", scale=16)
s.stats()
