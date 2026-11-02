fn main() {
    // On Android and iOS this crate is only a library of commands inside Forge Suite
    // mobile (see `plugin()` in lib.rs), which does the Tauri build steps itself.
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target == "android" || target == "ios" {
        return;
    }
    tauri_build::build()
}
