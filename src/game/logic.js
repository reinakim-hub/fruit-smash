import { ACTIVE_CAPACITY, HOLDING_CAPACITY, LEVELS, PROJECTILE_MS, QUEUE_COLUMNS } from './level'
import { CONVEYOR_PATH, LAST_STEP, STEP_DURATIONS_MS } from './conveyor'

export { CONVEYOR_PATH }

let nextId = 1

export function createUnit(color, ammo) {
  return { id: nextId++, color, ammo }
}

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
// single call. The clone keeps the SAME grid array reference by default;
// only removePixel (inside tick) copies it, once per tick at most.
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
// Lose only when a unit needs a slot and all HOLDING_CAPACITY are already
// full - see Game.jsx for the brief "6th slot" overflow visualization
// shown at that exact moment, before Game Over.
function parkUnit(state, unit) {
  if (state.holding.length >= HOLDING_CAPACITY) {
    state.status = 'lost'
    state.overflowUnit = unit
    return
  }
  state.holding.push(unit)
}

// Up to ACTIVE_CAPACITY shooters can be on the conveyor at once, and each
// needs its own distinct perpendicular render lane (see perpOffsetXY in
// Game.jsx) so they never visually overlap. A unit keeps the same lane for
// its whole run, assigned here as the lowest index not already in use by
// another currently-active unit - since dispatch is only ever allowed
// below ACTIVE_CAPACITY, a free lane always exists.
function assignLane(path) {
  const used = new Set(path.map((unit) => unit.lane))
  let lane = 0
  while (used.has(lane)) lane += 1
  return lane
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
  // start of the bottom side. `elapsedMs` tracks real time toward
  // completing the glide to step 1; `scanned` guards step 0 itself, which
  // needs no glide (it's the entry point) but still needs its one scan.
  unit.step = 0
  unit.elapsedMs = 0
  unit.scanned = false
  unit.lane = assignLane(next.path)
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
  unit.elapsedMs = 0
  unit.scanned = false
  unit.lane = assignLane(next.path)
  unit.pendingShots = []
  next.path.push(unit)
  return next
}

// Everything below runs on one real-time-driven clock (Game.jsx passes the
// actual elapsed ms since the previous call, from a requestAnimationFrame
// loop) so a shooter's logical step and its visible CSS glide - both timed
// from the exact same STEP_DURATIONS_MS - can never drift apart: the next
// scan position is only ever reached once its own step duration has
// actually elapsed, on straight sides and corners alike.
export function tick(state, deltaMs) {
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

  // Resolve pass: a volley's countdown is real elapsed time (ms), not a
  // tick count, so it always resolves - and its pixel disappears - after
  // exactly PROJECTILE_MS, regardless of how many calls-per-second this
  // function is getting. Every unit's own pending volley resolves here,
  // before anything looks for new targets.
  for (const unit of next.path) {
    if (unit.pendingShots.length === 0) continue

    const remaining = []
    for (const shot of unit.pendingShots) {
      shot.remainingMs -= deltaMs
      if (shot.remainingMs <= 0) {
        removePixel(shot.to.row, shot.to.col)
        unit.ammo -= 1
      } else {
        remaining.push(shot)
      }
    }
    unit.pendingShots = remaining
  }

  // A cell claimed by any STILL-in-flight shot (fired this call or many
  // calls ago, by this pig or another one) must stay off-limits to every
  // other shot for as long as it's pending - otherwise two projectiles
  // could both claim the same not-yet-removed pixel.
  const reserved = new Set()
  for (const unit of next.path) {
    for (const shot of unit.pendingShots) {
      reserved.add(`${shot.to.row},${shot.to.col}`)
    }
  }

  // Scans the single conveyor position `unit.step` is currently at and
  // fires if it finds a match - called exactly once per position, right
  // when the unit arrives there (step 0 on dispatch, every later step the
  // instant its own glide finishes) - never repeated while the unit then
  // waits (for its next glide, or for this shot to resolve).
  function scanAndMaybeFire(unit) {
    if (unit.pendingShots.length >= unit.ammo) return
    const step = CONVEYOR_PATH[unit.step]
    const target = findAlignedTarget(next.grid, reserved, step.cells, unit.color)
    if (!target) return
    // `from` is captured once, right here, at the pig's position at the
    // moment of firing - not recomputed later - so the projectile's
    // rendered flight path stays fixed even though the pig itself keeps
    // moving on immediately after.
    unit.pendingShots = [...unit.pendingShots, { to: target, from: step, remainingMs: PROJECTILE_MS }]
    reserved.add(`${target.row},${target.col}`)
  }

  const stillActive = []
  const justParked = []

  for (const unit of next.path) {
    if (unit.ammo <= 0) {
      // Every shot it ever fired has resolved above with nothing left to
      // fire - it leaves the conveyor now, wherever it is.
      continue
    }

    if (!unit.scanned) {
      scanAndMaybeFire(unit)
      unit.scanned = true
    }

    // Advance by real elapsed time - every conveyor position in between
    // gets its own scan, in order, even if a slow frame lets elapsedMs
    // jump more than one step's worth at once; the unit is never moved to
    // Holding before this loop reaches (and scans) its final position,
    // and it's clamped at LAST_STEP so it never starts a second lap.
    unit.elapsedMs += deltaMs
    while (unit.step < LAST_STEP && unit.elapsedMs >= STEP_DURATIONS_MS[unit.step + 1]) {
      unit.elapsedMs -= STEP_DURATIONS_MS[unit.step + 1]
      unit.step += 1
      scanAndMaybeFire(unit)
    }

    if (unit.step >= LAST_STEP && unit.pendingShots.length === 0) {
      // At the final position, already scanned, with nothing left in
      // flight - it's genuinely completed its one lap.
      justParked.push(unit)
    } else {
      stillActive.push(unit)
    }
  }

  next.path = stillActive

  // Every currently in-flight shot, from every active pig - not just the
  // ones fired this exact call - so a projectile's element stays mounted
  // (and its CSS flight animation keeps playing) for its whole real
  // flight time.
  next.shots = next.path.flatMap((unit) =>
    unit.pendingShots.map((shot) => ({ unitId: unit.id, lane: unit.lane, color: unit.color, from: shot.from, to: shot.to })),
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

// The set of colors currently exposed as the nearest cell on at least one
// of the 140 conveyor lines - i.e. colors some shooter could plausibly
// hit right now. Ignores in-flight reservations (a cheap, slightly
// optimistic snapshot), which is fine for a scheduling heuristic.
function frontierColors(grid) {
  const colors = new Set()
  for (const step of CONVEYOR_PATH) {
    for (const { row, col } of step.cells) {
      const value = grid[row][col]
      if (value) {
        colors.add(value)
        break
      }
    }
  }
  return colors
}

// A single simulated step of greedy auto-play, used by both the
// solvability check below and (implicitly) documents what "good" greedy
// play looks like: a column top is always dispatchable-in-principle (the
// only way a column can ever advance is to dispatch its current top, so
// this never skips one, useful or not), while Holding - which has no
// such ordering constraint - is reactivated by preference for whichever
// units are currently useful (their color is on the frontier), so a
// pig that's proven unproductive doesn't keep monopolizing an active
// slot just because it happened to be first in line. Once Holding gets
// close to overflowing, draining it takes priority over pulling in more
// fresh queue units, so it can never be starved into overflow either.
function autoPlayStep(state) {
  let next = state
  let freeSlots = ACTIVE_CAPACITY - next.path.length
  if (freeSlots <= 0) return next

  if (next.holding.length >= HOLDING_CAPACITY - 1) {
    const byAmmo = [...next.holding].sort((a, b) => a.ammo - b.ammo)
    for (const unit of byAmmo) {
      if (freeSlots <= 0) break
      next = reactivateHoldingUnit(next, unit.id)
      freeSlots -= 1
    }
  }

  while (freeSlots > 0) {
    const frontier = frontierColors(next.grid)
    const queueTop = next.queue.filter((column) => column.length > 0).map((column) => column[0])
    const holding = [...next.holding].sort((a, b) => a.ammo - b.ammo)
    const usefulQueue = queueTop.filter((unit) => frontier.has(unit.color))
    const usefulHolding = holding.filter((unit) => frontier.has(unit.color))

    if (usefulQueue.length > 0) {
      next = dispatchUnit(next, usefulQueue[0].id)
    } else if (usefulHolding.length > 0) {
      next = reactivateHoldingUnit(next, usefulHolding[0].id)
    } else if (queueTop.length > 0) {
      // Nothing currently looks useful anywhere - still dispatch a fresh
      // queue unit rather than a Holding one, since that's the only way a
      // column can ever progress toward whatever's queued behind its
      // current (temporarily unhelpful) top.
      next = dispatchUnit(next, queueTop[0].id)
    } else {
      break
    }
    freeSlots -= 1
  }

  return next
}

// Dev-only sanity checks, run once at module load - never affect real
// gameplay, only warn in the console.
// 1) Balance: ammo is only ever generated in tens (10/20/30) and every
//    color's total queue ammo must exactly equal that color's total pixel
//    count (see level.js) - if level generation ever regresses, this
//    catches it immediately.
// 2) Solvability: the greedy auto-play above, run against the real
//    tick()/dispatchUnit(). Since ammo==pixels per color by construction,
//    a correctly-generated level should fully clear this way. This is
//    still not a proof either way - a real player can make choices this
//    simple heuristic can't - so a level that doesn't finish in the
//    iteration budget is logged as inconclusive, not "unsolvable",
//    unless progress has genuinely and completely stopped for a very
//    long stretch (a real stall), which is logged distinctly.
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
  const MAX_ITERATIONS = 400000
  const STALL_LIMIT = 20000
  let lastPixels = countPixels(sim.grid)
  let stall = 0
  let i = 0
  for (; i < MAX_ITERATIONS && sim.status === 'playing' && countPixels(sim.grid) > 0; i += 1) {
    sim = autoPlayStep(sim)
    sim = tick(sim, 1)
    const pixelsLeft = countPixels(sim.grid)
    if (pixelsLeft === lastPixels) {
      stall += 1
      if (stall >= STALL_LIMIT) break
    } else {
      stall = 0
      lastPixels = pixelsLeft
    }
  }

  if (countPixels(sim.grid) === 0) return

  if (sim.status === 'lost') {
    // eslint-disable-next-line no-console
    console.warn(`${tag} solvability check: greedy auto-play lost (Holding overflowed) after clearing ${countPixels(state.grid) - countPixels(sim.grid)}/${countPixels(state.grid)} pixels - inconclusive (a real player can sequence pigs this simple heuristic can't), verify manually.`)
  } else if (stall >= STALL_LIMIT) {
    // eslint-disable-next-line no-console
    console.warn(`${tag} solvability check: genuinely stuck - zero pixels cleared for ${STALL_LIMIT} consecutive ticks with ${countPixels(sim.grid)} pixels remaining. Likely unsolvable - investigate.`)
  } else {
    // eslint-disable-next-line no-console
    console.warn(`${tag} solvability check: did not finish within ${MAX_ITERATIONS} ticks (${countPixels(sim.grid)} pixels remaining, steady progress was still being made) - inconclusive for this larger level, verify manually.`)
  }
}

if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  for (const level of LEVELS) validateLevelDev(level)
}
