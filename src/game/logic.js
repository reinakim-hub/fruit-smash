import { ACTIVE_CAPACITY, COLS, HOLDING_CAPACITY, LEVELS, QUEUE_COLUMNS, ROWS } from './level'

let nextId = 1

export function createUnit(color, ammo) {
  return { id: nextId++, color, ammo }
}

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

// The queue is stored as QUEUE_COLUMNS persistent stacks (front = index 0 =
// the clickable top), not a flat list re-split by index on every render -
// a unit's column is fixed the instant the level is built and never
// recalculated from however many units happen to remain.
function buildQueueColumns(level) {
  const columns = Array.from({ length: QUEUE_COLUMNS }, () => [])
  level.queue.forEach((unit, index) => {
    columns[index % QUEUE_COLUMNS].push(createUnit(unit.color, unit.ammo))
  })
  return columns
}

export function createInitialState(level) {
  nextId = 1
  return {
    levelId: level.id,
    grid: level.grid.map((row) => row.slice()),
    queue: buildQueueColumns(level),
    path: [],
    holding: [],
    status: 'playing',
    shots: [],
  }
}

export function countPixels(grid) {
  let total = 0
  for (const row of grid) {
    for (const cell of row) {
      if (cell) total += 1
    }
  }
  return total
}

// A pig only ever looks at the single row/column exactly aligned with its
// current conveyor position (`cells` is that one line, nearest-to-farthest,
// straight from CONVEYOR_PATH) - never anything off to the side. Within
// that line, only the nearest remaining pixel is visible (it blocks
// anything stacked behind it), and a reserved - already in-flight - cell
// can't be claimed again even if it would otherwise match. Returns that
// single target if it matches the pig's color and isn't already claimed,
// otherwise null.
export function findAlignedTarget(grid, reserved, cells, color) {
  for (const { row, col } of cells) {
    const value = grid[row][col]
    if (value) {
      if (value === color && !reserved.has(`${row},${col}`)) return { row, col }
      return null
    }
  }
  return null
}

// The grid is by far the biggest piece of state (hundreds of cells) and,
// with the fast movement clock calling tick() many times per second, it
// would be wastefully expensive to deep-clone and re-render it on every
// single call - especially since most calls don't touch it at all (a
// shot's countdown has to reach zero first). So the clone keeps the
// SAME grid array reference by default; only mutateGrid (below) - called
// exactly when a shot actually resolves - copies it, once per tick at
// most. That keeps the grid reference stable (and cheap to skip
// re-rendering, via PixelGrid's memoization in Game.jsx) on every call
// where nothing was actually removed.
function cloneState(state) {
  return {
    ...state,
    grid: state.grid,
    queue: state.queue.map((column) => column.map((unit) => ({ ...unit }))),
    path: state.path.map((unit) => ({ ...unit })),
    holding: state.holding.map((unit) => ({ ...unit })),
    shots: state.shots.map((shot) => ({ ...shot })),
  }
}

function checkWin(state) {
  if (countPixels(state.grid) === 0) {
    state.status = 'won'
  }
}

// Park a unit that still has ammo but nothing to shoot.
// Lose only when a unit needs a slot and all 5 are already full.
function parkUnit(state, unit) {
  if (state.holding.length >= HOLDING_CAPACITY) {
    state.status = 'lost'
    return
  }
  state.holding.push(unit)
}

// Only the top (index 0) of a column is ever dispatchable - matching only
// against each column's own top keeps the other two columns completely
// untouched, so they never move or reorder just because a different
// column's unit was used.
export function dispatchUnit(state, unitId) {
  if (state.status !== 'playing') return state
  if (state.path.length >= ACTIVE_CAPACITY) return state

  const next = cloneState(state)
  const columnIndex = next.queue.findIndex((column) => column.length > 0 && column[0].id === unitId)
  if (columnIndex === -1) return state

  const [unit] = next.queue[columnIndex].splice(0, 1)
  // Every unit enters the conveyor at the same fixed point: step 0, the
  // start of the bottom side.
  unit.step = 0
  unit.pendingShots = []
  next.path.push(unit)
  return next
}

// A pig in Holding stays there until the player explicitly clicks it - it
// is never sent back onto the conveyor automatically, and its ammo never
// changes while it waits. Reactivating it re-enters it at the fixed
// starting point (a fresh one-lap run) with its remaining ammo untouched,
// as long as an active slot is actually free.
export function reactivateHoldingUnit(state, unitId) {
  if (state.status !== 'playing') return state
  if (state.path.length >= ACTIVE_CAPACITY) return state

  const next = cloneState(state)
  const index = next.holding.findIndex((unit) => unit.id === unitId)
  if (index === -1) return state

  const [unit] = next.holding.splice(index, 1)
  unit.step = 0
  unit.pendingShots = []
  next.path.push(unit)
  return next
}

// Everything below runs on ONE clock (called from Game.jsx's fast movement
// interval, every step), so a pig's position advances - and every side it
// travels gets a fresh look for targets - at full conveyor speed with
// nothing skipped. "Shooting speed" (how long a fired volley takes to
// actually land and spend its ammo) is a separate, independent concept:
// firing only *reserves* each target (so nothing else can claim it) and
// starts a shared countdown of `resolveDelaySteps` calls (sized in
// Game.jsx from PROJECTILE_MS, so a volley resolves - and its pixel
// disappears - exactly when its projectile visually arrives, regardless of
// how many calls-per-second this function is now getting); the ammo cost
// and each pixel's actual removal only happen once that countdown reaches
// zero.
// That keeps "ammo spent" and "pixels removed" permanently 1:1 - a shot
// can never spend ammo without also removing exactly the pixel it
// claimed, so no color can end up with leftover ammo or a leftover pixel.
//
// A pig only ever fires at the single pixel aligned with its current x/y
// position on the belt (see findAlignedTarget) - never more than one
// projectile per pixel, and never more projectiles in flight at once than
// it has ammo for (unit.pendingShots.length < unit.ammo, since ammo is
// only actually spent when a shot resolves). Firing never pauses
// movement - the pig advances every call regardless, immediately scanning
// its next aligned line next tick and firing again right away if that one
// also has a match, with no delay for any previously-fired shot to
// resolve first. Every active pig does all of this independently: there
// is no shared turn order and no pig waits for another.
export function tick(state, resolveDelaySteps = 1) {
  if (state.status !== 'playing') return state

  const next = cloneState(state)

  // Copy-on-write: the grid only actually gets cloned (once) the first
  // time this call needs to remove a pixel - the vast majority of calls
  // resolve nothing and leave next.grid pointing at the exact same array
  // React already has, so its memoized grid render can skip entirely.
  let gridCloned = false
  function removePixel(row, col) {
    if (!gridCloned) {
      next.grid = next.grid.map((line) => line.slice())
      gridCloned = true
    }
    next.grid[row][col] = null
  }

  // Resolve pass: a volley's countdown can span many calls (not just
  // one), so first let every unit's own pending volley (if its countdown
  // has reached zero) resolve - every pixel in it removed, one ammo spent
  // per pixel - before anything looks for new targets.
  for (const unit of next.path) {
    if (unit.pendingShots.length === 0) continue

    const remaining = []
    for (const shot of unit.pendingShots) {
      shot.remaining -= 1
      if (shot.remaining <= 0) {
        removePixel(shot.to.row, shot.to.col)
        unit.ammo -= 1
      } else {
        remaining.push(shot)
      }
    }
    unit.pendingShots = remaining
  }

  // A cell claimed by any STILL-in-flight shot (fired this call or many
  // calls ago, by this pig or another one - it doesn't matter which) must
  // stay off-limits to every other shot for as long as it's pending, not
  // just for the one call it was fired on - otherwise two projectiles
  // could both claim the same not-yet-removed pixel.
  const reserved = new Set()
  for (const unit of next.path) {
    for (const shot of unit.pendingShots) {
      reserved.add(`${shot.to.row},${shot.to.col}`)
    }
  }

  const stillActive = []
  const justParked = []

  for (const unit of next.path) {
    if (unit.ammo <= 0) {
      // Every shot it ever fired has resolved above with nothing left to
      // fire - it leaves the conveyor now, wherever it is.
      continue
    }

    // Only fire if there's ammo not already committed to a still-in-flight
    // shot (pendingShots.length < ammo) - this never blocks on a previous
    // shot resolving, it just caps total outstanding commitments.
    if (unit.pendingShots.length < unit.ammo) {
      const step = CONVEYOR_PATH[unit.step]
      const target = findAlignedTarget(next.grid, reserved, step.cells, unit.color)
      if (target) {
        // `from` is captured once, right here, at the pig's position at
        // the moment of firing - not recomputed later - so the
        // projectile's rendered flight path stays fixed even though the
        // pig itself keeps moving on to somewhere else immediately after.
        unit.pendingShots = [...unit.pendingShots, { to: target, from: step, remaining: resolveDelaySteps }]
        reserved.add(`${target.row},${target.col}`)
      }
    }

    if (unit.step < CONVEYOR_PATH.length - 1) {
      unit.step += 1
    }

    if (unit.step >= CONVEYOR_PATH.length - 1 && unit.pendingShots.length === 0) {
      // At the final position with nothing left in flight - it's
      // genuinely completed its one lap.
      justParked.push(unit)
    } else {
      stillActive.push(unit)
    }
  }

  next.path = stillActive

  // Every currently in-flight shot, from every active pig - not just the
  // ones fired this exact call - so a projectile's element stays mounted
  // (and its CSS flight animation keeps playing) for its whole real
  // flight time, not just the ~12ms until the next movement tick.
  next.shots = next.path.flatMap((unit) =>
    unit.pendingShots.map((shot) => ({ unitId: unit.id, color: unit.color, from: shot.from, to: shot.to })),
  )

  // Park anyone who just finished their lap. Holding is otherwise
  // untouched here - pigs already waiting there stay put; only the player
  // clicking one (reactivateHoldingUnit) ever sends it back out.
  for (const unit of justParked) parkUnit(next, unit)

  checkWin(next)
  return next
}

// Debug helper: total remaining pixels and total remaining ammo, by color,
// across every unit wherever it currently is (queue, conveyor, holding).
// Both totals should match for every color at all times, and both should
// hit zero together right when the level is cleared - if they ever
// diverge, that's the balancing/targeting bug to chase.
export function colorBalance(state) {
  const pixels = {}
  for (const row of state.grid) {
    for (const cell of row) {
      if (cell) pixels[cell] = (pixels[cell] || 0) + 1
    }
  }

  const ammo = {}
  for (const unit of [...state.queue.flat(), ...state.path, ...state.holding]) {
    ammo[unit.color] = (ammo[unit.color] || 0) + unit.ammo
  }

  return { pixels, ammo }
}

// Dev-only sanity checks, run once at module load - never affect real
// gameplay, only warn in the console.
// 1) Balance: ammo is only ever generated in tens (10/20/30) and every
//    color's total queue ammo must exactly equal that color's total pixel
//    count (see level.js) - if level generation ever regresses, this
//    catches it immediately instead of silently letting a color get stuck
//    with leftover ammo or an unreachable pixel.
// 2) Solvability: a cheap greedy auto-play (always dispatch whatever's
//    available, always reactivate Holding when there's room) run against
//    the real tick()/dispatchUnit(). Since ammo==pixels per color by
//    construction, a correctly-generated level should always fully clear
//    this way; if it doesn't within a generous iteration budget, that's a
//    strong signal of an actual soft-lock (not proof, since greedy timing
//    isn't optimal play - just a heads-up).
function validateLevelDev(level) {
  const state = createInitialState(level)
  const tag = `[level:${level.id}]`

  for (const column of state.queue) {
    for (const unit of column) {
      if (![10, 20, 30].includes(unit.ammo)) {
        // eslint-disable-next-line no-console
        console.warn(`${tag} pig ammo ${unit.ammo} is not 10/20/30 (color: ${unit.color})`)
      }
    }
  }

  const { pixels, ammo } = colorBalance(state)
  for (const color of new Set([...Object.keys(pixels), ...Object.keys(ammo)])) {
    if ((pixels[color] || 0) !== (ammo[color] || 0)) {
      // eslint-disable-next-line no-console
      console.warn(`${tag} color balance mismatch for ${color}: ${pixels[color] || 0} pixels vs ${ammo[color] || 0} ammo`)
    }
  }

  let sim = state
  const MAX_ITERATIONS = 200000
  for (let i = 0; i < MAX_ITERATIONS && sim.status === 'playing' && countPixels(sim.grid) > 0; i += 1) {
    // Drain Holding first - recycling a leftover-ammo pig for another lap
    // before pulling in a brand new one is what real play should do, and
    // it's also required for the single-aligned-target rule to ever fully
    // clear a color: most pigs won't spend all their ammo in one lap (they
    // only fire when their color happens to be exposed on the exact line
    // they're passing), so multiple relaunches per pig are expected, not a
    // sign of a stuck level.
    for (const unit of [...sim.holding]) {
      if (sim.path.length < ACTIVE_CAPACITY) {
        sim = reactivateHoldingUnit(sim, unit.id)
      }
    }
    for (const column of sim.queue) {
      if (column.length > 0 && sim.path.length < ACTIVE_CAPACITY) {
        sim = dispatchUnit(sim, column[0].id)
      }
    }
    sim = tick(sim, 1)
  }

  if (sim.status === 'lost') {
    // eslint-disable-next-line no-console
    console.warn(`${tag} solvability check: greedy auto-play lost (Holding overflowed) - level may be too tight or genuinely unsolvable.`)
  } else if (countPixels(sim.grid) > 0) {
    // eslint-disable-next-line no-console
    console.warn(`${tag} solvability check: greedy auto-play did not clear the level in time - possible soft-lock, investigate.`)
  }
}

if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  for (const level of LEVELS) validateLevelDev(level)
}
