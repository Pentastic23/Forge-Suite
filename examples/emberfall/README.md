# Emberfall, the example game

Every Forge app has an **Open example** button on its start screen. They all open the same
small made-up action RPG, Emberfall, so you can see what each app does and how work passes
between them. Everything in it is invented and drawn by code; use it, change it or delete it.

`codex.json` is the shared source: a Forge Core export (the same JSON that sits inside a
`.forgecodex`) with 32 linked entries: lore, zones, mobs, items, skills and quests. Every
entry has a fixed id (`emberfall-mob-cave-bat`...), so the examples line up across apps.

| App | What the example holds |
| --- | --- |
| Forge Core | The 32 entries with their links, tags and an earlier version of the Cinder Golem. It also writes `Emberfall Example.forgecodex` next to the project, to try importing by hand. |
| Balance Forge | Mobs and Items sheets imported from the codex (rows keep the Forge Core ids) with DPS, effective HP, power and XP formulas; a hand-made Weapons sheet where Frost Dagger is too strong and Greatsword of Ash too weak; a Patch 0.1 snapshot to compare; an economy setup ready to run. |
| Asset Forge | An `Emberfall Example Assets` folder of sprites, frames, icons, tilesets, UI, sounds and music; statuses and tags; production requirements imported from the codex with most slots linked. Checks find a duplicate, a frame gap, an icon of the wrong size, a texture that isn't a power of two, a button without a disabled state and a file name with spaces. |
| AI Forge | A project brief (top-down action RPG in Godot 4, 32 px pixel art), the codex's 32 entries as the assistant's background, three finished chats (the Cave Bat's swoop in GDScript, a mini-boss for Mosslight Woods, an image prompt for the Ember Blade icon), the Emberfall palette and a block-out crate model in the library. The chats were written by hand, not by an AI service. |
| Pixel Forge | Sketches of Warden Lysa (auto-rigged, all nine preset animations), the moss and ember slimes, the cave bat, a fire bolt, a health potion and the mushroom buddy, in library folders with tags. |

Each example is made the first time you open it, as `Emberfall Example.<extension>` in the
projects folder. Opening it again opens your copy; delete the file to start over.
