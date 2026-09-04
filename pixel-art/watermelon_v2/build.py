import sys
import math

sys.path.insert(0, r"C:\Users\Reina\.claude\skills\pixel-art-studio\scripts")
from pixelstudio import Sprite

# ---------------------------------------------------------------------------
# v2 - redesigned from a fresh look at Watermelon.png (wide 1024x559 source,
# whole melon + cut wedge + loose slice + leaf clusters in 3 spots). Canvas
# matches the game's own near-square tile grid (COLS x ROWS in level.js) -
# 1 sprite pixel = 1 board tile.
# ---------------------------------------------------------------------------
W, H = 36, 34

PAL = {
    "outline": "#12321c",
    "rindDark": "#1d6b35",
    "rindDarkShade": "#124a24",
    "rindLight": "#8ecf58",
    "rindLightShade": "#6bb041",
    "rindHighlight": "#c3ea8f",
    "rindCream": "#eef0a8",
    "flesh": "#ef4b46",
    "fleshDark": "#c22f2d",
    "fleshHighlight": "#f9a8a8",
    "seed": "#241209",
    "stem": "#6b4423",
    "stemHighlight": "#a17a3f",
    "leafDark": "#1d6b35",
    "leafLight": "#4fa84f",
}

s = Sprite(W, H, palette=list(PAL.values()))


def px(x, y, color, only=None):
    s.px(x, y, PAL[color], only=only)


# ---------------------------------------------------------------------------
# Main melon body
# ---------------------------------------------------------------------------
MX, MY, RX, RY = 13.5, 18.0, 11.5, 13.5
LIGHT_X, LIGHT_Y = MX - RX * 0.55, MY - RY * 0.6

CUT_A, CUT_B, CUT_C = 1.0, 1.0, 9.0
CUT_LINE_NORM = math.hypot(CUT_A, CUT_B)

# Organic, unevenly-spaced stripe boundaries (in projected "coord" units)
# instead of a perfectly even division - reads as hand-drawn rather than a
# mechanical repeating pattern, echoing the reference's uneven bands.
STRIPE_BOUNDS = [-1.4, -0.95, -0.55, -0.05, 0.35, 0.85, 1.4]


def melon_local(x, y):
    return (x - MX) / RX, (y - MY) / RY


def in_melon(x, y):
    nx, ny = melon_local(x, y)
    return nx * nx + ny * ny <= 1.0


def is_wedge_cut(x, y):
    return CUT_A * (x - MX) - CUT_B * (y - MY) > CUT_C


def dist_to_cut_line(x, y):
    return abs(CUT_A * (x - MX) - CUT_B * (y - MY) - CUT_C) / CUT_LINE_NORM


def stripe_on(x, y):
    nx, ny = melon_local(x, y)
    k = math.sqrt(max(0.0, 1.0 - min(0.98, ny * ny)))
    coord = nx / k if k > 0.05 else nx / 0.05
    # A gentle wave along y so stripe edges aren't perfectly straight -
    # organic rather than mechanical.
    coord += 0.10 * math.sin(y * 0.8 + nx * 1.3)
    coord = max(-1.4, min(1.39, coord))
    idx = 0
    for i, b in enumerate(STRIPE_BOUNDS[1:]):
        if coord < b:
            idx = i
            break
    return idx % 2 == 0


def light_dist(x, y):
    return math.hypot((x - LIGHT_X) / RX, (y - LIGHT_Y) / RY)


def dist_to_melon_edge(x, y):
    nx, ny = melon_local(x, y)
    r = math.hypot(nx, ny)
    if r < 1e-6:
        return 999
    return (1.0 - r) * min(RX, RY)


RIND_RING = 1.6

for y in range(H):
    for x in range(W):
        if not in_melon(x, y) or is_wedge_cut(x, y):
            continue
        on = stripe_on(x, y)
        d = light_dist(x, y)
        if on:
            color = "rindHighlight" if d < 0.42 else ("rindLight" if d < 0.95 else "rindLightShade")
        else:
            color = "rindHighlight" if d < 0.30 else ("rindDark" if d < 0.95 else "rindDarkShade")
        px(x, y, color)

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

WEDGE_SEEDS = [(20, 8), (22, 7), (24, 9), (21, 11), (25, 12), (23, 14), (19, 13), (24, 5)]
for (x, y) in WEDGE_SEEDS:
    for tone in ("flesh", "fleshDark", "fleshHighlight"):
        px(x, y, "seed", only=PAL[tone])

# ---- Stem: solid block (not a thin sprig) so it survives the outline pass,
# with a slight bend to read as organic rather than a straight peg. ----
for y in range(1, 5):
    for x in range(15, 18):
        px(x, y, "stem")
for y in range(0, 2):
    for x in range(16, 19):
        px(x, y, "stem")
px(16, 2, "stemHighlight")
px(17, 1, "stemHighlight")

# ---------------------------------------------------------------------------
# Foreground slice - softened into a rounded scoop rather than a sharp pie
# wedge, with a distinct pink highlight patch (not just a shading tier).
# ---------------------------------------------------------------------------
TX, TY = 17.0, 25.0
SL = 18.0
ANG_START, ANG_END = math.radians(-50), math.radians(30)


def sector_angle(x, y):
    return math.atan2(y - TY, x - TX)


def in_slice(x, y):
    r = math.hypot(x - TX, y - TY)
    if r > SL:
        return False
    a = sector_angle(x, y)
    return ANG_START <= a <= ANG_END


SLICE_LIGHT_X, SLICE_LIGHT_Y = TX - SL * 0.3, TY - SL * 0.75
# Explicit highlight patch (upper-left of the slice's flesh) rather than a
# pure distance falloff - reads as a deliberate pink accent, like the ref.
HL_CX, HL_CY, HL_RX, HL_RY = TX + 6.5, TY - 7.5, 4.5, 3.2

for y in range(H):
    for x in range(W):
        if not in_slice(x, y):
            continue
        r = math.hypot(x - TX, y - TY)
        edge = SL - r
        if edge < 1.7:
            d = math.hypot((x - SLICE_LIGHT_X), (y - SLICE_LIGHT_Y)) / SL
            color = "rindHighlight" if d < 0.35 else ("rindLight" if d < 0.8 else "rindDarkShade")
        elif edge < 3.0:
            px(x, y, "rindCream")
            continue
        else:
            hn = ((x - HL_CX) / HL_RX) ** 2 + ((y - HL_CY) / HL_RY) ** 2
            if hn <= 1.0:
                color = "fleshHighlight"
            else:
                d = math.hypot((x - SLICE_LIGHT_X), (y - SLICE_LIGHT_Y)) / SL
                color = "fleshHighlight" if d < 0.3 else ("flesh" if d < 0.78 else "fleshDark")
        px(x, y, color)

SLICE_SEEDS = [
    (10, 22), (13, 21), (16, 20), (19, 21), (22, 23), (24, 26),
    (12, 25), (15, 26), (18, 27), (21, 28), (9, 25), (25, 22), (20, 25),
]
for (x, y) in SLICE_SEEDS:
    for tone in ("flesh", "fleshDark", "fleshHighlight"):
        px(x, y, "seed", only=PAL[tone])

# ---------------------------------------------------------------------------
# Three leaf clusters, positioned relative to the fruit like the reference
# (bottom-left behind the melon, upper-right near the cut, lower-right
# behind the slice) - each a chunky diamond so it survives outlining.
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


# Bottom-left, behind the melon's lower-left curve.
stamp_leaf(0, 27)
stamp_leaf(2, 29, flip_x=True)
# Right side, tucked in the pocket between the cut wedge and the slice -
# verified clear of both silhouettes (melon maxes out near x=24, the slice
# sector's radius-18 reach doesn't extend this far up-right) so it reads as
# a real cluster instead of being swallowed or floating in empty space.
stamp_leaf(32, 12)
stamp_leaf(34, 14, flip_x=True)

# ---------------------------------------------------------------------------
# Selective outline for a crisp, clean, readable silhouette.
# ---------------------------------------------------------------------------
s.outline(PAL["outline"], where="inside")

s.preview("preview.png", scale=18, grid=True)
s.save_silhouette("silhouette.png", scale=10)
s.save_swatch("swatch.png")
s.save_png("watermelon_master.png", scale=1)
s.save_png("watermelon_display.png", scale=16)
s.stats()
