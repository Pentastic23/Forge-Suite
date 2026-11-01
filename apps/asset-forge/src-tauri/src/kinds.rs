//! What a file is: its file type from the extension, and a production
//! category (sprite, icon, SFX...) guessed from its folder and name. The
//! guess is plain rules on words, so it is predictable and easy to override.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    Image,
    Audio,
    Model,
    Shader,
    Font,
    Video,
    Data,
    Other,
}

impl FileType {
    pub fn as_str(self) -> &'static str {
        match self {
            FileType::Image => "image",
            FileType::Audio => "audio",
            FileType::Model => "model",
            FileType::Shader => "shader",
            FileType::Font => "font",
            FileType::Video => "video",
            FileType::Data => "data",
            FileType::Other => "other",
        }
    }
}

pub fn file_type(ext: &str) -> FileType {
    match ext.to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tga" | "webp" | "psd" | "aseprite" | "ase" | "kra" | "xcf" | "svg" | "tif" | "tiff"
        | "exr" | "hdr" | "dds" | "ktx" | "ktx2" | "qoi" | "ico" | "pdn" => FileType::Image,
        "wav" | "ogg" | "mp3" | "flac" | "aif" | "aiff" | "opus" | "m4a" => FileType::Audio,
        "fbx" | "obj" | "gltf" | "glb" | "blend" | "dae" | "3ds" | "stl" | "vox" | "ply" => FileType::Model,
        "shader" | "gdshader" | "hlsl" | "glsl" | "frag" | "vert" | "shadergraph" | "cginc" | "usf" | "ush" | "wgsl" => FileType::Shader,
        "ttf" | "otf" | "fnt" | "woff" | "woff2" => FileType::Font,
        "mp4" | "webm" | "mov" | "avi" | "ogv" => FileType::Video,
        "json" | "xml" | "csv" | "tres" | "tsx" | "tmx" | "ldtk" | "anim" | "controller" | "atlas" | "plist" => FileType::Data,
        _ => FileType::Other,
    }
}

/// Files and folders the library never indexes: engine bookkeeping and system junk.
pub fn ignored(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || matches!(lower.as_str(), "thumbs.db" | "desktop.ini" | "library" | "temp" | "obj" | "build" | "builds" | "logs" | "intermediate" | "saved" | "deriveddatacache")
        || lower.ends_with(".meta")
        || lower.ends_with(".import")
        || lower.ends_with(".tmp")
        || lower.ends_with('~')
}

pub const CATEGORIES: &[&str] = &["Sprite", "Animation", "Tileset", "Icon", "UI", "Texture", "VFX", "SFX", "Music", "Model", "Shader", "Font", "Video", "Data", "Other"];

/// Splits "UI/Buttons/btn_PlayHover-2.png" into lowercase words: ui, buttons, btn, play, hover, 2, png.
pub fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if c.is_uppercase() && prev_lower && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = c.is_lowercase() || c.is_ascii_digit();
            cur.extend(c.to_lowercase());
        } else {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn has(words: &[String], keys: &[&str]) -> bool {
    words.iter().any(|w| keys.iter().any(|k| w == k || (k.len() > 3 && w.starts_with(k))))
}

/// Production category from the path (folders and file name) and file type.
/// `duration_ms` helps tell music from sound effects.
pub fn guess_category(rel_path: &str, ft: FileType, duration_ms: Option<u64>, size: u64) -> &'static str {
    let w = words(rel_path);
    match ft {
        FileType::Audio => {
            if has(&w, &["music", "bgm", "ost", "theme", "soundtrack", "song", "loop"]) && !has(&w, &["sfx"]) {
                "Music"
            } else if has(&w, &["sfx", "sound", "sounds", "fx", "hit", "click", "step"]) {
                "SFX"
            } else {
                match duration_ms {
                    Some(d) if d >= 30_000 => "Music",
                    Some(_) => "SFX",
                    None if size > 1_500_000 => "Music",
                    None => "SFX",
                }
            }
        }
        FileType::Image => {
            if has(&w, &["icon", "icons", "ico"]) {
                "Icon"
            } else if has(&w, &["ui", "hud", "gui", "button", "buttons", "btn", "menu", "panel", "cursor"]) {
                "UI"
            } else if has(&w, &["tile", "tiles", "tileset", "tilesets", "tilemap", "terrain"]) {
                "Tileset"
            } else if has(&w, &["vfx", "fx", "particle", "particles", "effect", "effects", "explosion", "smoke"]) {
                "VFX"
            } else if has(&w, &["anim", "animation", "animations", "walk", "run", "idle", "attack", "sheet", "spritesheet"]) {
                "Animation"
            } else if has(&w, &["texture", "textures", "tex", "material", "materials", "normal", "albedo", "roughness"]) {
                "Texture"
            } else {
                "Sprite"
            }
        }
        FileType::Model => "Model",
        FileType::Shader => "Shader",
        FileType::Font => "Font",
        FileType::Video => "Video",
        FileType::Data => {
            if has(&w, &["anim", "animation", "controller"]) {
                "Animation"
            } else if has(&w, &["tile", "tileset", "tilemap", "tmx", "tsx", "ldtk"]) {
                "Tileset"
            } else {
                "Data"
            }
        }
        FileType::Other => "Other",
    }
}

/// Tags taken from folder names, like "characters" or "forest". Generic
/// folder names (assets, art, sprites...) are left out.
pub fn folder_tags(rel_path: &str) -> Vec<String> {
    const SKIP: &[&str] = &["assets", "asset", "art", "res", "resources", "content", "src", "source", "export", "exports", "final", "files", "game", "data", "new", "old"];
    let parts: Vec<&str> = rel_path.split(['/', '\\']).collect();
    let mut out: Vec<String> = Vec::new();
    for folder in parts.iter().take(parts.len().saturating_sub(1)) {
        let t = folder.trim().to_lowercase().replace(' ', "-");
        if t.len() >= 2 && t.len() <= 32 && !SKIP.contains(&t.as_str()) && !t.chars().all(|c| c.is_ascii_digit()) && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NamingRule {
    None,
    SnakeCase,
    KebabCase,
    PascalCase,
    CamelCase,
}

/// Why a file name (without extension) breaks the rule, if it does.
pub fn naming_problem(stem: &str, ext: &str, rule: NamingRule) -> Option<String> {
    if stem.contains(' ') {
        return Some("has spaces".into());
    }
    if !stem.is_ascii() {
        return Some("has non-English letters, which some engines and build tools mangle".into());
    }
    if ext.chars().any(|c| c.is_uppercase()) {
        return Some("extension is in capitals".into());
    }
    let ok = |c: char| c.is_ascii_alphanumeric();
    let fine = match rule {
        NamingRule::None => true,
        NamingRule::SnakeCase => stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
        NamingRule::KebabCase => stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
        NamingRule::PascalCase => stem.chars().next().is_some_and(|c| c.is_ascii_uppercase()) && stem.chars().all(ok),
        NamingRule::CamelCase => stem.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && stem.chars().all(ok),
    };
    if fine {
        None
    } else {
        Some(
            match rule {
                NamingRule::SnakeCase => "isn't snake_case",
                NamingRule::KebabCase => "isn't kebab-case",
                NamingRule::PascalCase => "isn't PascalCase",
                NamingRule::CamelCase => "isn't camelCase",
                NamingRule::None => unreachable!(),
            }
            .into(),
        )
    }
}

/// Rewrites a name in the given case: "Walk Cycle 02" -> "walk_cycle_02".
pub fn to_case(stem: &str, rule: NamingRule) -> String {
    let w = words(stem);
    if w.is_empty() {
        return stem.to_string();
    }
    let cap = |s: &str| {
        let mut c = s.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    };
    match rule {
        NamingRule::None => stem.to_string(),
        NamingRule::SnakeCase => w.join("_"),
        NamingRule::KebabCase => w.join("-"),
        NamingRule::PascalCase => w.iter().map(|x| cap(x)).collect(),
        NamingRule::CamelCase => w.iter().enumerate().map(|(i, x)| if i == 0 { x.clone() } else { cap(x) }).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_and_categories() {
        assert_eq!(file_type("PNG"), FileType::Image);
        assert_eq!(file_type("ogg"), FileType::Audio);
        assert_eq!(file_type("xyz"), FileType::Other);
        assert_eq!(guess_category("UI/Buttons/btn_play.png", FileType::Image, None, 0), "UI");
        assert_eq!(guess_category("items/icons/sword.png", FileType::Image, None, 0), "Icon");
        assert_eq!(guess_category("characters/knight_walk_01.png", FileType::Image, None, 0), "Animation");
        assert_eq!(guess_category("characters/knight.png", FileType::Image, None, 0), "Sprite");
        assert_eq!(guess_category("audio/forest_theme.ogg", FileType::Audio, None, 0), "Music");
        assert_eq!(guess_category("audio/sword_swing.wav", FileType::Audio, Some(800), 0), "SFX");
        assert_eq!(guess_category("audio/ambience.wav", FileType::Audio, Some(95_000), 0), "Music");
    }

    #[test]
    fn word_splitting() {
        assert_eq!(words("UI/Buttons/btn_PlayHover-2.png"), ["ui", "buttons", "btn", "play", "hover", "2", "png"]);
        assert_eq!(words("HUD"), ["hud"]);
    }

    #[test]
    fn folder_tags_skip_generic_names() {
        assert_eq!(folder_tags("Art/Characters/Forest Elves/elf.png"), ["characters", "forest-elves"]);
        assert!(folder_tags("hero.png").is_empty());
    }

    #[test]
    fn naming() {
        assert_eq!(naming_problem("knight_walk_01", "png", NamingRule::SnakeCase), None);
        assert_eq!(naming_problem("Knight Walk", "png", NamingRule::None).unwrap(), "has spaces");
        assert!(naming_problem("KnightWalk", "png", NamingRule::SnakeCase).unwrap().contains("snake"));
        assert!(naming_problem("knight", "PNG", NamingRule::None).is_some());
        assert_eq!(naming_problem("KnightWalk", "png", NamingRule::PascalCase), None);
        assert_eq!(to_case("Knight Walk 01", NamingRule::SnakeCase), "knight_walk_01");
        assert_eq!(to_case("knight_walk_01", NamingRule::PascalCase), "KnightWalk01");
        assert_eq!(to_case("knight-walk", NamingRule::CamelCase), "knightWalk");
    }
}
