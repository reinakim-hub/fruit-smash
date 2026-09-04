# Game Spec

## Goal
Build a simple browser puzzle game inspired by the core mechanics of Pixel Flow.

Use original placeholder graphics only. Do not copy original game assets, characters, sounds, logo, or level data.

## Core Gameplay
- A board contains colored pixels arranged in a grid, forming a recognizable pixel-art image (see Level below).
- A queue of colored pigs waits to be sent onto the conveyor (see Queue below).
- Clicking a pig does not shoot directly. It only sends that pig onto the conveyor.
- Up to **5 pigs can be active on the conveyor at once** (`ACTIVE_CAPACITY`). While fewer than 5 are active, clicking a dispatchable pig always succeeds immediately.
- Every active pig moves and acts **independently and simultaneously** - there is no shared turn order, no "front" pig, and no pig ever waits its turn behind another. Each tick, every active pig independently: resolves its previous shot if one is in flight, looks for a new reachable target, fires if it finds one, and always continues moving. One pig shooting, running out of ammo, or finishing a lap never pauses or otherwise affects any other active pig.
- There is no separate "Active" list UI - the active pigs are visible directly on the conveyor belt around the board, which is the only place they're shown.

## Level (Pixel Art)
- Every level's grid and its pig queue stay mathematically consistent with each other. Most maps (Orange, Watermelon, Lemon, Grapes) are generated in code (`src/game/level.js`), not hand-typed. Strawberry is a static, hand-authored tile map (`src/game/strawberry_static_map.js`) instead, since its diagonal-gradient background (below) is easier to author directly than to derive from a silhouette formula.
- Every board is a 36×34 grid of individually removable tiles - there are no multi-cell sprites, and (as of the Strawberry map) no unplayable gaps either: **every cell on the board, including the background around the artwork, is a real, removable, targetable tile.** A background tile participates in targeting, ammo, progress, and the win condition exactly like any other tile - nothing about it is special-cased.
- A background (where a map has empty space around its artwork) uses a small diagonal gradient of 3-4 related shades, distinct from the artwork's own palette so the artwork stays the visual focus.
- **No tile color is pure white** - even the brightest highlight tone is a clearly tinted cream/peach/pink so it never disappears against the board's own background.
- **Ammo is generated in clean tens only, from 10 to 30 (10, 20, or 30 - never anything like 15 or 25, and never above 30).** Every color's total tile count is itself an exact multiple of 10 (a few tip/background cells are trimmed to guarantee this, and any color's leftover-under-10 remainder is folded into a majority fallback color), which is what makes exact tens-only chunking possible at all.
- The pig queue is generated automatically from the grid's own per-color tile counts, split into those 10-30 ammo chunks (any total that's a multiple of 10 can always be built from chunks of 1-3 tens) and interleaved round-robin so the queue isn't one long run per color. This guarantees, by construction, that **total pig ammo for a color always exactly equals that color's total tile count** - the level can always be fully cleared with zero ammo or tiles left over for any color.

## Conveyor
- A rectangular conveyor loop, with a visible tiled belt graphic, surrounds all four sides of the pixel grid. The belt's diagonal stripe pattern continuously scrolls, matching the direction pigs actually travel on each side: **bottom scrolls right, right scrolls up, top scrolls left, left scrolls down.** Pigs are drawn on top of it.
- Every pig enters at the same fixed starting point: the beginning of the bottom side, at the leftmost column.
- It travels counterclockwise around the loop: **bottom → right → top → left → exit**, one grid-cell-width step per movement tick (this integer step, `unit.step`, is the pig's one and only logical position - it drives targeting, the rendered position, and every projectile's origin, so all three can never disagree).
- **Movement and shooting are independent, so conveyor speed is never tied to shooting speed.** A pig's step advances as real time passes, with zero pause for firing. A shot's own resolve delay is timed from the projectile's real flight-animation time (`PROJECTILE_MS`), so a shot always takes the same real amount of time to land and spend its ammo no matter how fast the pig glides between positions.
- **One source of truth for timing:** a full lap takes `CONVEYOR_LOOP_MS` (~3 seconds). `src/game/conveyor.js` computes, once, exactly how many real milliseconds each individual step's glide takes (`STEP_DURATIONS_MS`, sized from the loop's real perimeter at a constant px/s speed) - both the game logic (which only advances a pig, and re-scans, once that many real ms have actually elapsed) and the renderer (which sets that same duration as the shooter's CSS transition) read this one array, so logical position and rendered position can never drift apart. Speed stays even on every side and through every corner (a corner step covers more physical distance, so it takes proportionally longer - never a snap, never the logic racing ahead of a still-mid-corner shooter, and never a burst of speed).
- The pig's on-screen position is always constrained to the rectangular conveyor path itself, driven by a single continuous progress value (real distance travelled around the rectangle) via a CSS motion path - never tweened directly toward whatever pixel it's about to shoot. It only ever slides along straight rails and turns cleanly at the four corners, never diagonally, never zigzagging between targets. Shooting never changes a pig's conveyor position - only its projectiles cross toward their targets.
- **Non-overlapping shooters:** every active pig is assigned a `lane` (one of up to `ACTIVE_CAPACITY` distinct slots, the lowest one not already used by another currently-active pig) the moment it's dispatched or reactivated, kept for its whole run. Its lane gives it a small fixed sideways nudge **perpendicular to the belt** - never forward/backward along the path, so it can never change which row/column it's aligned with or desync its visible position from its targeting position. With up to 5 pigs active at once, this guarantees none of them ever visually overlap. Any projectile a pig fires uses that same lane's nudge, so it always visibly originates from exactly where that pig is drawn.
- A pig may travel around the conveyor loop **at most one continuous lap**. Every step of that lap, including the last one, still gets a full targeting scan before anything finalizes. If it runs out of ammo, it's removed immediately, wherever it is - but only once every shot it fired has actually resolved. If it completes the lap with ammo still remaining and nothing left in flight, it exits to Holding - it never starts a second lap in the same continuous run. (A pig later resumed from Holding gets its own fresh run, re-entering at the same fixed starting point, and is likewise limited to one lap per run.)

## Shot Targeting - aligned single-file scanning
- A pig only ever looks along the **single row or column exactly aligned with its current conveyor position** (its current column on bottom/top, its current row on left/right) - it never searches the rest of that side, or the board at large. Within that one line, only the single **nearest remaining pixel** - the outermost exposed layer - is visible to it; anything stacked behind that pixel is completely hidden and can never be targeted while the outer pixel is still there. Removing it is what exposes whatever was immediately behind it, on a later scan.
- If that line's nearest exposed pixel matches the pig's color and isn't already claimed by another in-flight shot, the pig fires a single projectile at it. It never targets a pixel that isn't aligned with its current x/y position, and never a pixel with something still in front of it.
- Firing **reserves** the targeted pixel (so no other pig's projectile can also claim it, and it keeps blocking its row/column exactly like any other pixel until it's actually destroyed) and starts the projectile's flight animation; the ammo cost and the pixel's actual removal happen together, once the projectile actually reaches it - a tile is always visible up until that exact moment, never removed early.
- The pig keeps moving forward every tick with **no delay from firing** - it never pauses movement to wait for a shot to resolve, and immediately scans the next aligned line as it advances, firing again right away if that line also has a matching exposed pixel (up to its remaining ammo, counting shots still in flight). Because a single pass rarely spends all of a pig's ammo, most pigs need to be relaunched from Holding several times to fully use their ammo - this is expected, not a bug.

## Shot Resolution (timing)
- A projectile is a small, clearly visible **white circular dot** (never a static line, and never tinted by the shooter's color) - rendered above the board, belt, and every pig (always the topmost thing on screen, `z-index` above conveyor units and tiles). It starts at the firing pig's actual visible position (including its perpendicular overlap-offset, if any) and animates to its target over a short, clearly-timed flight (`PROJECTILE_MS`, ~200ms) - independent of the pig's own continued movement, which never pauses or slows down while any number of projectiles are in flight.
- Because "ammo spent" and "pixel removed" always happen together as a single atomic step per projectile, a color's total ammo and total remaining pixels can never drift apart - there is never leftover ammo with no pixel to spend it on, or a leftover pixel nothing can reach.
- A pig only leaves the conveyor (out of ammo) or advances into Holding (lap complete) *after* every one of its own in-flight projectiles has resolved - never before.
- A debug validation (`colorBalance` in `src/game/logic.js`, logged to the console whenever it changes) reports remaining pixels and remaining ammo by color, so the two can be visually verified to always match and to reach zero together when the level clears. In dev builds, `validateLevelDev()` (runs once at module load, dev-only, never affects real gameplay) additionally checks that every pig's ammo is 10/20/30 and that per-color ammo/pixel totals match, and runs a lightweight greedy auto-play against the real game logic to warn in the console if a level looks like it might soft-lock rather than fully clear.

## Holding Area
- A pig that completes a full conveyor lap with ammo still remaining moves into the holding area.
- The holding area has 5 slots.
- **A pig in Holding requires manual player activation - it is never resumed automatically.** It stays there, untouched, with its remaining ammo exactly as it was the instant it parked, for as long as the player leaves it alone: no ammo is spent and no shooting happens while a pig is in Holding.
- Clicking a Holding pig sends it back onto the conveyor (re-entering at the fixed starting point, for its own fresh one-lap run) with its remaining ammo carried over unchanged, but only if an active conveyor slot is actually free (Active < 5). If Active is already 5/5, clicking a Holding pig does nothing.
- **Holding 5/5 is a warning, not Game Over.** Reaching 5/5 shows a clear, obvious danger state (a red border/highlight on the Holding area and its status chip) but is purely informational - it never blocks or pauses gameplay, and Holding pigs stay fully clickable while it's showing. Game Over is only actually triggered separately, at the moment a 6th pig needs to enter Holding while all 5 slots are still full.
- **The 6th pig is briefly shown, not silently dropped.** At that exact moment, a temporary 6th, bright-red/danger-styled slot renders next to the normal 5 (with the status chip reading "Holding 6/5") holding the pig that couldn't find room, so the player can see exactly which pig caused the loss. This never permanently increases Holding's real capacity - after a brief pause, the Game Over overlay appears as normal.

## Queue
- The queue is **3 persistent column stacks**, assigned once when the level is built and stored as that shape in state (`state.queue` is an array of 3 arrays) - never a flat list re-split by index on every render. A pig's column never changes for its whole time in the queue.
- Only the **top pig of each column** (index 0) is clickable; every pig beneath it is visible but locked (dimmed/muted) until it becomes its column's top.
- When the top pig of a column is dispatched, only that column shifts up by one slot - the other two columns are completely untouched: they never move, reorder, or renumber just because a different column was used.

## Layout / UI
- The game is a single self-contained panel: the pixel-art board and its conveyor belt are the visually dominant element on the left/center; a compact side panel on the right holds the title, level name, Restart, a pixels-left progress bar, a compact status readout, Holding, and the Queue.
- The status readout is two small chips - "Active X/5" and "Holding Y/5" - placed together so both counts are easy to scan at a glance. This is status text only, not a list: there is no separate "Active pigs" list anywhere in the UI - active pigs are only ever shown moving on the conveyor itself.
- **The side panel's size is fixed** (pinned to the board's height) and never resizes or jumps as the game progresses - not as the queue is spent down, not as Holding fills or empties. The queue area reserves enough space for the full initial queue; once pigs are spent and the visible queue gets shorter, the freed space stays empty rather than the panel collapsing. If the queue's content is ever taller than its reserved area, only that area scrolls internally - the rest of the panel (progress, status chips, Holding, Restart) stays in a fixed position throughout.
- Sized to fit comfortably within a normal desktop viewport (targeting 1440×900, usable down to about 1366×768) with everything - header, full board, full conveyor, Holding, and the full queue - visible without vertical scrolling.
- Visual theme: bright, playful, fruit-pixel-art styled - warm cream/peach page background, rounded white cards, a tan diagonal-stripe conveyor belt, and bright strawberry-red/leaf-green accent colors throughout the UI (buttons, progress bar, panels). The board's own background/gap color is a soft tinted peach (never near-white) so light tile colors stay visible against it.
- The Win/Game Over overlay is a fullscreen fixed backdrop with a high `z-index`, always rendered above the board, tiles, conveyor, shooters, projectiles, and the side panel - nothing can visually cover it.

## Win
The player wins when all pixels are cleared.

Show:
"You Win!"

Add a Restart button.

## Lose
Show:
"Game Over"

Add a Restart button.

## MVP
For now:
- 5 selectable fruit maps (Strawberry, Orange, Watermelon, Lemon, Grapes)
- Each map has its own palette (~6-13 colors; see Level above)
- Large, detailed pixel grid (36×34)
- Pig ammo in tens only (10-30 per pig)
- Pig queue size generated from each map's own tile counts
- Simple animations (pig entrance/finish bounce, projectile flight, pixel pop on removal, scrolling belt)
- Desktop browser first

## Tech
- React
- Vite
- CSS
- No backend
- No database
- Keep code simple and easy to edit

## Priority
1. Pixel grid
2. Unit queue
3. Clicking units
4. Color matching
5. Ammo
6. Pixel removal
7. Holding area
8. Win / lose
9. Restart
10. Basic animation

Do not add extra features until the basic game works.
