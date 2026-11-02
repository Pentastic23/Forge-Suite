use std::fs;
use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

/// The apps whose commands are registered as plugins, named after their app id.
const APPS: [&str; 4] = ["forge-core", "balance-forge", "asset-forge", "pixel-forge"];

/// Reads an app's command names from the `commands!` list in its lib.rs, so the
/// permissions here always match the commands the app registers.
fn commands(app: &str) -> &'static [&'static str] {
    let path = format!("../../{app}/src-tauri/src/lib.rs");
    println!("cargo:rerun-if-changed={path}");
    let source = fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {path}: {e}"));
    let start = source.find("macro_rules! commands").unwrap_or_else(|| panic!("{path} has no commands! list"));
    let list = &source[start..];
    let open = list.find("generate_handler![").expect("generate_handler! in commands!") + "generate_handler![".len();
    let close = open + list[open..].find(']').expect("end of commands! list");
    let names: Vec<&'static str> = list[open..close]
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| &*Box::leak(n.to_string().into_boxed_str()))
        .collect();
    assert!(!names.is_empty(), "{path}: commands! list is empty");
    Box::leak(names.into_boxed_slice())
}

fn main() {
    let mut attributes = Attributes::new();
    for app in APPS {
        attributes = attributes.plugin(
            app,
            InlinedPlugin::new().commands(commands(app)).default_permission(DefaultPermissionRule::AllowAllCommands),
        );
    }
    tauri_build::try_build(attributes).expect("failed to run the Tauri build script");
}
