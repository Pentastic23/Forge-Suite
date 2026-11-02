# Forge Suite

Desktop tools for indie game developers, opened from one launcher.

| App | What it does | Status |
| --- | --- | --- |
| **Forge Hub** | Launcher, installer and updater. The only way to open the other apps. | First version (this repo) |
| **Forge Core** | Game Development Codex: lore, quests, zones, mobs, items, skills. | First version |
| **Balance Forge** | Balancing, analysis and simulation of game systems. | First version |
| **Asset Forge** | Asset library, production tracking, checks and engine export. | First version |
| **Pixel Forge** | Sketch-to-pixel-art, rigging, animation and engine export. | First version |

The full plan is in the Forge Suite Blueprint doc.

## Ground rules

- Every app opens only through Forge Hub, which hands it a single-use launch key.
- Apps never depend on each other. They share work by exporting and importing files
  (`.forgecodex`, `.forgebalance`, `.forgeasset`).
- Only Pixel Forge generates content. The other apps organise, analyse and validate.

## Repo layout

```
apps/forge-hub/        Forge Hub (Tauri 2 + React + TypeScript)
apps/forge-core/       Forge Core, the Game Development Codex
apps/balance-forge/    Balance Forge, stat sheets, charts and simulations
apps/asset-forge/      Asset Forge, the asset library, checks and engine export
apps/pixel-forge/      Pixel Forge, sketches to pixel art, rigging, animation and export
apps/forge-suite-mobile/ Forge Suite for Android: every app in one test app
packages/ui/           Shared React components and theme
packages/formats/      Shared file formats (app manifest, exchange files)
crates/launch-guard/   Single-use launch keys (used by Hub and every app)
crates/forge-paths/    Shared folders, such as where project files live
crates/forge-formula/  The formula language used in Balance Forge sheets
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

## Forge Core

```
pnpm core:dev     # needs FORGE_DEV=1 when run outside Forge Hub (see below)
pnpm core:build   # installer in target/release/bundle/nsis/
```

Apps refuse to start unless Forge Hub opened them. While developing, set `FORGE_DEV=1`
to skip that check (debug builds only): in PowerShell, `$env:FORGE_DEV=1; pnpm core:dev`.

To run a built Forge Core through Forge Hub, install it, copy
`apps/forge-core/src-tauri/forge-app.json` next to `Forge Core.exe` (and an `icon.png`),
and make sure that folder is inside one of Forge Hub's app folders.

Each project is one `.forgecore` file (SQLite) in the projects folder. It holds the
entries, tags, links between entries, full version history and a search index.
Exports: `.forgecodex` (for the other Forge apps), JSON (full backup, can be imported),
CSV and Markdown.

## Balance Forge

```
pnpm balance:dev     # needs FORGE_DEV=1 outside Forge Hub, as above
pnpm balance:build
```

Each project is one `.balanceforge` file (SQLite) in the projects folder. It holds:

- **Stat sheets.** Rows of units, weapons or cards with number, text and formula columns.
  Formulas use other columns by key (`damage * attackSpeed`) or by name (`[Attack speed]`),
  plus `min`, `max`, `clamp`, `round`, `if` and more.
- **Analysis.** Cost against power with a trend line that one outlier can't drag, flagging rows
  that look too strong or too weak; power curves by level or tier, flagging spikes and flat spots.
- **Simulations.** One-vs-one duels and everyone-vs-everyone round-robins (up to 100,000 fights
  per pair), and an economy sim of many players earning and spending one currency over time.
  Every run shows its seed, so it can be repeated exactly.
- **Patches.** Snapshots of a sheet, a before/after comparison, and patch notes in Markdown.

Import: `.forgecodex` from Forge Core (one module per sheet; importing again updates those rows
and keeps your own columns). Export: `.forgebalance` (for the other Forge apps) and CSV.
Balance Forge never invents stats, items or mechanics; it only works with what you enter or import.

## Asset Forge

```
pnpm asset:dev       # needs FORGE_DEV=1 outside Forge Hub, as above
pnpm asset:build
```

Each project is one `.assetforge` file (SQLite) in the projects folder. Asset Forge reads
your art, sound and model folders where they are; nothing is copied or uploaded. It holds:

- **Library.** Thumbnails for every file, with filters by category, status, type, folder and tag,
  and search. Rescanning notices new, changed, moved and missing files and keeps a version
  history. Pixel-art previews zoom without blurring; sprite sheets and numbered frames play as
  animations. Status (Placeholder, WIP, Review, Approved, Final), tags, author, licence and notes
  can be set on one file or many.
- **Checks.** Missing and duplicate files, oversized images and sounds, sizes that don't match the
  rest of a set, gaps in numbered frames, incomplete UI states, naming rules, and textures that
  aren't a power of two. It can also read a Unity or Godot project and list assets nothing uses.
- **Production.** Imports a `.forgecodex` from Forge Core and lists the files each mob, item,
  skill and zone needs. Link a file to each slot; a slot is done once its file is Approved or Final.
- **Rename.** Batch rename with patterns, numbering and case, with a preview and one-step undo.
- **Export.** Copies assets into a plain folder, Unity (with pixel-art `.meta` settings for new
  files; existing `.meta` files are never touched), Godot or an Unreal staging folder, with
  optional whole-number upscaling. Presets save an export to run again.

Export for the other Forge apps: `.forgeasset`. Asset Forge never creates or edits art; it only
organises, checks and copies the files you give it.

## Pixel Forge

```
pnpm pixel:dev       # needs FORGE_DEV=1 outside Forge Hub, as above
pnpm pixel:build
```

Each project is one `.pixelforge` file (SQLite) in the projects folder. Pixel Forge is the
remake of Sprite Foundry: its conversion engine is carried over as it was, so every pixel is
computed from the sketch you give it. The one exception is optional AI coloring, which is off
until you turn it on and add your own key.

- **Studio.** Tools on the left, the sprite in the middle, properties on the right and the
  timeline below. A sketch (a photo of paper or any image) has its background removed and
  becomes pixel art at 16, 32, 48, 64 and 128 px, each size with its own rules. Paint touch-ups
  with pencil, eraser, fill, line, box and shade tools (mirror and dither included); remove a
  shadow or color a part right on the sketch. Palettes come from your sketches or a fixed list
  (import `.hex`, `.gpl`, `.txt` or an image), with materials, shade ramps and color variants.
- **Rigging and animation.** Auto-rig for humanoids and creatures, or draw bones by hand, with
  layers and painted weights. Nine preset animations (idle, walk, run, attack, cast, jump, hit,
  death, victory), quick motions, keys with easing, onion skin, and copying an animation to
  another sketch with matching bones.
- **Style.** Style presets, saved style profiles, and Style Training, which measures your own
  finished sprites (palette, outline, shading, light, proportions) and makes them the rules.
- **Library.** Folders (Characters, Enemies, Effects, Buildings, UI, Icons, Animations and your
  own), tags, search and favourites.
- **Export.** One folder or zip with Godot 4 SpriteFrames, Unity sliced sheets and animation
  clips, GameMaker strips, Spine skeletons, PNG sequences and sprite sheet JSON (Phaser,
  Defold, PixiJS), plus the palette, the style profile and a README of import steps.
  Asset Forge can index the exported folder.
- **AI coloring (optional).** In the Sketch tab, turn on "Color sketches with OpenAI" and add
  your own OpenAI API key. It is kept in Windows Credential Manager, never in the project, and
  only sent to OpenAI. "Color this sketch with AI" sends the sketch and your prompt to OpenAI's
  image edit API (`gpt-image-1` by default) and is billed to your account. The colored result is
  kept in the project with the sketch, and you can switch between it and your own sketch at
  any time. For trying the panel without paying, a development build started with
  `PIXELFORGE_AI_MOCK=1` returns the sketch itself instead of calling OpenAI.

## Projects folder

Every app keeps its project files in one shared folder. Choose it in Forge Hub under
Settings, Projects folder; it is saved in `%LOCALAPPDATA%\ForgeSuite\suite.json`, which each
app reads on its own. The `FORGE_PROJECTS_DIR` environment variable overrides it. Until one
is chosen, the default is `Documents\Forge\Projects`. Avoid folders synced by OneDrive, which
can lock a project while it is open.

## Forge Suite for Android (test builds)

`apps/forge-suite-mobile/` puts Forge Core, Balance Forge, Asset Forge and Pixel Forge into
one Android app, for trying them on a phone. Its first screen lists the apps; each app opens
on its own page, zoomed out to fit its desktop layout (turn the phone sideways for a bigger
view), with a round button in the corner to get back. Each app's Rust commands are loaded as
a plugin named after the app id (see `plugin()` in each app's `lib.rs`). Android can't start
one app's program from another, so there are no launch keys here; the desktop apps still
need Forge Hub. Projects are kept inside the app's own storage on the phone.

The **Android test build** workflow builds a signed APK. On a pull request the APK is a
download on the workflow run. On main it also goes to the `android-test` pre-release, so
this link always has the newest build:
<https://github.com/Pentastic23/forge-suite/releases/download/android-test/ForgeSuite-test.apk>.
Each build installs over the last one and keeps your projects. The signing key is explained
in `apps/forge-suite-mobile/android/README.md`.

To build it yourself you need the Android SDK and NDK
([guide](https://v2.tauri.app/start/prerequisites/#android)), then
`pnpm --filter forge-suite-mobile tauri android init` once, and `pnpm android:build`.

## Releases and updates

Each app is released on GitHub with a tag of the form `<app id>-v<version>`, for example
`forge-hub-v0.1.0` or `forge-core-v0.2.0`. Marking a release as a pre-release puts it on the
beta channel. Forge Hub's Updates page reads these releases.

## Checks

```
pnpm typecheck
pnpm test          # TypeScript tests, then cargo test --workspace
```
