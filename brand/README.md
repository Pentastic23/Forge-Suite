# Brand

- `originals/` holds the logos as delivered (gold hexagon on a navy square).
- `<app>-logo.png` (1024 px) and `<app>-logo-256.png` are the same logos with the
  backdrop outside the hexagon removed, cropped so the hexagon fills the image.
- `icons/<app>/` is a full Tauri icon set per app (`icon.ico` holds 16 to 256 px,
  with the small sizes sharpened for the taskbar). Copy it into
  `apps/<app>/src-tauri/icons/` when an app is added.

To rebuild everything after changing an original:

```
pip install pillow numpy scipy
python brand/tools/make_icons.py
```

AI Forge's original is drawn by code in the same pixel style (`tools/draw_ai_forge.py`, a
violet chip with a spark on the anvil inside the gold hexagon). Run it before `make_icons.py`
after changing the drawing.
