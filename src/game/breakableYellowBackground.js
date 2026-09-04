// breakableYellowBackground.js
// Fills every empty board cell with a REMOVABLE gradient tile. The diagonal
// gradient runs from top-left (light) to bottom-right (deep/saturated).
// Counts are balanced to multiples of 10 so the existing 10/20/30-ammo logic
// can match every background tile exactly.
//
// The band assignment (bg1..bg5, light -> dark) is identical for every map -
// only the actual hex colors differ, one 5-shade palette per map (see
// BREAKABLE_BG_PALETTES below), so each level can have its own themed
// background while sharing this exact same fill/balance logic.

export const BREAKABLE_BG_KEYS = ['bg1', 'bg2', 'bg3', 'bg4', 'bg5']

export const BREAKABLE_BG_PALETTES = {
  // Strawberry: yellow/gold.
  strawberry: {
    bg1: '#FFF0A6',
    bg2: '#FFE074',
    bg3: '#F7C84B',
    bg4: '#E7A936',
    bg5: '#C98224',
  },
  // Orange: mint/teal.
  orange: {
    bg1: '#E3FFF6',
    bg2: '#B9F5E2',
    bg3: '#82E0C7',
    bg4: '#4EC7A9',
    bg5: '#2C9F86',
  },
  // Watermelon: lavender/purple.
  watermelon: {
    bg1: '#F3E8FF',
    bg2: '#DFC6F7',
    bg3: '#C39FEF',
    bg4: '#A177DE',
    bg5: '#7C55BE',
  },
  // Lemon: sky blue.
  lemon: {
    bg1: '#E6F6FF',
    bg2: '#BEE8FF',
    bg3: '#8ED4FF',
    bg4: '#5CB8F5',
    bg5: '#3993D6',
  },
  // Grapes: peach/coral.
  grapes: {
    bg1: '#FFEEE0',
    bg2: '#FFD3B0',
    bg3: '#FFAE7D',
    bg4: '#F98657',
    bg5: '#E0603C',
  },
}

function countColor(grid, color) {
  let count = 0
  for (const row of grid) {
    for (const cell of row) {
      if (cell === color) count += 1
    }
  }
  return count
}

// Move only cells nearest the next diagonal band.
// This keeps the gradient visually smooth while making every shade count
// divisible by 10.
function balanceBandsToTens(grid) {
  const rows = grid.length
  const cols = grid[0].length
  const maxDiag = Math.max(1, rows + cols - 2)

  for (let i = 0; i < BREAKABLE_BG_KEYS.length - 1; i += 1) {
    const current = BREAKABLE_BG_KEYS[i]
    const next = BREAKABLE_BG_KEYS[i + 1]
    const remainder = countColor(grid, current) % 10
    if (remainder === 0) continue

    const candidates = []

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (grid[row][col] !== current) continue

        // Higher diagonal progress = closer to the next darker band.
        const progress = (row + col) / maxDiag
        candidates.push({ row, col, progress })
      }
    }

    candidates.sort((a, b) => b.progress - a.progress)

    for (let n = 0; n < remainder; n += 1) {
      const cell = candidates[n]
      if (cell) grid[cell.row][cell.col] = next
    }
  }

  return grid
}

export function fillBreakableBackground(sourceGrid) {
  const grid = sourceGrid.map((row) => [...row])
  const rows = grid.length
  const cols = grid[0].length
  const maxDiag = Math.max(1, rows + cols - 2)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      // Fruit/art tiles stay exactly as they are.
      if (grid[row][col] !== null) continue

      // 0 at top-left -> 1 at bottom-right.
      const t = (row + col) / maxDiag

      // Five clean diagonal bands.
      const band = Math.min(
        BREAKABLE_BG_KEYS.length - 1,
        Math.floor(t * BREAKABLE_BG_KEYS.length),
      )

      grid[row][col] = BREAKABLE_BG_KEYS[band]
    }
  }

  return balanceBandsToTens(grid)
}
