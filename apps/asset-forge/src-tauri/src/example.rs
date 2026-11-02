//! The Emberfall example project: a folder of small made-up game assets (drawn
//! and synthesised here, so nothing comes from other art), a library with
//! statuses and tags, and production requirements imported from
//! `examples/emberfall/codex.json`, the entries of Forge Core's example.
//!
//! A few problems are left in on purpose so the Checks page has something to
//! show: a duplicate icon, a gap in numbered frames, an icon of the wrong
//! size, a texture that isn't a power of two, a button without its disabled
//! state and a file name with spaces.

use image::{Rgba, RgbaImage};
use std::fs;
use std::path::{Path, PathBuf};

use crate::projects;
use crate::requirements::{self, SlotState};
use crate::store::{AssetPatch, AssetQuery, Project, Result};

const CODEX: &str = include_str!("../../../../examples/emberfall/codex.json");
pub const NAME: &str = "Emberfall (example)";
const FILE_STEM: &str = "Emberfall Example";

pub fn path() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM}.{}", projects::EXTENSION))
}

/// The example's asset files, next to the project file.
pub fn assets_dir() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM} Assets"))
}

/// Opens the example project, making it (and its asset folder) first if it isn't there yet.
pub fn open_or_build() -> Result<(PathBuf, Project)> {
    let path = path();
    if path.is_file() {
        return Ok((path.clone(), Project::open(&path)?));
    }
    fs::create_dir_all(projects::projects_dir()).map_err(|e| e.to_string())?;
    match build(&path, &assets_dir()) {
        Ok(p) => Ok((path, p)),
        Err(e) => {
            for ext in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{ext}", path.display()));
            }
            Err(e)
        }
    }
}

// ---------------------------------------------------------------- drawing

type Rgb = [u8; 3];

fn hex(h: u32) -> Rgb {
    [(h >> 16) as u8, (h >> 8) as u8, h as u8]
}

struct Canvas(RgbaImage);

impl Canvas {
    fn new(w: u32, h: u32) -> Canvas {
        Canvas(RgbaImage::new(w, h))
    }
    fn put(&mut self, x: i32, y: i32, c: Rgb) {
        if x >= 0 && y >= 0 && (x as u32) < self.0.width() && (y as u32) < self.0.height() {
            self.0.put_pixel(x as u32, y as u32, Rgba([c[0], c[1], c[2], 255]));
        }
    }
    fn rect(&mut self, x0: i32, y0: i32, w: i32, h: i32, c: Rgb) {
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                self.put(x, y, c);
            }
        }
    }
    /// Filled ellipse centred on (cx, cy); `top_only` keeps the upper half (a dome).
    fn ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, c: Rgb, top_only: bool) {
        for y in (cy - ry).floor() as i32..=(cy + ry).ceil() as i32 {
            for x in (cx - rx).floor() as i32..=(cx + rx).ceil() as i32 {
                let (dx, dy) = ((x as f32 + 0.5 - cx) / rx, (y as f32 + 0.5 - cy) / ry);
                if dx * dx + dy * dy <= 1.0 && (!top_only || y as f32 + 0.5 <= cy) {
                    self.put(x, y, c);
                }
            }
        }
    }
    fn line(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, c: Rgb, thick: i32) {
        let n = (x1 - x0).abs().max((y1 - y0).abs()).max(1);
        for i in 0..=n {
            let x = x0 + (x1 - x0) * i / n;
            let y = y0 + (y1 - y0) * i / n;
            self.rect(x - thick / 2, y - thick / 2, thick, thick, c);
        }
    }
    /// A dark outline around everything drawn, like hand-made pixel art.
    fn outline(&mut self, c: Rgb) {
        let src = self.0.clone();
        let (w, h) = (src.width() as i32, src.height() as i32);
        let solid = |x: i32, y: i32| x >= 0 && y >= 0 && x < w && y < h && src.get_pixel(x as u32, y as u32)[3] > 0;
        for y in 0..h {
            for x in 0..w {
                if !solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
                    self.put(x, y, c);
                }
            }
        }
    }
    fn save(self, path: &Path) -> Result<()> {
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        self.0.save(path).map_err(|e| format!("{}: {e}", path.display()))
    }
}

const INK: u32 = 0x1f1a24;

/// A slime: a dome with eyes. `squash` 0..1 flattens it for idle frames.
fn slime(size: u32, body: u32, shade: u32, squash: f32) -> Canvas {
    let s = size as f32;
    let mut c = Canvas::new(size, size);
    let (rx, ry) = (s * (0.38 + 0.05 * squash), s * (0.36 - 0.06 * squash));
    let base = s * 0.85;
    c.ellipse(s / 2.0, base, rx, ry, hex(body), true);
    c.ellipse(s / 2.0 + rx * 0.35, base - ry * 0.25, rx * 0.45, ry * 0.5, hex(shade), true);
    c.ellipse(s / 2.0 - rx * 0.45, base - ry * 0.7, rx * 0.15, ry * 0.12, hex(0xffffff), false);
    let eye_y = (base - ry * 0.4) as i32;
    c.rect((s / 2.0 - s * 0.12) as i32, eye_y, 2, 3, hex(INK));
    c.rect((s / 2.0 + s * 0.08) as i32, eye_y, 2, 3, hex(INK));
    c.outline(hex(INK));
    c
}

fn bat(size: u32, flap: f32) -> Canvas {
    let s = size as f32;
    let mut c = Canvas::new(size, size);
    let wing = hex(0x5b4a7a);
    let tip_y = (s * (0.25 + 0.3 * flap)) as i32;
    for side in [-1.0f32, 1.0] {
        let tip_x = (s / 2.0 + side * s * 0.45) as i32;
        for i in 0..6 {
            c.line((s / 2.0) as i32, (s * 0.5) as i32 + i / 2, tip_x, tip_y + i, wing, 2);
        }
    }
    c.ellipse(s / 2.0, s * 0.52, s * 0.16, s * 0.18, hex(0x3b2f52), false);
    c.rect((s / 2.0 - 3.0) as i32, (s * 0.48) as i32, 2, 2, hex(0xff5a4a));
    c.rect((s / 2.0 + 1.0) as i32, (s * 0.48) as i32, 2, 2, hex(0xff5a4a));
    c.outline(hex(INK));
    c
}

fn wolf(size: u32) -> Canvas {
    let s = size as f32;
    let mut c = Canvas::new(size, size);
    let fur = hex(0x6b6f5a);
    c.ellipse(s * 0.45, s * 0.62, s * 0.3, s * 0.16, fur, false);
    c.ellipse(s * 0.75, s * 0.48, s * 0.14, s * 0.13, fur, false);
    c.rect((s * 0.7) as i32, (s * 0.3) as i32, 3, 4, fur);
    c.rect((s * 0.8) as i32, (s * 0.3) as i32, 3, 4, fur);
    for x in [0.25f32, 0.38, 0.55, 0.65] {
        c.rect((s * x) as i32, (s * 0.72) as i32, 3, (s * 0.18) as i32, hex(0x4e5242));
    }
    c.line((s * 0.16) as i32, (s * 0.58) as i32, (s * 0.04) as i32, (s * 0.45) as i32, fur, 3);
    c.rect((s * 0.78) as i32, (s * 0.45) as i32, 2, 2, hex(0xf2c94c));
    for i in 0..4 {
        c.put((s * 0.3) as i32 + i * 3, (s * 0.5) as i32, hex(0x3f7a3a));
    }
    c.outline(hex(INK));
    c
}

fn golem(size: u32) -> Canvas {
    let s = size as f32;
    let mut c = Canvas::new(size, size);
    let rock = hex(0x4a4048);
    c.rect((s * 0.25) as i32, (s * 0.3) as i32, (s * 0.5) as i32, (s * 0.45) as i32, rock);
    c.rect((s * 0.35) as i32, (s * 0.14) as i32, (s * 0.3) as i32, (s * 0.18) as i32, rock);
    c.rect((s * 0.08) as i32, (s * 0.34) as i32, (s * 0.17) as i32, (s * 0.36) as i32, hex(0x3b3239));
    c.rect((s * 0.75) as i32, (s * 0.34) as i32, (s * 0.17) as i32, (s * 0.36) as i32, hex(0x3b3239));
    c.rect((s * 0.3) as i32, (s * 0.75) as i32, (s * 0.15) as i32, (s * 0.18) as i32, hex(0x3b3239));
    c.rect((s * 0.55) as i32, (s * 0.75) as i32, (s * 0.15) as i32, (s * 0.18) as i32, hex(0x3b3239));
    let lava = hex(0xff7a1a);
    c.line((s * 0.35) as i32, (s * 0.38) as i32, (s * 0.5) as i32, (s * 0.55) as i32, lava, 2);
    c.line((s * 0.5) as i32, (s * 0.55) as i32, (s * 0.62) as i32, (s * 0.42) as i32, lava, 2);
    c.rect((s * 0.42) as i32, (s * 0.2) as i32, 3, 3, hex(0xffd23f));
    c.rect((s * 0.54) as i32, (s * 0.2) as i32, 3, 3, hex(0xffd23f));
    c.outline(hex(INK));
    c
}

fn skeleton_king(size: u32, crowned: bool) -> Canvas {
    let s = size as f32;
    let mut c = Canvas::new(size, size);
    let bone = hex(0xd9d2bf);
    c.ellipse(s / 2.0, s * 0.32, s * 0.17, s * 0.16, bone, false);
    c.rect((s * 0.44) as i32, (s * 0.46) as i32, (s * 0.12) as i32, (s * 0.3) as i32, bone);
    for i in 0..4 {
        c.rect((s * 0.36) as i32, (s * 0.5) as i32 + i * (size as i32 / 16), (s * 0.28) as i32, 2, bone);
    }
    c.rect((s * 0.42) as i32, (s * 0.3) as i32, 3, 3, hex(0xff5a1f));
    c.rect((s * 0.54) as i32, (s * 0.3) as i32, 3, 3, hex(0xff5a1f));
    c.line((s * 0.36) as i32, (s * 0.52) as i32, (s * 0.2) as i32, (s * 0.75) as i32, bone, 2);
    c.line((s * 0.64) as i32, (s * 0.52) as i32, (s * 0.8) as i32, (s * 0.75) as i32, bone, 2);
    c.line((s * 0.46) as i32, (s * 0.76) as i32, (s * 0.4) as i32, (s * 0.95) as i32, bone, 2);
    c.line((s * 0.54) as i32, (s * 0.76) as i32, (s * 0.6) as i32, (s * 0.95) as i32, bone, 2);
    if crowned {
        let gold = hex(0xe0a526);
        c.rect((s * 0.34) as i32, (s * 0.12) as i32, (s * 0.32) as i32, 3, gold);
        for x in [0.34f32, 0.46, 0.58] {
            c.rect((s * x) as i32, (s * 0.06) as i32, 3, 4, gold);
        }
        c.line((s * 0.82) as i32, (s * 0.2) as i32, (s * 0.82) as i32, (s * 0.9) as i32, hex(0x8a8f99), 2);
    }
    c.outline(hex(INK));
    c
}

/// Item and skill icons, 16 px.
fn icon(kind: &str, a: u32, b: u32) -> Canvas {
    let mut c = Canvas::new(16, 16);
    match kind {
        "potion" => {
            c.ellipse(8.0, 10.5, 4.5, 4.5, hex(a), false);
            c.ellipse(9.5, 11.5, 2.0, 2.0, hex(b), false);
            c.rect(7, 3, 3, 4, hex(0xcfd8dc));
            c.rect(6, 2, 5, 1, hex(0x8d6e63));
            c.put(6, 9, hex(0xffffff));
        }
        "gel" => {
            c.ellipse(8.0, 12.0, 6.0, 6.0, hex(a), true);
            c.ellipse(10.0, 11.0, 2.0, 2.0, hex(b), true);
            c.put(5, 9, hex(0xffffff));
        }
        "wing" => {
            for i in 0..5 {
                c.line(3, 12 - i, 13, 4 + i, hex(if i % 2 == 0 { a } else { b }), 1);
            }
        }
        "gem" => {
            for y in 0..12 {
                let half = if y < 5 { y + 1 } else { 11 - y };
                c.rect(8 - half, 2 + y, half * 2, 1, hex(if y < 5 { b } else { a }));
            }
        }
        "sword" => {
            c.line(4, 12, 12, 4, hex(a), 2);
            c.line(3, 9, 7, 13, hex(0x8d6e63), 2);
            c.line(2, 14, 3, 13, hex(0x5d4037), 2);
            c.put(12, 3, hex(b));
        }
        "shield" => {
            c.ellipse(8.0, 8.0, 6.0, 6.5, hex(a), false);
            c.ellipse(8.0, 8.0, 3.5, 4.0, hex(b), false);
            c.rect(7, 6, 2, 4, hex(0xb0bec5));
        }
        "crown" => {
            c.rect(3, 8, 10, 4, hex(a));
            for x in [3, 7, 11] {
                c.rect(x, 5, 2, 3, hex(a));
            }
            c.put(8, 9, hex(b));
        }
        "bolt" => {
            c.ellipse(10.0, 6.0, 3.5, 3.5, hex(a), false);
            c.line(2, 14, 9, 7, hex(b), 2);
        }
        "nova" => {
            c.ellipse(8.0, 8.0, 7.0, 7.0, hex(a), false);
                        c.ellipse(8.0, 8.0, 2.0, 2.0, hex(b), false);
            // knock the middle back out so it reads as a ring
            for y in 5..11 {
                for x in 5..11 {
                    let (dx, dy) = (x as f32 - 7.5, y as f32 - 7.5);
                    if dx * dx + dy * dy > 4.0 && dx * dx + dy * dy < 12.0 {
                        c.0.put_pixel(x, y, Rgba([0, 0, 0, 0]));
                    }
                }
            }
        }
        "bash" => {
            c.ellipse(7.0, 8.0, 5.0, 5.5, hex(a), false);
            for (x, y) in [(13, 3), (14, 8), (13, 13)] {
                c.line(12, 8, x, y, hex(b), 1);
            }
        }
        _ => c.ellipse(8.0, 8.0, 6.0, 6.0, hex(a), false),
    }
    c.outline(hex(INK));
    c
}

fn tileset(size: u32, ground: u32, accent: u32, seed: u32) -> Canvas {
    let mut c = Canvas::new(size, size);
    let mut r = seed;
    let mut rnd = || {
        r = r.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        (r >> 16) & 0x7fff
    };
    for ty in 0..size / 16 {
        for tx in 0..size / 16 {
            let shade = if (tx + ty) % 2 == 0 { ground } else { ground.saturating_sub(0x0a0a0a) };
            c.rect(tx as i32 * 16, ty as i32 * 16, 16, 16, hex(shade));
        }
    }
    for _ in 0..size * size / 24 {
        let (x, y) = (rnd() % size, rnd() % size);
        c.put(x as i32, y as i32, hex(accent));
    }
    // the remainder of a size that isn't a multiple of 16 stays plain ground
    c
}

fn button(label_color: u32, fill: u32) -> Canvas {
    let mut c = Canvas::new(48, 16);
    c.rect(1, 1, 46, 14, hex(fill));
    c.rect(2, 2, 44, 2, hex(fill).map(|v| v / 2 + 128));
    c.rect(14, 7, 20, 2, hex(label_color));
    c.outline(hex(INK));
    c
}

fn trail(frame: u32) -> Canvas {
    let mut c = Canvas::new(16, 16);
    let x = 4.0 + frame as f32 * 2.0;
    c.ellipse(x, 8.0, 3.0 + frame as f32 * 0.5, 2.5, hex(0xff9a3c), false);
    c.ellipse(x + 1.0, 8.0, 1.5, 1.2, hex(0xfff1a8), false);
    c
}

// ---------------------------------------------------------------- sounds

/// A short 8-bit mono WAV made of square-wave notes: (frequency Hz, ms), 0 Hz is a rest.
fn wav(path: &Path, notes: &[(f32, u32)], noise: bool) -> Result<()> {
    let rate = 11_025u32;
    let mut data = Vec::new();
    let mut seed = 7u32;
    for &(freq, ms) in notes {
        let n = rate * ms / 1000;
        for i in 0..n {
            let fade = 1.0 - i as f32 / n as f32;
            let v = if freq <= 0.0 {
                0.0
            } else if noise {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                ((seed >> 16) & 0xff) as f32 / 128.0 - 1.0
            } else if ((i as f32 * freq / rate as f32) % 1.0) < 0.5 {
                1.0
            } else {
                -1.0
            };
            data.push((128.0 + v * 40.0 * fade) as u8);
        }
    }
    let mut b = Vec::with_capacity(44 + data.len());
    b.extend(b"RIFF");
    b.extend((36 + data.len() as u32).to_le_bytes());
    b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(rate.to_le_bytes());
    b.extend(rate.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(8u16.to_le_bytes());
    b.extend(b"data");
    b.extend((data.len() as u32).to_le_bytes());
    b.extend(data);
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, b).map_err(|e| format!("{}: {e}", path.display()))
}

fn tune(root: f32, steps: &[i32], ms: u32, bars: usize) -> Vec<(f32, u32)> {
    let mut out = Vec::new();
    for _ in 0..bars {
        for &s in steps {
            out.push((if s < -50 { 0.0 } else { root * 2f32.powf(s as f32 / 12.0) }, ms));
        }
    }
    out
}

/// Writes every example asset into `dir`. Existing files with the same names are replaced.
pub fn write_files(dir: &Path) -> Result<()> {
    let p = |rel: &str| dir.join(rel);
    // mobs
    slime(32, 0x7cc35a, 0x5a9a41, 0.0).save(&p("sprites/mobs/moss_slime.png"))?;
    wolf(32).save(&p("sprites/mobs/bramble_wolf.png"))?;
    bat(32, 0.3).save(&p("sprites/mobs/cave_bat.png"))?;
    slime(32, 0xff8a3d, 0xd8572a, 0.0).save(&p("sprites/mobs/ember_slime.png"))?;
    golem(64).save(&p("sprites/mobs/cinder_golem.png"))?;
    skeleton_king(64, true).save(&p("sprites/mobs/the_hollow_king.png"))?;
    // animations: numbered frames and one sprite sheet
    for (i, sq) in [0.0f32, 0.5, 1.0, 0.5].iter().enumerate() {
        slime(32, 0x7cc35a, 0x5a9a41, *sq).save(&p(&format!("animations/moss_slime_idle_{}.png", i + 1)))?;
    }
    for (i, sq) in [(1, 0.0f32), (2, 0.6), (4, 0.3)] {
        slime(32, 0xff8a3d, 0xd8572a, sq).save(&p(&format!("animations/ember_slime_walk_{i}.png")))?;
    }
    let mut sheet = Canvas::new(128, 32);
    for (i, flap) in [0.0f32, 0.4, 0.8, 0.4].iter().enumerate() {
        image::imageops::overlay(&mut sheet.0, &bat(32, *flap).0, i as i64 * 32, 0);
    }
    sheet.save(&p("animations/cave_bat_fly_sheet.png"))?;
    for f in 0..4 {
        trail(f).save(&p(&format!("vfx/fire_bolt_trail_{}.png", f + 1)))?;
    }
    // item icons
    icon("potion", 0xe53935, 0xb71c1c).save(&p("icons/items/health_potion.png"))?;
    icon("potion", 0xe53935, 0xb71c1c).save(&p("icons/items/health_potion_old.png"))?; // a duplicate
    icon("potion", 0x1e88e5, 0x0d47a1).save(&p("icons/items/mana_tonic.png"))?;
    icon("gel", 0x7cc35a, 0xb5e48c).save(&p("icons/items/slime_gel.png"))?;
    icon("wing", 0x5b4a7a, 0x3b2f52).save(&p("icons/items/bat_wing.png"))?;
    icon("gem", 0xff7a1a, 0xffd23f).save(&p("icons/items/ember_core.png"))?;
    icon("sword", 0x9e9e9e, 0xffffff).save(&p("icons/items/rusty_sword.png"))?;
    icon("sword", 0xff7043, 0xffd23f).save(&p("icons/items/ember_blade.png"))?;
    icon("shield", 0x8d6e63, 0x6d4c41).save(&p("icons/items/oak_shield.png"))?;
    icon("crown", 0xe0a526, 0xff5a1f).save(&p("icons/items/Hollow Crown.png"))?; // breaks the naming rule
    // skill icons; Ember Nova was drawn at the wrong size
    icon("bolt", 0xff7a1a, 0xffd23f).save(&p("icons/skills/fire_bolt.png"))?;
    icon("bash", 0x8d6e63, 0xffffff).save(&p("icons/skills/shield_bash.png"))?;
    let nova = icon("nova", 0xff7a1a, 0xffd23f);
    Canvas(image::imageops::resize(&nova.0, 24, 24, image::imageops::FilterType::Nearest)).save(&p("icons/skills/ember_nova.png"))?;
    // tilesets
    tileset(128, 0x3f7a3a, 0x9ccc65, 3).save(&p("tilesets/mosslight_woods_tiles.png"))?;
    tileset(128, 0x3b3239, 0xff7a1a, 9).save(&p("tilesets/cinder_hollow_tiles.png"))?;
    // a rock texture at 100 × 60, which some engines can't mipmap
    Canvas(image::imageops::crop_imm(&tileset(100, 0x4a4048, 0x6d5f6b, 5).0, 0, 0, 100, 60).to_image()).save(&p("textures/cinder_rock_albedo.png"))?;
    // UI buttons; Quit has no disabled state
    for (name, fill) in [("play", 0x43a047), ("options", 0x546e7a), ("quit", 0xc62828)] {
        for (state, f) in [("normal", fill), ("hover", fill + 0x101010), ("pressed", fill - 0x101010), ("disabled", 0x7a7a7a)] {
            if name == "quit" && state == "disabled" {
                continue;
            }
            button(0xffffff, f).save(&p(&format!("ui/buttons/btn_{name}_{state}.png")))?;
        }
    }
    // sounds and music
    wav(&p("sfx/moss_slime_hit.wav"), &[(220.0, 60), (180.0, 80)], false)?;
    wav(&p("sfx/bramble_wolf_howl.wav"), &[(440.0, 200), (520.0, 300), (480.0, 300)], false)?;
    wav(&p("sfx/cave_bat_screech.wav"), &[(1400.0, 90), (1700.0, 90)], false)?;
    wav(&p("sfx/ember_slime_sizzle.wav"), &[(1.0, 400)], true)?;
    wav(&p("sfx/cinder_golem_slam.wav"), &[(1.0, 120), (80.0, 300)], true)?;
    wav(&p("sfx/fire_bolt_cast.wav"), &[(660.0, 50), (880.0, 50), (1.0, 150)], true)?;
    wav(&p("sfx/shield_bash_impact.wav"), &[(1.0, 80), (140.0, 120)], true)?;
    wav(&p("sfx/ui_click.wav"), &[(1000.0, 30)], false)?;
    wav(&p("music/mosslight_woods_theme.wav"), &tune(262.0, &[0, 4, 7, 4, 9, 7, 4, 2, 0, -99, 2, 4, 5, 4, 2, -99], 180, 4), false)?;
    wav(&p("music/cinder_hollow_theme.wav"), &tune(196.0, &[0, 3, 7, 3, 6, 3, 0, -99, 0, 1, 3, 1, 0, -2, 0, -99], 200, 4), false)?;
    fs::write(
        p("README.txt"),
        "Example assets for the Emberfall example project in Asset Forge.\r\nThey were drawn and synthesised by code, so you can use, change or delete them freely.\r\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------- the project

fn ids_where(p: &Project, f: impl Fn(&str) -> bool) -> Result<Vec<String>> {
    Ok(p.list(&AssetQuery { limit: Some(10_000), ..Default::default() })?.assets.into_iter().filter(|a| f(&a.rel_path)).map(|a| a.id).collect())
}

fn patch(p: &mut Project, which: impl Fn(&str) -> bool, status: Option<&str>, tags: &[&str]) -> Result<()> {
    let ids = ids_where(p, which)?;
    p.update(
        &ids,
        &AssetPatch {
            status: status.map(String::from),
            author: Some("Emberfall example".into()),
            license: Some("CC0, made for the example".into()),
            add_tags: tags.iter().map(|t| t.to_string()).collect(),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Requirements left without a link, so the Production page shows suggestions to accept.
const LEAVE_OPEN: [&str; 3] = ["The Hollow King", "Ember Nova", "Bramble Wolf"];

pub fn build(path: &Path, dir: &Path) -> Result<Project> {
    write_files(dir)?;
    let mut p = Project::create(path, NAME)?;
    p.add_folder(dir)?;
    let report = p.scan_all(&|_, _| {})?;
    if !report.errors.is_empty() {
        return Err(report.errors.join("; "));
    }

    // Statuses: most art is done, a few things are still in progress.
    patch(&mut p, |_| true, Some("Approved"), &[])?;
    patch(&mut p, |r| r.contains("fire") || r.contains("ember") || r.contains("cinder"), None, &["fire"])?;
    patch(&mut p, |r| r.starts_with("icons/items/") || r.starts_with("tilesets/mosslight"), Some("Final"), &[])?;
    patch(&mut p, |r| r.contains("ember_slime_walk") || r.contains("cinder_hollow_tiles"), Some("WIP"), &["needs-polish"])?;
    patch(&mut p, |r| r.contains("hollow_king") || r.contains("ember_nova"), Some("Review"), &["boss"])?;
    patch(&mut p, |r| r.contains("health_potion_old") || r.contains("Hollow Crown"), Some("Placeholder"), &[])?;

    // Check settings: snake_case names, so "Hollow Crown.png" is flagged.
    p.set_setting("checks", &serde_json::json!({ "naming": "snakeCase", "maxImagePx": 4096, "maxImageMb": 8.0, "maxSfxMb": 5.0, "maxMusicMb": 30.0, "maxModelMb": 50.0, "powerOfTwo": true }))?;

    // Production: what each Forge Core entry needs, then link the obvious matches.
    requirements::import_codex_text(&p, CODEX, &requirements::default_templates())?;
    for r in requirements::readiness(&p)?.requirements {
        if LEAVE_OPEN.contains(&r.name.as_str()) {
            continue;
        }
        for s in r.slots {
            if s.state == SlotState::Missing {
                if let Some(a) = s.suggestions.first() {
                    requirements::link(&p, &r.id, &s.name, Some(a.id.clone()))?;
                }
            }
        }
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checks::{self, CheckSettings};

    #[test]
    fn builds_a_library_with_checks_and_production() {
        let dir = tempfile::tempdir().unwrap();
        let p = build(&dir.path().join("e.assetforge"), &dir.path().join("assets")).unwrap();
        let facets = p.facets().unwrap();
        assert!(facets.total >= 50, "{}", facets.total);
        for cat in ["Sprite", "Animation", "Icon", "Tileset", "UI", "VFX", "SFX", "Music"] {
            assert!(facets.categories.get(cat).copied().unwrap_or(0) > 0, "no {cat} in {:?}", facets.categories);
        }
        assert!(facets.statuses.len() >= 4, "{:?}", facets.statuses);

        let cfg: CheckSettings = serde_json::from_value(p.setting("checks").unwrap().unwrap()).unwrap();
        let report = checks::run(&p.all().unwrap(), &cfg);
        let found: std::collections::BTreeSet<&str> = report.findings.iter().map(|f| f.check.as_str()).collect();
        for check in ["duplicate", "frames", "sizes", "pot", "states", "naming"] {
            assert!(found.contains(check), "check {check} found nothing: {found:?}");
        }

        let r = requirements::readiness(&p).unwrap();
        assert!(r.total > 20);
        assert!(r.done > r.total / 3, "{} of {}", r.done, r.total);
        assert!(r.done < r.total);
        let king = r.requirements.iter().find(|x| x.name == "The Hollow King").unwrap();
        assert_eq!(king.source_id.as_deref(), Some("emberfall-mob-hollow-king"));
        assert!(king.slots.iter().any(|s| !s.suggestions.is_empty()), "the open boss slots suggest files");
    }
}
