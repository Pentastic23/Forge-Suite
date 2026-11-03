//! The Emberfall example project: the same small made-up action RPG every Forge
//! app opens. Here it is a project brief, the Emberfall codex as the assistant's
//! background, a few finished chats to read, and a palette and a block-out
//! model in the library. Everything in it is written or drawn by this code;
//! nothing was made by an AI service.

use std::path::PathBuf;

use crate::store::{NewAsset, Project};
use crate::{codex, images, mesh, projects};

pub const CODEX: &str = include_str!("../../../../examples/emberfall/codex.json");
const FILE_STEM: &str = "Emberfall Example";
pub const NAME: &str = "Emberfall (example)";

pub fn path() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM}.{}", projects::EXTENSION))
}

const CHATS: [(&str, &str, &[(&str, &str)]); 3] = [
    (
        "Cave Bat swoop in Godot",
        "code",
        &[
            ("user", "The Cave Bat should hang from the ceiling, then swoop at the player when they walk underneath and fly back up. How would I do that in Godot 4?"),
            ("assistant", "A small state machine on a `CharacterBody2D` does it. The bat waits, dives towards where the player *was* (so it can be dodged), then climbs back to its perch.\n\n```gdscript\nextends CharacterBody2D\n\nenum State { PERCHED, SWOOP, RETURN }\n\n@export var swoop_speed := 260.0\n@export var return_speed := 120.0\n@export var trigger_width := 48.0\n\nvar state := State.PERCHED\nvar perch: Vector2\nvar target: Vector2\n\n@onready var player := get_tree().get_first_node_in_group(\"player\") as Node2D\n\nfunc _ready() -> void:\n\tperch = global_position\n\nfunc _physics_process(_delta: float) -> void:\n\tmatch state:\n\t\tState.PERCHED:\n\t\t\tif player and absf(player.global_position.x - perch.x) < trigger_width and player.global_position.y > perch.y:\n\t\t\t\ttarget = player.global_position\n\t\t\t\tstate = State.SWOOP\n\t\tState.SWOOP:\n\t\t\tvelocity = global_position.direction_to(target) * swoop_speed\n\t\t\tif global_position.distance_to(target) < 6.0 or is_on_floor():\n\t\t\t\tstate = State.RETURN\n\t\tState.RETURN:\n\t\t\tvelocity = global_position.direction_to(perch) * return_speed\n\t\t\tif global_position.distance_to(perch) < 2.0:\n\t\t\t\tglobal_position = perch\n\t\t\t\tvelocity = Vector2.ZERO\n\t\t\t\tstate = State.PERCHED\n\tmove_and_slide()\n```\n\n- Put the player in a group called `player`.\n- Play your `idle` animation while perched and `fly` in the other two states.\n- The codex calls the bat *fast and fragile*, so give it 1 or 2 hit points and let one sword hit knock it out of the swoop."),
        ],
    ),
    (
        "A mini-boss for Mosslight Woods",
        "design",
        &[
            ("user", "Mosslight Woods has no boss before the player reaches Cinder Hollow. Give me three ideas that fit the lore."),
            ("assistant", "Here are three that use what the codex already has, so they teach something the Hollow will test later.\n\n1. **The Bramble Matriarch.** The wolves hunt in pairs at night; she is the reason. A larger Bramble Wolf that calls a pair of pups when hurt. Teaches the player to deal with adds before the Cinder Golem.\n2. **The Glutton Slime.** A Moss Slime that has been eating the gel Bram never collected. It splits into smaller slimes at half health. Rewards a stack of Slime Gel, which ties into *Gel for the Alchemist*.\n3. **The First Spark.** The thing Lysa sends you to find in *A Spark in the Woods*: a small ember creature that set the woods alight. It leaves burning trails like the Ember Slime and introduces fire before you see much of it.\n\nThe First Spark fits the story best: it answers the opening quest and foreshadows the ember. Want stats for it to try in Balance Forge?"),
        ],
    ),
    (
        "Prompt for the Ember Blade icon",
        "art",
        &[
            ("user", "Write me an image prompt for the Ember Blade inventory icon, matching our 32 px pixel art style."),
            ("assistant", "Here is a prompt to paste into **Images**:\n\n```text\nPixel art inventory icon of a short sword forged around a glowing ember core, orange and gold blade with a dark iron hilt, small sparks, centered on a transparent background, 32x32 pixel style, limited palette, crisp 1 px dark outline, no text\n```\n\nTips:\n- Turn on **Transparent background** so it drops straight into your inventory grid.\n- Generate at 1024 px, then let Pixel Forge bring it down to 32 px with your palette."),
        ],
    ),
];

/// Emberfall's colors as four big swatches.
fn palette_png() -> Vec<u8> {
    let colors: [[u8; 4]; 4] = [[0x2b, 0x1d, 0x3a, 255], [0x5d, 0x9b, 0x4f, 255], [0xf0, 0x7d, 0x2c, 255], [0xf6, 0xd0, 0x5c, 255]];
    let (w, h) = (256u32, 64u32);
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for _y in 0..h {
        for x in 0..w {
            rgba.extend_from_slice(&colors[(x / 64) as usize]);
        }
    }
    images::encode_png(w, h, &rgba)
}

/// Fills a new, empty project with the example.
pub fn fill(p: &Project) -> Result<(), String> {
    p.set_setting(
        "brief",
        &serde_json::json!({
            "game": "Emberfall",
            "genre": "Top-down action RPG",
            "engine": "godot",
            "artStyle": "32 px pixel art, dark navy outlines, warm ember colors against a mossy green forest",
            "notes": "Short game (about 3 hours). Three zones: Mosslight Woods, Cinder Hollow and the Sunken Spire. The player is Warden Lysa Thorne's apprentice.",
            "useCodex": true
        }),
    )?;
    let c = codex::from_json(CODEX)?;
    p.set_setting("codex", &serde_json::to_value(&c).map_err(|e| e.to_string())?)?;
    for (title, mode, msgs) in CHATS {
        let id = p.create_chat(title, mode)?;
        for (role, text) in msgs.iter() {
            p.add_message(id, role, text, if *role == "assistant" { "example" } else { "" })?;
        }
    }
    let png = palette_png();
    p.add_asset(&NewAsset { kind: "image", name: "Emberfall palette", prompt: "Drawn by code for the example", source: "Example", mime: "image/png", data: &png, thumb: None, folder: "Images" })?;
    let glb = mesh::cube_glb([0.55, 0.36, 0.2, 1.0]);
    let thumb = images::test_png("Supply crate");
    p.add_asset(&NewAsset {
        kind: "model",
        name: "Supply crate (block-out)",
        prompt: "Drawn by code for the example",
        source: "Example",
        mime: "model/gltf-binary",
        data: &glb,
        thumb: Some(&thumb),
        folder: "3D models",
    })?;
    p.log("Example", "Filled with the Emberfall example")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_example() {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("e.aiforge"), NAME).unwrap();
        fill(&p).unwrap();
        assert_eq!(p.chats().unwrap().len(), 3);
        assert_eq!(p.assets().unwrap().len(), 2);
        assert_eq!(p.setting("codex").unwrap().unwrap()["entries"].as_array().unwrap().len(), 32);
        assert_eq!(p.setting("brief").unwrap().unwrap()["engine"], "godot");
    }
}
