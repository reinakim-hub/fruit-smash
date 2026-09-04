import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACTIVE_CAPACITY,
  CELL_GAP,
  CELL_SIZE,
  COLS,
  CONVEYOR_LOOP_MS,
  CONVEYOR_MARGIN,
  DEFAULT_LEVEL_ID,
  HOLDING_CAPACITY,
  LEVELS,
  PROJECTILE_MS,
  ROWS,
} from './level'
import {
  colorBalance,
  CONVEYOR_PATH,
  countPixels,
  createInitialState,
  dispatchUnit,
  reactivateHoldingUnit,
  tick,
} from './logic'

// A single fast clock drives everything, sized so a shooter covers the
// entire conveyor loop (every logical step) in CONVEYOR_LOOP_MS, no
// matter how many steps the loop has. Every step still gets its own full
// targeting check - nothing is skipped - but a shot's own resolve delay
// (RESOLVE_DELAY_STEPS below) is calculated from PROJECTILE_MS, the
// projectile's real flight-animation time, so a pixel is only ever removed
// exactly when its dot visually arrives - never before, never after -
// regardless of how fast the pig itself is gliding between positions.
const MOVE_INTERVAL_MS = Math.max(1, CONVEYOR_LOOP_MS / CONVEYOR_PATH.length)
const RESOLVE_DELAY_STEPS = Math.max(1, Math.round(PROJECTILE_MS / MOVE_INTERVAL_MS))

const STEP = CELL_SIZE + CELL_GAP
const GRID_RIGHT = CONVEYOR_MARGIN + COLS * STEP - CELL_GAP
const GRID_BOTTOM = CONVEYOR_MARGIN + ROWS * STEP - CELL_GAP
const STAGE_WIDTH = GRID_RIGHT + CONVEYOR_MARGIN
const STAGE_HEIGHT = GRID_BOTTOM + CONVEYOR_MARGIN

function cellCenter(row, col) {
  return {
    x: CONVEYOR_MARGIN + col * STEP + CELL_SIZE / 2,
    y: CONVEYOR_MARGIN + row * STEP + CELL_SIZE / 2,
  }
}

// Where a conveyor step sits just outside the grid, facing inward.
function stepPosition(step) {
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
const LOOP_CORNERS = {
  bl: { x: CONVEYOR_MARGIN / 2, y: GRID_BOTTOM + CONVEYOR_MARGIN / 2 },
  br: { x: GRID_RIGHT + CONVEYOR_MARGIN / 2, y: GRID_BOTTOM + CONVEYOR_MARGIN / 2 },
  tr: { x: GRID_RIGHT + CONVEYOR_MARGIN / 2, y: CONVEYOR_MARGIN / 2 },
  tl: { x: CONVEYOR_MARGIN / 2, y: CONVEYOR_MARGIN / 2 },
}

const LOOP_WIDTH = LOOP_CORNERS.br.x - LOOP_CORNERS.bl.x
const LOOP_HEIGHT = LOOP_CORNERS.bl.y - LOOP_CORNERS.tr.y
const LOOP_PERIMETER = 2 * (LOOP_WIDTH + LOOP_HEIGHT)

// Single source of truth for conveyor speed: derived directly from
// CONVEYOR_LOOP_MS (the one real lap-time constant) and the loop's actual
// perimeter, instead of an independent px/s constant. This guarantees the
// visual glide always sums to exactly one CONVEYOR_LOOP_MS per lap and can
// never drift out of sync with it - changing CONVEYOR_LOOP_MS alone still
// keeps speed even on every side and through every corner.
const CONVEYOR_SPEED = LOOP_PERIMETER / (CONVEYOR_LOOP_MS / 1000)

const LOOP_PATH = `path('M ${LOOP_CORNERS.bl.x} ${LOOP_CORNERS.bl.y} L ${LOOP_CORNERS.br.x} ${LOOP_CORNERS.br.y} L ${LOOP_CORNERS.tr.x} ${LOOP_CORNERS.tr.y} L ${LOOP_CORNERS.tl.x} ${LOOP_CORNERS.tl.y} Z')`

// A single continuous progress value: distance travelled along the loop,
// starting at 0 at the fixed bottom-left entry point and increasing
// counterclockwise (bottom -> right -> top -> left). Every step position
// above falls on a straight edge of the true rectangle, so this value is
// real physical distance along the belt - not a step index or percentage.
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

// Precomputed once: real distance (px) along the belt for every logical
// conveyor step, and the real distance covered going from each step to the
// next. A normal step and a corner-crossing step cover different physical
// distances (a corner has left-over margin on both sides of it) - by
// timing each move at the same CONVEYOR_SPEED (px/s) rather than a fixed
// duration, a big corner move simply takes proportionally longer instead
// of visibly speeding up.
const STEP_ARC_LENGTHS = CONVEYOR_PATH.map((step) => arcLengthForStep(step))

function moveDurationSeconds(step) {
  if (step <= 0) return 0
  const distance = STEP_ARC_LENGTHS[step] - STEP_ARC_LENGTHS[step - 1]
  return distance / CONVEYOR_SPEED
}

// The outward-facing direction for each side, used to spread overlapping
// shooters apart WITHOUT ever moving them along the belt (which would
// change their arc-length position and desync it from the aligned
// row/column that targeting - and the projectiles they fire - actually use).
const PERP_NORMALS = {
  bottom: { x: 0, y: 1 },
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
}

const PERP_GAP = 10

// A small, fixed-per-unit sideways nudge (never along-path) so several
// shooters sharing the exact same step don't render fully stacked. It's
// keyed only by unit id - never by position or by who else is currently
// nearby - so the SAME value is used both for rendering this unit's own
// token and for rendering the origin of any projectile it fires, and the
// two can never disagree.
function perpOffsetForUnit(unitId) {
  return ((unitId % 3) - 1) * PERP_GAP
}

function perpOffsetXY(side, unitId) {
  const normal = PERP_NORMALS[side]
  const perp = perpOffsetForUnit(unitId)
  return { dx: normal.x * perp, dy: normal.y * perp }
}

const BELT_WIDTH = 10
const beltFrame = {
  top: {
    left: LOOP_CORNERS.tl.x - BELT_WIDTH / 2,
    top: LOOP_CORNERS.tl.y - BELT_WIDTH / 2,
    width: LOOP_WIDTH + BELT_WIDTH,
    height: BELT_WIDTH,
  },
  bottom: {
    left: LOOP_CORNERS.bl.x - BELT_WIDTH / 2,
    top: LOOP_CORNERS.bl.y - BELT_WIDTH / 2,
    width: LOOP_WIDTH + BELT_WIDTH,
    height: BELT_WIDTH,
  },
  left: {
    left: LOOP_CORNERS.tl.x - BELT_WIDTH / 2,
    top: LOOP_CORNERS.tl.y + BELT_WIDTH / 2,
    width: BELT_WIDTH,
    height: LOOP_HEIGHT - BELT_WIDTH,
  },
  right: {
    left: LOOP_CORNERS.tr.x - BELT_WIDTH / 2,
    top: LOOP_CORNERS.tr.y + BELT_WIDTH / 2,
    width: BELT_WIDTH,
    height: LOOP_HEIGHT - BELT_WIDTH,
  },
}

// Memoized so this only re-renders when the `grid` array reference itself
// changes (i.e. a pixel actually got removed) - not on every one of the
// fast movement clock's many calls per second, most of which don't touch
// the grid at all (logic.js's tick() keeps the same reference on those).
// With hundreds of pixel cells, re-rendering this on every single
// movement step would be far too expensive.
const PixelGrid = memo(function PixelGrid({ grid, colors }) {
  return (
    <div
      className="pixel-grid"
      style={{
        gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE}px)`,
        left: CONVEYOR_MARGIN,
        top: CONVEYOR_MARGIN,
      }}
    >
      {grid.flatMap((row, rowIndex) =>
        row.map((cell, colIndex) => (
          <div
            key={`${rowIndex}-${colIndex}`}
            className={`pixel ${cell ? 'filled' : 'empty'}`}
            style={cell ? { background: colors[cell] } : undefined}
          />
        )),
      )}
    </div>
  )
})

function UnitToken({ unit, colors, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`unit${disabled ? ' locked' : ''}`}
      disabled={disabled}
      onClick={onClick}
      style={{ background: colors[unit.color] }}
      aria-label={`${unit.color} pig, ${unit.ammo} ammo`}
    >
      <span className="unit-ear unit-ear-l" />
      <span className="unit-ear unit-ear-r" />
      <span className="unit-face" />
      <span className="unit-ammo">{unit.ammo}</span>
    </button>
  )
}

// ---- Map selector ----

const CLEARED_STORAGE_KEY = 'fruit-smash:cleared-maps'

function loadClearedIds() {
  try {
    const raw = window.localStorage.getItem(CLEARED_STORAGE_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

function saveClearedIds(ids) {
  try {
    window.localStorage.setItem(CLEARED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // localStorage unavailable (private mode, etc.) - cleared state just
    // won't persist across reloads; gameplay itself is unaffected.
  }
}

const THUMB_SCALE = 3

// A crisp little pixel-art preview of a map's actual board, drawn once to
// a tiny canvas at 1 logical pixel per grid cell and then scaled up with
// `image-rendering: pixelated` - far cheaper than a real DOM grid at this
// small size, since it's static and never re-renders per tick.
const MapThumbnail = memo(function MapThumbnail({ level, cleared }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    level.grid.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (!cell) return
        ctx.fillStyle = level.colors[cell]
        ctx.fillRect(colIndex, rowIndex, 1, 1)
      })
    })
  }, [level])

  return (
    <canvas
      ref={canvasRef}
      width={level.cols}
      height={level.rows}
      className={`map-thumb${cleared ? '' : ' map-thumb-uncleared'}`}
      style={{ width: level.cols * THUMB_SCALE, height: level.rows * THUMB_SCALE }}
      aria-hidden="true"
    />
  )
})

export default function Game() {
  const [levelId, setLevelId] = useState(DEFAULT_LEVEL_ID)
  const level = useMemo(() => LEVELS.find((entry) => entry.id === levelId) || LEVELS[0], [levelId])
  const [state, setState] = useState(() => createInitialState(level))
  const [clearedIds, setClearedIds] = useState(loadClearedIds)

  const pixelsLeft = countPixels(state.grid)
  const totalPixels = countPixels(level.grid)
  const canPlay = state.status === 'playing'
  const canDispatch = canPlay && state.path.length < ACTIVE_CAPACITY
  const isHoldingFull = state.holding.length >= HOLDING_CAPACITY

  // One fast clock drives every active pig, every step - full targeting
  // coverage at full conveyor speed. Each fired shot still takes the same
  // real amount of time (RESOLVE_DELAY_STEPS calls, sized from
  // PROJECTILE_MS) to actually land and spend its ammo, so shooting speed
  // itself hasn't changed - only how fast a pig glides between positions
  // has.
  useEffect(() => {
    if (!canPlay) return undefined
    const id = window.setInterval(() => {
      setState((current) => tick(current, RESOLVE_DELAY_STEPS))
    }, MOVE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [canPlay])

  // Debug validation: log remaining pixels and remaining ammo, by color,
  // whenever either changes. They should always match per color, and both
  // should hit zero together the instant the level is cleared. Gated on
  // state.grid specifically (not the whole state) - ammo only ever moves
  // in lockstep with a grid change (a shot resolving), so this naturally
  // skips the many fast-clock renders where only positions moved, instead
  // of re-scanning the whole grid ~80 times a second for nothing.
  const lastBalance = useRef('')
  useEffect(() => {
    const { pixels, ammo } = colorBalance(state)
    const snapshot = JSON.stringify({ pixels, ammo })
    if (snapshot !== lastBalance.current) {
      lastBalance.current = snapshot
      // eslint-disable-next-line no-console
      console.log('[balance] pixels left by color:', pixels, ' | ammo left by color:', ammo)
    }
  }, [state.grid])

  // A cleared map's thumbnail switches from grayscale to full color right
  // away, and the cleared set is remembered in localStorage so it's still
  // shown on the next visit.
  useEffect(() => {
    if (state.status !== 'won') return
    setClearedIds((current) => {
      if (current.has(level.id)) return current
      const next = new Set(current)
      next.add(level.id)
      saveClearedIds(next)
      return next
    })
  }, [state.status, level.id])

  function restart() {
    setState(createInitialState(level))
  }

  // Every map is always selectable - grayscale on a thumbnail means "not
  // cleared yet", never "locked". Selecting a map starts a fresh run on
  // it; each map's own cleared/not-cleared badge is tracked independently.
  function selectLevel(nextLevel) {
    if (nextLevel.id === level.id) return
    setLevelId(nextLevel.id)
    setState(createInitialState(nextLevel))
  }

  return (
    <div className="game">
      <aside className="map-selector">
        <h2 className="panel-title">Maps</h2>
        <div className="map-list">
          {LEVELS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`map-tile${entry.id === level.id ? ' map-tile-selected' : ''}`}
              onClick={() => selectLevel(entry)}
            >
              <MapThumbnail level={entry} cleared={clearedIds.has(entry.id)} />
              <span className="map-tile-name">{entry.name}</span>
              {clearedIds.has(entry.id) && <span className="map-tile-badge">CLEAR</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className="board-wrap">
        <div className="conveyor-stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
          {Object.entries(beltFrame).map(([side, box]) => (
            <div
              key={side}
              // Scroll direction must match the loop pigs actually travel:
              // bottom -> right, right -> up, top -> left, left -> down.
              // Un-reversed horizontal/vertical scroll (see the keyframes
              // in App.css) reads as right/down, so top and right - the
              // two sides that go the "other way" - get reversed.
              className={`belt-band ${side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical'} ${
                side === 'top' || side === 'right' ? 'belt-reverse' : ''
              }`}
              style={box}
            />
          ))}

          <PixelGrid grid={state.grid} colors={level.colors} />

          {/* Every active pig is rendered here at once, each driven by its
              own step - none of them share a position or wait on each
              other to move. offsetDistance comes straight from unit.step,
              the same value targeting uses - overlap between pigs sharing
              a step is resolved with a perpendicular offset-anchor nudge
              only, which never changes that arc-length/step position. */}
          {state.path.map((unit) => {
            const step = CONVEYOR_PATH[unit.step]
            const distance = arcLengthForStep(step)
            const { dx, dy } = perpOffsetXY(step.side, unit.id)
            return (
              <div
                // Keyed by unit id so a *different* unit taking over a
                // conveyor slot appears at its own start point instead of
                // animating over from wherever the previous occupant was.
                key={unit.id}
                className="conveyor-unit"
                style={{
                  background: level.colors[unit.color],
                  offsetPath: LOOP_PATH,
                  offsetDistance: `${distance}px`,
                  offsetAnchor: `calc(50% - ${dx}px) calc(50% - ${dy}px)`,
                  transitionDuration: `${moveDurationSeconds(unit.step)}s`,
                }}
                aria-label={`${unit.color} pig, ${unit.ammo} ammo`}
              >
                <span className="unit-ear unit-ear-l" />
                <span className="unit-ear unit-ear-r" />
                <span className="unit-face" />
                <span className="unit-ammo">{unit.ammo}</span>
              </div>
            )
          })}

          {state.shots.map((shot) => {
            // Same per-unit perpendicular nudge as the shooter's own
            // token, applied to the same frozen firing step - so a
            // projectile always starts exactly where its shooter is
            // actually rendered, never from the unshifted/raw position.
            const base = stepPosition(shot.from)
            const { dx, dy } = perpOffsetXY(shot.from.side, shot.unitId)
            const from = { x: base.x + dx, y: base.y + dy }
            const to = cellCenter(shot.to.row, shot.to.col)
            return (
              <div
                // A cell can only ever be shot once (it's removed
                // immediately once its shot resolves), so this key is
                // unique per shot event - it forces a fresh element each
                // time, even when the same pig fires again on the very
                // next tick, so the flight animation always replays.
                key={`${shot.unitId}-${shot.to.row}-${shot.to.col}`}
                className="projectile"
                style={{
                  '--from-x': `${from.x}px`,
                  '--from-y': `${from.y}px`,
                  '--to-x': `${to.x}px`,
                  '--to-y': `${to.y}px`,
                  '--flight-ms': `${PROJECTILE_MS}ms`,
                }}
              />
            )
          })}
        </div>
      </section>

      {/* Fixed to the board's height so the panel never resizes or jumps
          as the queue empties or Holding fills - only the queue's own
          internal list scrolls (see .queue-columns). */}
      <aside className="side-panel" style={{ height: STAGE_HEIGHT + 34 }}>
        <header className="top-bar">
          <div>
            <h1>Fruit Smash</h1>
            <p>{level.name}</p>
          </div>
          <button type="button" className="restart" onClick={restart}>
            Restart
          </button>
        </header>

        <div className="progress-card">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${totalPixels ? (100 * (totalPixels - pixelsLeft)) / totalPixels : 100}%` }}
            />
          </div>
          <span className="progress-label">{pixelsLeft} left</span>
        </div>

        <div className="status-row">
          <span className="status-chip">Active {state.path.length}/{ACTIVE_CAPACITY}</span>
          {/* Holding 5/5 is only a warning - full, but not game over yet.
              Game Over only actually triggers if a 6th pig then needs a
              slot with none free (see parkUnit in logic.js). */}
          <span className={`status-chip${isHoldingFull ? ' danger' : ''}`}>
            Holding {state.holding.length}/{HOLDING_CAPACITY}
          </span>
        </div>

        <section className="lane">
          <div className={`holding${isHoldingFull ? ' danger' : ''}`}>
            {Array.from({ length: HOLDING_CAPACITY }, (_, slot) => {
              const unit = state.holding[slot]
              return (
                <div key={slot} className="hold-slot">
                  {unit ? (
                    <UnitToken
                      key={unit.id}
                      unit={unit}
                      colors={level.colors}
                      disabled={!canDispatch}
                      onClick={() => setState((current) => reactivateHoldingUnit(current, unit.id))}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="lane queue-lane">
          <h2>Queue</h2>
          {state.queue.every((column) => column.length === 0) ? (
            <span className="hint">Queue is empty</span>
          ) : (
            <div className="queue-columns">
              {state.queue.map((column, columnIndex) => (
                <div className="queue-column" key={columnIndex}>
                  {column.map((unit, rowIndex) => (
                    <UnitToken
                      key={unit.id}
                      unit={unit}
                      colors={level.colors}
                      disabled={rowIndex !== 0 || !canDispatch}
                      onClick={() => setState((current) => dispatchUnit(current, unit.id))}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      {state.status !== 'playing' && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>{state.status === 'won' ? 'You Win!' : 'Game Over'}</h2>
            <button type="button" className="restart" onClick={restart}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
