// Every level's pixel art and its matching pig queue are generated below
// rather than hand-typed, so the art and the queue always stay
// mathematically balanced with each other, for every fruit map. All maps
// share one board size and one generation pipeline (mask -> trim -> paint
// -> round -> queue) - only each fruit's silhouette mask and color palette
// differ.

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
// about 3 seconds. Movement runs on its own clock, sized from this and the
// actual number of conveyor steps (see Game.jsx), so conveyor speed is
// never tied to shooting speed.
export const CONVEYOR_LOOP_MS = 3000

// Conveyor layout, in pixels. CELL/GAP must match the .pixel-grid CSS.
// Kept small so the whole game - map selector, board, belt, and side panel
// - fits one desktop viewport without scrolling. Every fruit map shares
// this exact board size, so switching maps never resizes the layout.
export const CELL_SIZE = 7
export const CELL_GAP = 1
// Gap between the belt and the board - still enough room for a fired
// projectile's flight to read clearly, just scaled down with the board.
export const CONVEYOR_MARGIN = 26

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

// Builds the pig queue straight from the grid's color counts, then
// interleaves colors round-robin so the queue isn't one long run per color.
function buildQueue(grid) {
  const counts = countByColor(grid)
  const perColor = Object.entries(counts).map(([color, total]) => ({
    color,
    chunks: splitIntoTensChunks(total),
  }))

  const queue = []
  let remaining = true
  while (remaining) {
    remaining = false
    for (const entry of perColor) {
      const ammo = entry.chunks.shift()
      if (ammo !== undefined) {
        queue.push({ color: entry.color, ammo })
        remaining = true
      }
    }
  }
  return queue
}

function buildLevel({ id, name, buildMask, lightRow, lightCol, maxHalfWidth, seedTest, palette }) {
  const mask = trimToMultipleOfTen(buildMask())
  const grid = roundColorCountsToTens(paintFruitMask(mask, { lightRow, lightCol, maxHalfWidth, seedTest }), 'body')
  return { id, name, rows: ROWS, cols: COLS, grid, queue: buildQueue(grid), colors: palette }
}

// ---- Strawberry: rounded teardrop body + 5-leaf crown ----

const STRAWBERRY_TOP = 6
const STRAWBERRY_BOTTOM = 33
const STRAWBERRY_MAX_HALF_WIDTH = 15.2

function strawberryHalfWidth(row) {
  const t = (row - STRAWBERRY_TOP) / (STRAWBERRY_BOTTOM - STRAWBERRY_TOP)
  if (t < 0 || t > 1) return -1
  const taper = Math.sin(Math.PI * (1 - t) ** 0.78 * 0.5)
  const roundedTop = Math.min(1, (row - STRAWBERRY_TOP + 1) / 5.2)
  return STRAWBERRY_MAX_HALF_WIDTH * taper * roundedTop
}

function strawberryIsAccent(row, col) {
  if (row < 0 || row > 8) return false
  if (row >= 6) return Math.abs(col - CX) <= 13
  for (const leafCenter of [-13, -6.5, 0, 6.5, 13]) {
    const halfWidth = row * 0.42 + 0.2
    if (Math.abs(col - (CX + leafCenter)) <= halfWidth) return true
  }
  return false
}

function buildStrawberryMask() {
  const mask = []
  for (let row = 0; row < ROWS; row += 1) {
    const line = []
    for (let col = 0; col < COLS; col += 1) {
      const inBody = Math.abs(col - CX) <= strawberryHalfWidth(row)
      line.push(inBody ? 'body' : strawberryIsAccent(row, col) ? 'accent' : null)
    }
    mask.push(line)
  }
  return mask
}

const strawberryLevel = {
  id: 'strawberry',
  name: 'Strawberry',
  buildMask: buildStrawberryMask,
  lightRow: STRAWBERRY_TOP + 5,
  lightCol: CX - STRAWBERRY_MAX_HALF_WIDTH * 0.55,
  maxHalfWidth: STRAWBERRY_MAX_HALF_WIDTH,
  seedTest: (row, col, coreDist) => (row * 7 + col * 5) % 9 === 0 && row > STRAWBERRY_TOP + 3 && coreDist > 5.2,
  palette: {
    outline: '#4a1220',
    bodyLight: '#ff7a8c',
    body: '#f0405a',
    bodyShade: '#a81836',
    accentA: '#4fbf63',
    accentB: '#2f8f4a',
    seed: '#ffd23f',
    shineCore: '#ffe6ee',
    shineSoft: '#ffc3cf',
  },
}

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

// ---- Watermelon: big round rind + fleck texture + stem nub ----

const MELON_R = 15.5
const MELON_CENTER_ROW = CY + 1

function buildWatermelonMask() {
  const stemRow = MELON_CENTER_ROW - MELON_R
  const mask = []
  for (let row = 0; row < ROWS; row += 1) {
    const line = []
    for (let col = 0; col < COLS; col += 1) {
      const dist = Math.hypot(row - MELON_CENTER_ROW, col - CX)
      if (dist <= MELON_R) {
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

const watermelonLevel = {
  id: 'watermelon',
  name: 'Watermelon',
  buildMask: buildWatermelonMask,
  lightRow: MELON_CENTER_ROW - MELON_R * 0.5,
  lightCol: CX - MELON_R * 0.5,
  maxHalfWidth: MELON_R,
  seedTest: (row, col, coreDist) => (row * 5 + col * 3) % 17 === 0 && coreDist > 6,
  palette: {
    outline: '#1f4d1f',
    bodyLight: '#6fcf6f',
    body: '#3fae57',
    bodyShade: '#1f7a3d',
    accentA: '#7a4a24',
    accentB: '#5a3418',
    seed: '#163a1f',
    shineCore: '#eaffe0',
    shineSoft: '#b8f0b0',
  },
}

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

// Every playable map, in selector order. Each is generated independently
// through the exact same pipeline, so every one satisfies the same
// balance rule by construction: total pig ammo for a color always exactly
// equals that color's total pixel count.
export const LEVELS = [strawberryLevel, orangeLevel, watermelonLevel, lemonLevel, grapesLevel].map(buildLevel)

export const DEFAULT_LEVEL_ID = LEVELS[0].id

export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) || LEVELS[0]
}
