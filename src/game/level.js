// Every level's pixel art and its matching pig queue stay mathematically
// balanced with each other. Most maps are generated in code (mask -> trim
// -> paint -> round -> queue) - only each fruit's silhouette mask and
// color palette differ. Strawberry is the exception: a static, hand-authored
// tile map (src/game/strawberry_static_map.js) whose color counts are
// already exact multiples of ten, so it only needs the shared queue step.

import { buildStrawberryStaticGrid, STRAWBERRY_STATIC_PALETTE } from './strawberry_static_map'
import { buildWatermelonStaticGrid, WATERMELON_STATIC_PALETTE } from './watermelon_static_map'
import { BREAKABLE_BG_KEYS, BREAKABLE_BG_PALETTES, fillBreakableBackground } from './breakableYellowBackground'

export const HOLDING_CAPACITY = 5
export const ACTIVE_CAPACITY = 5
// The queue is 3 persistent columns (see buildQueueColumns in logic.js)
// rather than a flat list re-split by index, so dispatching from one
// column never shifts pigs already sitting in the other two.
export const QUEUE_COLUMNS = 3
// How long a projectile's flight animation takes. The grid logic resolves
// a shot (removes its pixel, spends its ammo) exactly this long after it's
// fired too (see RESOLVE_DELAY_STEPS in Game.jsx), so a pixel always
// disappears right as its dot actually arrives - never before, never after.
export const PROJECTILE_MS = 200
// Target time (ms) for a shooter to travel one full lap of the conveyor -
// about 4.5 seconds. Movement runs on its own clock, sized from this and the
// actual number of conveyor steps (see Game.jsx), so conveyor speed is
// never tied to shooting speed.
export const CONVEYOR_LOOP_MS = 4500

// Conveyor layout, in pixels. CELL/GAP must match the .pixel-grid CSS.
// Kept small so the whole game - map selector, board, belt, and side panel
// - fits one desktop viewport without scrolling. Every fruit map shares
// this exact board size, so switching maps never resizes the layout.
export const CELL_SIZE = 9
export const CELL_GAP = 1
// Gap between the belt and the board - still enough room for a fired
// projectile's flight to read clearly, just scaled down with the board.
export const CONVEYOR_MARGIN = 32

export const ROWS = 34
export const COLS = 36
const CX = (COLS - 1) / 2
const CY = (ROWS - 1) / 2

// ---- Shared generation pipeline (identical for every fruit) ----

// Trims a handful of cells off the shape's edge (the least noticeable
// part) so the total filled-cell count comes out to an exact multiple of
// 10 - required so every color's count (a sum of pig-ammo chunks, each a
// multiple of 10) can land on an exact multiple of 10 too.
function trimToMultipleOfTen(mask) {
  let total = 0
  for (const row of mask) for (const cell of row) if (cell) total += 1
  let toRemove = total % 10
  if (toRemove === 0) return mask

  for (let row = mask.length - 1; row >= 0 && toRemove > 0; row -= 1) {
    for (let col = 0; col < mask[row].length && toRemove > 0; col += 1) {
      if (mask[row][col]) {
        mask[row][col] = null
        toRemove -= 1
      }
    }
  }
  return mask
}

function isFilled(mask, row, col) {
  return row >= 0 && row < mask.length && col >= 0 && col < mask[0].length && mask[row][col] !== null
}

function isOutlineCell(mask, row, col) {
  return (
    !isFilled(mask, row - 1, col) ||
    !isFilled(mask, row + 1, col) ||
    !isFilled(mask, row, col - 1) ||
    !isFilled(mask, row, col + 1)
  )
}

// A virtual light source drives 3-tier shading - bodyLight near it, body
// in the middle, bodyShade on the far/shadow side - plus a small bright
// shineCore near the light with a softer shineSoft halo around it, so
// every fruit reads with real light-and-shadow depth instead of flat
// dithered tone. `accent` cells (leaf/stem/vine) get their own two-tone
// dither instead. The outline is intentionally dashed (only half of the
// silhouette's edge cells) - see Shot Targeting in GAME_SPEC.md for why.
function paintFruitMask(mask, { lightRow, lightCol, maxHalfWidth, seedTest }) {
  return mask.map((line, row) =>
    line.map((part, col) => {
      if (!part) return null
      if (isOutlineCell(mask, row, col) && (row + col) % 2 === 0) return 'outline'

      if (part === 'accent') {
        return (row + col) % 2 === 0 ? 'accentB' : 'accentA'
      }

      // part === 'body'
      const coreDist = Math.hypot(row - lightRow, col - lightCol)
      if (coreDist <= 2.6) return 'shineCore'
      if (coreDist <= 5.2 && (row + col) % 2 === 0) return 'shineSoft'
      if (seedTest && seedTest(row, col, coreDist)) return 'seed'

      // A little dither noise mixed into the light-distance threshold so
      // shading bands blend at their edges instead of reading as flat rings.
      const lightDist = coreDist / maxHalfWidth
      const dithered = lightDist + ((row + col) % 3 === 0 ? -0.06 : 0.05)
      if (dithered < 0.55) return 'bodyLight'
      if (dithered < 1.05) return 'body'
      return 'bodyShade'
    }),
  )
}

function countByColor(grid) {
  const counts = {}
  for (const row of grid) {
    for (const cell of row) {
      if (cell) counts[cell] = (counts[cell] || 0) + 1
    }
  }
  return counts
}

// Rounds every color's count down to a multiple of 10, by reassigning its
// leftover (count % 10) cells to the majority fallback color ('body').
// Because the grid's total filled-cell count is already a multiple of 10
// (trimToMultipleOfTen), the fallback color's own count is guaranteed to
// land on a multiple of 10 too once every other color does.
function roundColorCountsToTens(grid, fallbackColor) {
  const counts = countByColor(grid)
  for (const [color, count] of Object.entries(counts)) {
    if (color === fallbackColor) continue
    let leftover = count % 10
    if (leftover === 0) continue

    for (let row = grid.length - 1; row >= 0 && leftover > 0; row -= 1) {
      for (let col = grid[row].length - 1; col >= 0 && leftover > 0; col -= 1) {
        if (grid[row][col] === color) {
          grid[row][col] = fallbackColor
          leftover -= 1
        }
      }
    }
  }
  return grid
}

// Splits a color's total pixel count (always a multiple of 10) into pig
// ammo chunks of 10, 20, or 30 - "clean tens", each between 10 and 30 -
// that sum EXACTLY back to that total. Any positive multiple of 10 can
// always be built this way (greedily take chunks of up to 30 until the
// remainder is used up), so the queue's ammo always matches the grid's
// pixel counts 1:1 with no rounding leftovers.
function splitIntoTensChunks(total) {
  let tens = total / 10
  const chunks = []
  while (tens > 0) {
    const chunk = Math.min(tens, 3)
    chunks.push(chunk)
    tens -= chunk
  }
  return chunks.map((n) => n * 10)
}

// Builds the pig queue straight from the grid's color counts, as a weighted
// shuffle rather than a strict sort: every chunk gets a random key, but
// breakable-background colors (BREAKABLE_BG_KEYS) draw from a lower range
// than fruit colors, so background shooters tend to land nearer the top of
// the 3 queue columns (see buildQueueColumns in logic.js, which splits this
// flat list into columns by position) while fruit shooters can still surface
// anywhere - including early - since the two ranges deliberately overlap
// instead of partitioning cleanly. This only ever reorders chunks; it never
// changes a color's own chunk sizes or total, so ammo balance (and by
// construction, solvability - see validateLevelDev in logic.js) is
// unaffected by the shuffle.
function buildQueue(grid) {
  const counts = countByColor(grid)
  const chunks = []
  for (const [color, total] of Object.entries(counts)) {
    const isBackground = BREAKABLE_BG_KEYS.includes(color)
    for (const ammo of splitIntoTensChunks(total)) {
      const key = isBackground ? Math.random() * 0.65 : 0.35 + Math.random() * 0.65
      chunks.push({ color, ammo, key })
    }
  }
  chunks.sort((a, b) => a.key - b.key)
  return chunks.map(({ color, ammo }) => ({ color, ammo }))
}

// fillBreakableBackground's own balancing (see breakableYellowBackground.js)
// only ever forwards a band's leftover to the NEXT band, so it can
// perfectly round bands 1-4 to tens but never the last one (bg5) - the
// board's total cell count (34x36 = 1224) simply isn't itself a multiple of
// ten, so no split of exact-ten color buckets can ever sum to it. ROWS/COLS
// are shared with the Strawberry/Watermelon static maps (whose
// hand-authored grids are a fixed 34x36) and with the single shared
// conveyor path every level uses, so resizing them here isn't safe - and
// folding the leftover into bg4 would just knock that band (already exact)
// back off a multiple of ten instead. So the handful of leftover cells,
// always exactly `total % 10` since every other color here is already
// forced to an exact ten, are trimmed to null - the darkest band's
// least-noticeable (lowest-diagonal-progress) corner cells - rather than
// reassigned, so they can't unbalance a neighboring band that's already
// correct.
function balanceLastBackgroundBand(grid) {
  const last = BREAKABLE_BG_KEYS[BREAKABLE_BG_KEYS.length - 1]
  const leftover = (countByColor(grid)[last] || 0) % 10
  if (leftover === 0) return grid

  const maxDiag = Math.max(1, grid.length + grid[0].length - 2)
  const candidates = []
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (grid[row][col] === last) candidates.push({ row, col, progress: (row + col) / maxDiag })
    }
  }
  candidates.sort((a, b) => a.progress - b.progress)
  for (let n = 0; n < leftover; n += 1) {
    grid[candidates[n].row][candidates[n].col] = null
  }
  return grid
}

function buildLevel({ id, name, buildMask, lightRow, lightCol, maxHalfWidth, seedTest, palette }) {
  const mask = trimToMultipleOfTen(buildMask())
  const fruitGrid = roundColorCountsToTens(paintFruitMask(mask, { lightRow, lightCol, maxHalfWidth, seedTest }), 'body')
  const grid = balanceLastBackgroundBand(fillBreakableBackground(fruitGrid))
  return {
    id,
    name,
    rows: ROWS,
    cols: COLS,
    grid,
    queue: buildQueue(grid),
    colors: { ...palette, ...BREAKABLE_BG_PALETTES[id] },
  }
}

// ---- Strawberry & Watermelon: static, hand-authored tile maps ----
// Unlike every procedural fruit, these grids aren't generated from a
// formula - they're imported as-is from their own *_static_map.js files (no
// paintFruitMask/mask-trim step), since their fruit color counts are
// already exact multiples of ten. Their background cells arrive as plain
// null though, so they still run through the exact same shared
// fillBreakableBackground/balanceLastBackgroundBand pipeline every
// procedural fruit uses - just with each map's own themed 5-color gradient
// (BREAKABLE_BG_PALETTES[id]) instead of a formula-driven body color.
function buildStaticLevel({ id, name, grid: fruitGrid, palette }) {
  const grid = balanceLastBackgroundBand(fillBreakableBackground(fruitGrid))
  return {
    id,
    name,
    rows: ROWS,
    cols: COLS,
    grid,
    queue: buildQueue(grid),
    colors: { ...palette, ...BREAKABLE_BG_PALETTES[id] },
  }
}

const strawberryLevel = buildStaticLevel({
  id: 'strawberry',
  name: 'Strawberry',
  grid: buildStrawberryStaticGrid(),
  palette: STRAWBERRY_STATIC_PALETTE,
})

// ---- Orange: round body + small stem nub ----

const ORANGE_R = 14
const ORANGE_CENTER_ROW = CY + 2

function buildOrangeMask() {
  const stemRow = ORANGE_CENTER_ROW - ORANGE_R
  const mask = []
  for (let row = 0; row < ROWS; row += 1) {
    const line = []
    for (let col = 0; col < COLS; col += 1) {
      const dist = Math.hypot(row - ORANGE_CENTER_ROW, col - CX)
      if (dist <= ORANGE_R) {
        line.push('body')
      } else if (row >= stemRow - 3 && row < stemRow && Math.abs(col - CX) <= 2) {
        line.push('accent')
      } else {
        line.push(null)
      }
    }
    mask.push(line)
  }
  return mask
}

const orangeLevel = {
  id: 'orange',
  name: 'Orange',
  buildMask: buildOrangeMask,
  lightRow: ORANGE_CENTER_ROW - ORANGE_R * 0.5,
  lightCol: CX - ORANGE_R * 0.5,
  maxHalfWidth: ORANGE_R,
  palette: {
    outline: '#7a3a12',
    bodyLight: '#ffb347',
    body: '#ff8c1a',
    bodyShade: '#cc6600',
    accentA: '#4fbf63',
    accentB: '#2f8f4a',
    seed: '#ffe9c9',
    shineCore: '#fff0d9',
    shineSoft: '#ffd9a0',
  },
}

// ---- Watermelon: static, hand-authored tile map ----
// Same exception as Strawberry (see buildStaticLevel above): imported as-is
// from watermelon_static_map.js, no formula/mask involved. Its color counts
// are already exact multiples of ten (see WATERMELON_STATIC_COUNTS in that
// file), so - like Strawberry - it only needs the shared queue step.
const watermelonLevel = buildStaticLevel({
  id: 'watermelon',
  name: 'Watermelon',
  grid: buildWatermelonStaticGrid(),
  palette: WATERMELON_STATIC_PALETTE,
})

// ---- Lemon: elongated oval body + stem nub ----

const LEMON_RX = 10.5
const LEMON_RY = 15.5
const LEMON_CENTER_ROW = CY + 1

function buildLemonMask() {
  const stemRow = LEMON_CENTER_ROW - LEMON_RY
  const mask = []
  for (let row = 0; row < ROWS; row += 1) {
    const line = []
    for (let col = 0; col < COLS; col += 1) {
      const nx = (col - CX) / LEMON_RX
      const ny = (row - LEMON_CENTER_ROW) / LEMON_RY
      if (nx * nx + ny * ny <= 1) {
        line.push('body')
      } else if (row >= stemRow - 2 && row < stemRow && Math.abs(col - CX) <= 1.5) {
        line.push('accent')
      } else {
        line.push(null)
      }
    }
    mask.push(line)
  }
  return mask
}

const lemonLevel = {
  id: 'lemon',
  name: 'Lemon',
  buildMask: buildLemonMask,
  lightRow: LEMON_CENTER_ROW - LEMON_RY * 0.4,
  lightCol: CX - LEMON_RX * 0.5,
  maxHalfWidth: Math.max(LEMON_RX, LEMON_RY),
  palette: {
    outline: '#7a6a10',
    bodyLight: '#fff27a',
    body: '#ffe74a',
    bodyShade: '#d4b800',
    accentA: '#4fbf63',
    accentB: '#2f8f4a',
    seed: '#fff8d9',
    shineCore: '#fffbe6',
    shineSoft: '#fff2a8',
  },
}

// ---- Grapes: a cluster of small circles + a vine at the top ----

const GRAPE_R = 2.6

function grapeCenters() {
  const rowsOfGrapes = [
    { row: 8, cols: [CX - 9, CX - 3, CX + 3, CX + 9] },
    { row: 12.5, cols: [CX - 12, CX - 6, CX, CX + 6, CX + 12] },
    { row: 17, cols: [CX - 9, CX - 3, CX + 3, CX + 9] },
    { row: 21.5, cols: [CX - 12, CX - 6, CX, CX + 6, CX + 12] },
    { row: 26, cols: [CX - 9, CX - 3, CX + 3, CX + 9] },
    { row: 29, cols: [CX - 3, CX + 3] },
  ]
  const centers = []
  for (const { row, cols } of rowsOfGrapes) {
    for (const col of cols) centers.push({ row, col })
  }
  return centers
}

const GRAPE_CENTERS = grapeCenters()

function buildGrapesMask() {
  const mask = []
  for (let row = 0; row < ROWS; row += 1) {
    const line = []
    for (let col = 0; col < COLS; col += 1) {
      const inGrape = GRAPE_CENTERS.some((c) => Math.hypot(row - c.row, col - c.col) <= GRAPE_R)
      if (inGrape) {
        line.push('body')
      } else if (row >= 3 && row <= 6 && Math.abs(col - CX) <= row - 1) {
        line.push('accent')
      } else {
        line.push(null)
      }
    }
    mask.push(line)
  }
  return mask
}

const grapesLevel = {
  id: 'grapes',
  name: 'Grapes',
  buildMask: buildGrapesMask,
  lightRow: 10,
  lightCol: CX - 8,
  maxHalfWidth: 14,
  palette: {
    outline: '#3a1a4a',
    bodyLight: '#b98aeb',
    body: '#8a4fd1',
    bodyShade: '#5a2a8f',
    accentA: '#4fbf63',
    accentB: '#2f8f4a',
    seed: '#e8d9ff',
    shineCore: '#f3e6ff',
    shineSoft: '#d9bdf5',
  },
}

// Every playable map, in selector order. Strawberry is already a finished
// level object (static map); the rest are descriptors run through
// buildLevel. Every one still satisfies the same balance rule: total pig
// ammo for a color always exactly equals that color's total pixel count.
export const LEVELS = [
  strawberryLevel,
  buildLevel(orangeLevel),
  watermelonLevel,
  ...[lemonLevel, grapesLevel].map(buildLevel),
]

export const DEFAULT_LEVEL_ID = LEVELS[0].id

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) || LEVELS[0]
}
