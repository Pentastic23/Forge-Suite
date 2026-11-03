"""Draw the AI Forge logo in the same style as the other Forge logos.

    pip install pillow
    python brand/tools/draw_ai_forge.py
    python brand/tools/make_icons.py

The other logos are pixel art: a gold hexagon on a navy square with the app's
symbol over an anvil. AI Forge's symbol is a violet chip with a spark in it,
standing on the anvil, drawn here cell by cell on a 66 x 66 grid and scaled up
to 1254 px like the originals, so make_icons.py can cut it out the same way.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
N = 66
CELL = 19  # 66 * 19 = 1254, the size of the other originals

NAVY = (32, 40, 61)
INSIDE = (26, 32, 52)
INSIDE_DEEP = (21, 26, 43)
OUTLINE = (15, 19, 32)
GOLD_HI = (250, 214, 92)
GOLD = (237, 187, 47)
GOLD_LO = (196, 138, 30)
GREY_HI = (176, 184, 202)
GREY = (104, 113, 136)
GREY_LO = (66, 74, 96)
VIOLET_HI = (176, 156, 255)
VIOLET = (124, 92, 240)
VIOLET_LO = (78, 54, 176)
DIE = (44, 30, 104)
CYAN = (127, 227, 255)
WHITE = (240, 251, 255)
GLOW = (167, 139, 250)

grid = [[NAVY for _ in range(N)] for _ in range(N)]


def put(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        grid[y][x] = c


def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)


R = 29.0  # vertex distance of the hexagon's outer edge, in cells
W = R * 0.97  # as wide as it is tall, like the other logos


def hex_dist(x, y):
    """Signed distance in cells from the hexagon's outer edge (negative inside)."""
    cx = cy = (N - 1) / 2
    dx, dy = abs(x - cx), abs(y - cy)
    k = 0.5 * R / W
    return max(dx - W, (dy + dx * k - R) / (1 + k * k) ** 0.5)


def in_hex(x, y, inset=0.0):
    return hex_dist(x, y) <= -inset


def blend(a, b, t):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))


# ---------------------------------------------------------------- hexagon frame
for y in range(N):
    for x in range(N):
        d = hex_dist(x, y)
        if 0 < d <= 1.1:
            put(x, y, OUTLINE)
        elif -2.4 < d <= 0:
            # light from the top left, like the other logos
            t = (x + y) / (2 * N)
            put(x, y, GOLD_HI if t < 0.38 else GOLD if t < 0.62 else GOLD_LO)
        elif -3.4 < d <= -2.4:
            put(x, y, OUTLINE)
        elif d <= -3.4:
            d = ((x - 32.5) ** 2 + (y - 26) ** 2) ** 0.5
            put(x, y, blend(INSIDE, INSIDE_DEEP, min(1, d / 30)))

# soft violet glow behind the chip
for y in range(N):
    for x in range(N):
        if in_hex(x, y, 3.4):
            d = ((x - 32.5) ** 2 + (y - 25) ** 2) ** 0.5
            if d < 19:
                put(x, y, blend(grid[y][x], GLOW, 0.24 * (1 - d / 19)))

# ---------------------------------------------------------------- anvil
def outlined(cells, fill):
    cells = set(cells)
    for (x, y) in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in cells:
                put(x + dx, y + dy, OUTLINE)
    for (x, y) in cells:
        put(x, y, fill(x, y))


anvil = set()
for y, (a, b) in zip(range(42, 46), ((11, 54), (14, 54), (19, 53), (23, 50))):  # face, horn to the left
    for x in range(a, b):
        anvil.add((x, y))
for y in range(46, 50):          # waist
    for x in range(27, 39):
        anvil.add((x, y))
for y in range(50, 53):          # foot
    for x in range(20 - (y - 50), 46 + (y - 50)):
        anvil.add((x, y))
outlined(anvil, lambda x, y: GREY_HI if y == 42 else GREY if y < 45 or (x < 35 and y < 50) else GREY_LO)

# ---------------------------------------------------------------- chip
x0, y0, x1, y1 = 21, 15, 44, 37
for i in range(x0 + 3, x1 - 1, 3):          # pins top and bottom
    rect(i - 1, y0 - 3, i, y0 - 1, OUTLINE)
    rect(i - 1, y0 - 2, i, y0 - 1, GOLD)
    rect(i - 1, y1 + 1, i, y1 + 3, OUTLINE)
    rect(i - 1, y1 + 1, i, y1 + 2, GOLD_LO)
for j in range(y0 + 3, y1 - 1, 3):          # pins left and right
    rect(x0 - 3, j - 1, x0 - 1, j, OUTLINE)
    rect(x0 - 2, j - 1, x0 - 1, j, GOLD)
    rect(x1 + 1, j - 1, x1 + 3, j, OUTLINE)
    rect(x1 + 1, j - 1, x1 + 2, j, GOLD_LO)
chip = {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)} - {(x0, y0), (x1, y0), (x0, y1), (x1, y1)}
outlined(chip, lambda x, y: VIOLET_HI if (x - x0) + (y - y0) < 6 else VIOLET_LO if (x1 - x) + (y1 - y) < 5 else VIOLET)
rect(x0 + 1, y0 + 1, x1 - 2, y0 + 1, VIOLET_HI)
# the die, with circuit traces
rect(x0 + 5, y0 + 5, x1 - 5, y1 - 5, OUTLINE)
rect(x0 + 6, y0 + 6, x1 - 6, y1 - 6, DIE)
for (a, b) in ((x0 + 2, y0 + 9), (x0 + 2, y1 - 9)):
    rect(a, b, x0 + 4, b, CYAN)
for (a, b) in ((x1 - 4, y0 + 9), (x1 - 4, y1 - 9)):
    rect(a, b, x1 - 2, b, CYAN)
rect(x0 + 9, y0 + 2, x0 + 9, y0 + 4, CYAN)
rect(x1 - 9, y1 - 4, x1 - 9, y1 - 2, CYAN)

# the spark: a four-point star in the die
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
for d in range(0, 5):
    c = WHITE if d < 2 else CYAN
    for (dx, dy) in ((d, 0), (-d, 0), (0, d), (0, -d)):
        put(cx + dx, cy + dy, c)
for (dx, dy) in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
    put(cx + dx, cy + dy, CYAN)
put(cx + 1, cy, WHITE)
put(cx, cy + 1, WHITE)
put(cx + 1, cy + 1, WHITE)

# small sparkles around the chip
def sparkle(x, y, big=False):
    put(x, y, WHITE)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        put(x + dx, y + dy, CYAN)
    if big:
        for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            put(x + dx, y + dy, GLOW)


sparkle(51, 20, big=True)
sparkle(12, 22)
sparkle(54, 31)
sparkle(13, 35)

# sparks flying off the anvil face
for (x, y, c) in ((17, 40, GOLD_HI), (49, 39, GOLD), (51, 41, GOLD_HI), (14, 39, GOLD)):
    put(x, y, c)

img = Image.new("RGB", (N, N))
img.putdata([c for row in grid for c in row])
img = img.resize((N * CELL, N * CELL), Image.NEAREST)
out = ROOT / "brand" / "originals" / "ai-forge-logo.png"
img.save(out, optimize=True)
print(f"wrote {out}")
