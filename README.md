# Forge Suite

Desktop tools for indie game developers, opened from one launcher.

| App | What it does | Status |
| --- | --- | --- |
| **Forge Hub** | Launcher, installer and updater. The only way to open the other apps. | First version (this repo) |
| **Forge Core** | Game Development Codex: lore, quests, zones, mobs, items, skills. | Planned |
| **Balance Forge** | Balancing, analysis and simulation of game systems. | Planned |
| **Asset Forge** | Asset library, production tracking, checks and engine export. | Planned |
| **Pixel Forge** | Doodle-to-pixel-art, rigging and animation. | Planned (remake) |

The full plan is in the Forge Suite Blueprint doc.

## Ground rules

- Every app opens only through Forge Hub, which hands it a single-use launch key.
- Apps never depend on each other. They share work by exporting and importing files
  (`.forgecodex`, `.forgebalance`, `.forgeasset`).
- Only Pixel Forge generates content. The other apps organise, analyse and validate.

## Repo layout

```
apps/forge-hub/        Forge Hub (Tauri 2 + React + TypeScript)
packages/ui/           Shared React components and theme
packages/formats/      Shared file formats (app manifest, exchange files)
crates/launch-guard/   Single-use launch keys (used by Hub and every app)
examples/demo-app/     A stand-in app for testing launches
brand/                 Logos
```

## Running Forge Hub on Windows

One-time setup:

1. Install [Node.js 22](https://nodejs.org/) and run `corepack enable` (this gives you `pnpm`).
2. Install [Rust](https://rustup.rs/).
3. Install the Tauri prerequisites for Windows: the Microsoft C++ Build Tools and WebView2
   ([guide](https://v2.tauri.app/start/prerequisites/)).

Then, in the repo folder:

```
pnpm install
pnpm hub:dev      # opens Forge Hub with live reload
pnpm hub:build    # makes the installer in target/release/bundle/nsis/
```

## Installing an app for Forge Hub to find

Forge Hub scans `%LOCALAPPDATA%\ForgeSuite\apps\` (you can add more folders in Settings).
Each app goes in its own subfolder with a `forge-app.json` next to its `.exe`:

```json
{
  "id": "forge-core",
  "name": "Forge Core",
  "version": "0.1.0",
  "executable": "ForgeCore.exe",
  "description": "Game Development Codex",
  "category": "design",
  "icon": "icon.png",
  "tags": ["lore", "database"],
  "updateSource": "https://github.com/Pentastic23/forge-suite/releases",
  "channel": "stable",
  "accent": "#0197F5"
}
```

### Try it with the demo app

```
cargo build --release -p forge-launch-guard --example demo_app
```

Make the folder `%LOCALAPPDATA%\ForgeSuite\apps\demo-app\`, copy
`target\release\examples\demo_app.exe` and `examples\demo-app\forge-app.json` into it,
then press **Rescan** and **Launch** in Forge Hub. Double-clicking `demo_app.exe` directly
shows that it refuses to start.

## Releases and updates

Each app is released on GitHub with a tag of the form `<app id>-v<version>`, for example
`forge-hub-v0.1.0` or `forge-core-v0.2.0`. Marking a release as a pre-release puts it on the
beta channel. Forge Hub's Updates page reads these releases.

## Checks

```
pnpm typecheck
pnpm test          # TypeScript tests, then cargo test --workspace
```
