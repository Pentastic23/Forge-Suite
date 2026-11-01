"""Build transparent logos and app icon sets from the original Forge logos.

    pip install pillow numpy scipy
    python brand/tools/make_icons.py

Reads brand/originals/<app>-logo.png (gold hexagon on a navy square), then:
  1. makes everything outside the hexagon transparent (flood fill from the corners,
     with a soft, de-fringed edge),
  2. crops to the hexagon so it fills the icon,
  3. writes brand/<app>-logo.png (1024 px) and brand/<app>-logo-256.png,
  4. writes a full Tauri icon set to brand/icons/<app>/, with the small sizes
     (16-48 px) sharpened so they stay readable on the desktop and taskbar,
  5. copies that set into apps/<app>/src-tauri/icons/ for every app that exists.
"""
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "brand"
APPS = ["forge-hub", "forge-core", "balance-forge", "asset-forge", "pixel-forge"]

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
PNGS = {
    "32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256,
    "icon.png": 512, "StoreLogo.png": 50,
    "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
}


def cut_out(path: Path) -> Image.Image:
    """Remove the square backdrop around the hexagon and crop to it."""
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    corners = np.concatenate([im[:20, :20], im[:20, -20:], im[-20:, :20], im[-20:, -20:]]).reshape(-1, 3)
    bg = np.median(corners, 0)
    dist = np.linalg.norm(im - bg, axis=2)

    labels, _ = ndimage.label(dist < 28)
    seeds = set(labels[[0, 0, -1, -1], [0, -1, 0, -1]].tolist()) - {0}
    inside = ndimage.binary_fill_holes(~np.isin(labels, list(seeds)))
    outside = ~inside

    # Edge pixels are a blend of logo and backdrop: recover alpha and un-mix the colour
    band = ndimage.binary_dilation(outside, iterations=3) & inside
    alpha = inside.astype(np.float32)
    alpha[band] = np.clip(dist[band] / 60.0, 0, 1)
    rgb = im.copy()
    soft = (alpha > 0) & (alpha < 1)
    rgb[soft] = (im[soft] - (1 - alpha[soft, None]) * bg) / alpha[soft, None]
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)

    img = Image.fromarray(rgba, "RGBA")
    img = img.crop(img.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox())
    side = max(img.size)
    pad = round(side * 0.01)
    square = Image.new("RGBA", (side + 2 * pad,) * 2, (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2 + pad, (side - img.height) // 2 + pad))
    return square.resize((1024, 1024), Image.LANCZOS)


def render(master: Image.Image, size: int) -> Image.Image:
    """Downscale the master, tuned so small sizes stay crisp."""
    if size >= 96:
        return master.resize((size, size), Image.LANCZOS)
    mid = master.resize((size * 4, size * 4), Image.BOX)
    if size <= 48:
        alpha = mid.getchannel("A")
        rgb = ImageEnhance.Contrast(mid.convert("RGB")).enhance(1.15)
        mid = ImageEnhance.Color(rgb).enhance(1.2).convert("RGBA")
        mid.putalpha(alpha)
    small = mid.resize((size, size), Image.LANCZOS)
    rgb = small.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=0.8, percent=110 if size <= 32 else 70, threshold=0))
    alpha = small.getchannel("A").point(lambda v: 0 if v < 40 else (255 if v > 200 else v))
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def build(app: str) -> None:
    master = cut_out(BRAND / "originals" / f"{app}-logo.png")
    master.save(BRAND / f"{app}-logo.png", optimize=True)
    render(master, 256).save(BRAND / f"{app}-logo-256.png", optimize=True)

    out = BRAND / "icons" / app
    out.mkdir(parents=True, exist_ok=True)
    for name, size in PNGS.items():
        render(master, size).save(out / name, optimize=True)
    ico = [render(master, s) for s in ICO_SIZES]
    ico[-1].save(out / "icon.ico", sizes=[(s, s) for s in ICO_SIZES], append_images=ico[:-1])
    icns = [render(master, s) for s in ICNS_SIZES]
    icns[-1].save(out / "icon.icns", append_images=icns[:-1])

    target = ROOT / "apps" / app / "src-tauri" / "icons"
    if target.is_dir():
        for f in out.iterdir():
            shutil.copy2(f, target / f.name)
    print(f"{app}: done{' (copied into app)' if target.is_dir() else ''}")


if __name__ == "__main__":
    for app in APPS:
        build(app)
