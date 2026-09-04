// Single source of truth for the conveyor's shape and timing - grid-space
// path, pixel-space geometry, and per-step glide durations. Both the game
// logic (logic.js, which gates step-advancement by real elapsed time) and
// the renderer (Game.jsx, which sets each shooter's CSS transition-duration)
// import STEP_DURATIONS_MS from here, so the two can never drift apart -
// logic never advances a shooter past a position its visible glide hasn't
// actually finished reaching yet, on straight sides or corners alike.
import { CELL_SIZE, CELL_GAP, CONVEYOR_MARGIN, COLS, ROWS, CONVEYOR_LOOP_MS } from './level'

// Builds the rectangular conveyor loop that surrounds the grid.
// Order: bottom (left->right), right (bottom->top), top (right->left),
// left (top->bottom) - a counterclockwise lap starting at the bottom-left.
// Each step records the line of grid cells it can see, ordered nearest
// to farthest, so targeting only ever hits the pixel closest to that side.
export function buildConveyorPath(rows, cols) {
  const path = []

  for (let col = 0; col < cols; col += 1) {
    const cells = []
    for (let row = rows - 1; row >= 0; row -= 1) cells.push({ row, col })
    path.push({ side: 'bottom', col, row: null, cells })
  }
  for (let row = rows - 1; row >= 0; row -= 1) {
    const cells = []
    for (let col = cols - 1; col >= 0; col -= 1) cells.push({ row, col })
    path.push({ side: 'right', row, col: null, cells })
  }
  for (let col = cols - 1; col >= 0; col -= 1) {
    const cells = []
    for (let row = 0; row < rows; row += 1) cells.push({ row, col })
    path.push({ side: 'top', col, row: null, cells })
  }
  for (let row = 0; row < rows; row += 1) {
    const cells = []
    for (let col = 0; col < cols; col += 1) cells.push({ row, col })
    path.push({ side: 'left', row, col: null, cells })
  }

  return path
}

// Every fruit map shares the same board size, so the conveyor loop itself
// never needs to be rebuilt when the player switches maps.
export const CONVEYOR_PATH = buildConveyorPath(ROWS, COLS)
export const LAST_STEP = CONVEYOR_PATH.length - 1

// ---- Pixel-space geometry ----

const STEP = CELL_SIZE + CELL_GAP
export const GRID_RIGHT = CONVEYOR_MARGIN + COLS * STEP - CELL_GAP
export const GRID_BOTTOM = CONVEYOR_MARGIN + ROWS * STEP - CELL_GAP
export const STAGE_WIDTH = GRID_RIGHT + CONVEYOR_MARGIN
export const STAGE_HEIGHT = GRID_BOTTOM + CONVEYOR_MARGIN

export function cellCenter(row, col) {
  return {
    x: CONVEYOR_MARGIN + col * STEP + CELL_SIZE / 2,
    y: CONVEYOR_MARGIN + row * STEP + CELL_SIZE / 2,
  }
}

// Where a conveyor step sits just outside the grid, facing inward.
export function stepPosition(step) {
  switch (step.side) {
    case 'bottom':
      return { x: cellCenter(0, step.col).x, y: GRID_BOTTOM + CONVEYOR_MARGIN / 2 }
    case 'top':
      return { x: cellCenter(0, step.col).x, y: CONVEYOR_MARGIN / 2 }
    case 'right':
      return { x: GRID_RIGHT + CONVEYOR_MARGIN / 2, y: cellCenter(step.row, 0).y }
    case 'left':
    default:
      return { x: CONVEYOR_MARGIN / 2, y: cellCenter(step.row, 0).y }
  }
}

// The conveyor is a real rectangle, corners included. Shooters are animated
// along this exact shape (via CSS offset-path) rather than tweened between
// raw (x, y) points, so they can never cut a diagonal shortcut through a
// corner - every step position above falls exactly on one of these four
// straight edges.
export const LOOP_CORNERS = {
  bl: { x: CONVEYOR_MARGIN / 2, y: GRID_BOTTOM + CONVEYOR_MARGIN / 2 },
  br: { x: GRID_RIGHT + CONVEYOR_MARGIN / 2, y: GRID_BOTTOM + CONVEYOR_MARGIN / 2 },
  tr: { x: GRID_RIGHT + CONVEYOR_MARGIN / 2, y: CONVEYOR_MARGIN / 2 },
  tl: { x: CONVEYOR_MARGIN / 2, y: CONVEYOR_MARGIN / 2 },
}

export const LOOP_WIDTH = LOOP_CORNERS.br.x - LOOP_CORNERS.bl.x
export const LOOP_HEIGHT = LOOP_CORNERS.bl.y - LOOP_CORNERS.tr.y
export const LOOP_PERIMETER = 2 * (LOOP_WIDTH + LOOP_HEIGHT)

export const LOOP_PATH = `path('M ${LOOP_CORNERS.bl.x} ${LOOP_CORNERS.bl.y} L ${LOOP_CORNERS.br.x} ${LOOP_CORNERS.br.y} L ${LOOP_CORNERS.tr.x} ${LOOP_CORNERS.tr.y} L ${LOOP_CORNERS.tl.x} ${LOOP_CORNERS.tl.y} Z')`

// Single source of truth for conveyor speed: derived directly from
// CONVEYOR_LOOP_MS (the one real lap-time constant) and the loop's actual
// perimeter, so speed stays even on every side and through every corner.
const CONVEYOR_SPEED = LOOP_PERIMETER / (CONVEYOR_LOOP_MS / 1000)

// A single continuous progress value: distance travelled along the loop,
// starting at 0 at the fixed bottom-left entry point and increasing
// counterclockwise (bottom -> right -> top -> left).
function arcLengthForStep(step) {
  const pos = stepPosition(step)
  switch (step.side) {
    case 'bottom':
      return pos.x - LOOP_CORNERS.bl.x
    case 'right':
      return LOOP_WIDTH + (LOOP_CORNERS.br.y - pos.y)
    case 'top':
      return LOOP_WIDTH + LOOP_HEIGHT + (LOOP_CORNERS.tr.x - pos.x)
    case 'left':
    default:
      return 2 * LOOP_WIDTH + LOOP_HEIGHT + (pos.y - LOOP_CORNERS.tl.y)
  }
}

// Real distance (px) along the belt for every logical conveyor step -
// used both to place a shooter along the CSS motion path (Game.jsx) and,
// via STEP_DURATIONS_MS below, to time how long each step takes.
export const STEP_ARC_LENGTHS = CONVEYOR_PATH.map(arcLengthForStep)

// How long (ms) each step's glide takes, at the constant CONVEYOR_SPEED -
// a corner step covers more real distance than a mid-side step (its arc
// length includes the leftover margin on both sides of the actual corner
// point), so it simply takes proportionally longer, never a speed change.
// Index 0 is 0 (the fixed entry point - no glide needed to arrive there).
export const STEP_DURATIONS_MS = CONVEYOR_PATH.map((_, index) => {
  if (index === 0) return 0
  return ((STEP_ARC_LENGTHS[index] - STEP_ARC_LENGTHS[index - 1]) / CONVEYOR_SPEED) * 1000
})
