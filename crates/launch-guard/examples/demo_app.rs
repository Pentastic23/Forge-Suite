//! A tiny stand-in app for trying Forge Hub's launch key by hand.
//!
//! Build:  cargo build --release -p forge-launch-guard --example demo_app
//! Then copy target/release/examples/demo_app.exe and examples/demo-app/forge-app.json
//! into %LOCALAPPDATA%\ForgeSuite\apps\demo-app\ and press Launch in Forge Hub.
//! Double-clicking the .exe directly shows the refusal instead.

use std::io::Read;

fn main() {
    match forge_launch_guard::verify_from_env("demo-app") {
        Ok(()) => println!("Demo app started from Forge Hub. The launch key checked out."),
        Err(e) => println!("Demo app refused to start: {e}"),
    }
    println!("Press Enter to close.");
    let _ = std::io::stdin().read(&mut [0u8]);
}
