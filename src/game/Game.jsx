import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ACTIVE_CAPACITY,
  CELL_SIZE,
  COLS,
  CONVEYOR_MARGIN,
  DEFAULT_LEVEL_ID,
  HOLDING_CAPACITY,
  LEVELS,
  PROJECTILE_MS,
} from './level'
import {
  CONVEYOR_PATH,
  LAST_STEP,
  LOOP_CORNERS,
  LOOP_PATH,
  LOOP_WIDTH,
  LOOP_HEIGHT,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  STEP_ARC_LENGTHS,
  STEP_DURATIONS_MS,
  cellCenter,
  stepPosition,
} from './conveyor'
import { colorBalance, countPixels, createInitialState, dispatchUnit, reactivateHoldingUnit, tick } from './logic'

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

const PERP_GAP = 8

// Up to ACTIVE_CAPACITY shooters can be on the belt at once, so they need
// that many distinct sideways nudges - keyed by each unit's own `lane`
// (assigned in logic.js: the lowest lane index not already used by
// another currently-active unit, so no two simultaneously-active units
// can ever collide). Lane 0 always renders perfectly centered on the belt
// (zero offset) - only lane 1+ nudge sideways at all, and always by a
// positive multiple of PERP_GAP, i.e. only ever further OUTWARD along the
// side's own outward normal (see PERP_NORMALS), never back in toward the
// board. Since a unit's lane is fixed for its whole run (assigned once in
// logic.js, never reassigned tick-to-tick), this offset can't grow over
// time either - it's a pure function of that one fixed integer. The SAME
// lane value renders both a unit's own token and the origin of any
// projectile it fires, so the two can never disagree.
function perpOffsetForLane(lane) {
  return lane * PERP_GAP
}

function perpOffsetXY(side, lane) {
  const normal = PERP_NORMALS[side]
  const perp = perpOffsetForLane(lane)
  return { dx: normal.x * perp, dy: normal.y * perp }
}

// A shooter's exact belt position, interpolated every render frame from
// the same real-time progress logic.js uses to gate scanning
// (unit.elapsedMs toward completing the glide to unit.step + 1) - so the
// visible position is a continuous function of real time, never a
// discrete per-step CSS transition. That's what makes movement read as
// smooth and constant-speed (corners included) with no snap or pause,
// while the actual target scan still only ever happens once per step, in
// logic.js, completely unaffected by how often this renders.
function currentArcLength(unit) {
  const base = STEP_ARC_LENGTHS[unit.step]
  if (unit.step >= LAST_STEP) return base
  const segmentMs = STEP_DURATIONS_MS[unit.step + 1]
  if (!segmentMs) return base
  const fraction = Math.min(1, unit.elapsedMs / segmentMs)
  return base + fraction * (STEP_ARC_LENGTHS[unit.step + 1] - base)
}

const BELT_WIDTH = 13
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

// Tracks whether a scrollable list has more content below its current
// scroll position, so a bottom fade (the `.has-fade` mask in App.css) can
// show only while that's actually true - not as a permanent decoration,
// and not as a scrollbar (still hidden, still wheel/trackpad-scrollable).
function useScrollFade(deps) {
  const ref = useRef(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    function check() {
      setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 1)
    }

    check()
    el.addEventListener('scroll', check)
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return [ref, hasMore]
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

// Must be small enough that a thumbnail (cols/rows * THUMB_SCALE) plus
// .map-tile's own padding/border still fits inside .map-selector's fixed,
// compact width (see App.css) - otherwise it just gets clipped.
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

// Must match .board-wrap's own CSS padding, so the measured available box
// (the space actually left for the board) excludes it on both sides.
const BOARD_WRAP_PADDING = 16

export default function Game() {
  const [levelId, setLevelId] = useState(DEFAULT_LEVEL_ID)
  const level = useMemo(() => LEVELS.find((entry) => entry.id === levelId) || LEVELS[0], [levelId])
  const [state, setState] = useState(() => createInitialState(level))
  const [clearedIds, setClearedIds] = useState(loadClearedIds)

  // The board/conveyor is laid out once at its native (STAGE_WIDTH x
  // STAGE_HEIGHT) size - every targeting/rendering coordinate above
  // depends on that fixed pixel grid. To make it fill ~88-92vh of the
  // viewport (set via .board-wrap's CSS height) without touching any of
  // that coordinate math, the whole native-size stage is wrapped in a box
  // sized to `scale * native` and rendered with a matching CSS transform
  // - so it's visually scaled up/down to exactly fit, centered, never
  // cropped or overflowing, on any desktop viewport height.
  const boardWrapRef = useRef(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = boardWrapRef.current
    if (!el) return undefined

    function measure() {
      const availWidth = el.clientWidth - BOARD_WRAP_PADDING * 2
      const availHeight = el.clientHeight - BOARD_WRAP_PADDING * 2
      const next = Math.min(availWidth / STAGE_WIDTH, availHeight / STAGE_HEIGHT)
      if (next > 0 && Number.isFinite(next)) setScale(next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pixelsLeft = countPixels(state.grid)
  const totalPixels = countPixels(level.grid)
  const canPlay = state.status === 'playing'
  const isActiveFull = state.path.length >= ACTIVE_CAPACITY
  const isHoldingFull = state.holding.length >= HOLDING_CAPACITY
  const isOverflowing = state.status === 'lost' && Boolean(state.overflowUnit)

  // A pig stays visually available (never hard-disabled) purely because
  // Active is full - clicking it then does nothing to game state but
  // bumps this counter, which remounts the Active status chip (via its
  // `key` below) to replay a brief red flash/shake every time, even on
  // rapid repeated clicks.
  const [activeWarningTick, setActiveWarningTick] = useState(0)

  function dispatchOrWarn(unitId) {
    if (!canPlay) return
    if (isActiveFull) {
      setActiveWarningTick((tick) => tick + 1)
      return
    }
    setState((current) => dispatchUnit(current, unitId))
  }

  function reactivateOrWarn(unitId) {
    if (!canPlay) return
    if (isActiveFull) {
      setActiveWarningTick((tick) => tick + 1)
      return
    }
    setState((current) => reactivateHoldingUnit(current, unitId))
  }

  // A single requestAnimationFrame loop drives everything, passing tick()
  // the real elapsed ms since the previous frame. logic.js gates each
  // shooter's own step-advancement by that same real time (against
  // STEP_DURATIONS_MS, the same numbers this file uses for each unit's
  // CSS transition-duration below), so the logical position and the
  // visible glide can never drift apart - the next scan position is only
  // ever reached once its own glide has actually finished, corners
  // included. Capped so a throttled/backgrounded tab can't feed one huge
  // catch-up delta.
  useEffect(() => {
    if (!canPlay) return undefined
    let frameId
    let last = performance.now()
    function frame(now) {
      const deltaMs = Math.min(now - last, 100)
      last = now
      setState((current) => tick(current, deltaMs))
      frameId = window.requestAnimationFrame(frame)
    }
    frameId = window.requestAnimationFrame(frame)
    return () => window.cancelAnimationFrame(frameId)
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

  // A loss triggered by a 6th pig needing a Holding slot with none free
  // briefly shows that 6th, danger-styled overflow slot (see the "holding"
  // section below) before the Game Over overlay covers it, so the player
  // can actually see what caused the loss. A win still shows its overlay
  // immediately - there's nothing to briefly reveal there.
  const [overlayReady, setOverlayReady] = useState(false)
  useEffect(() => {
    if (state.status === 'won') {
      setOverlayReady(true)
      return undefined
    }
    if (state.status === 'lost' && state.overflowUnit) {
      setOverlayReady(false)
      const id = window.setTimeout(() => setOverlayReady(true), 900)
      return () => window.clearTimeout(id)
    }
    setOverlayReady(state.status === 'lost')
    return undefined
  }, [state.status, state.overflowUnit])

  const [mapListRef, mapListHasMore] = useScrollFade([])
  const [queueRef, queueHasMore] = useScrollFade([state.queue])

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
        <div className={`map-list${mapListHasMore ? ' has-fade' : ''}`} ref={mapListRef}>
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

      <section className="board-wrap" ref={boardWrapRef}>
        <div className="board-scale" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
        <div
          className="conveyor-stage"
          style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
        >
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
              other to move. offsetDistance is interpolated every frame
              (see currentArcLength) from unit.step/elapsedMs, the same
              real-time progress targeting uses, so the visible glide is
              continuous and never tied to a per-step CSS transition -
              overlap between pigs sharing a step is resolved with a
              perpendicular offset-anchor nudge only, which never changes
              that arc-length/step position. */}
          {state.path.map((unit) => {
            const step = CONVEYOR_PATH[unit.step]
            const distance = currentArcLength(unit)
            const { dx, dy } = perpOffsetXY(step.side, unit.lane)
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
            const { dx, dy } = perpOffsetXY(shot.from.side, shot.lane)
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
        </div>
      </section>

      {/* Stretched to the board-wrap's own height (see .game's
          align-items: stretch in App.css) so the panel never resizes or
          jumps as the queue empties or Holding fills - only the queue's
          own internal list scrolls (see .queue-columns). */}
      <aside className="side-panel">
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
          <span
            key={activeWarningTick}
            className={`status-chip chip-active${activeWarningTick > 0 ? ' active-warning' : ''}`}
          >
            Active {state.path.length}/{ACTIVE_CAPACITY}
          </span>
          {/* Holding 5/5 is only a warning - full, but not game over yet.
              Game Over only actually triggers if a 6th pig then needs a
              slot with none free (see parkUnit in logic.js), at which
              point this briefly reads 6/5 to match the extra overflow
              slot rendered below. */}
          <span className={`status-chip chip-holding${isHoldingFull ? ' danger' : ''}`}>
            Holding {state.holding.length + (isOverflowing ? 1 : 0)}/{HOLDING_CAPACITY}
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
                      disabled={!canPlay}
                      onClick={() => reactivateOrWarn(unit.id)}
                    />
                  ) : null}
                </div>
              )
            })}
            {/* A 6th slot, shown only for the brief window between a
                6th pig failing to find a Holding slot and the Game Over
                overlay appearing - never a permanent 6th slot. Its
                danger styling makes clear THIS pig is what overflowed
                Holding and caused the loss. */}
            {isOverflowing && (
              <div className="hold-slot hold-slot-overflow">
                <UnitToken unit={state.overflowUnit} colors={level.colors} disabled />
              </div>
            )}
          </div>
        </section>

        <section className="lane queue-lane">
          <h2>Queue</h2>
          {state.queue.every((column) => column.length === 0) ? (
            <span className="hint">Queue is empty</span>
          ) : (
            <div className={`queue-columns${queueHasMore ? ' has-fade' : ''}`} ref={queueRef}>
              {state.queue.map((column, columnIndex) => (
                <div className="queue-column" key={columnIndex}>
                  {column.map((unit, rowIndex) => (
                    <div className="queue-slot" key={unit.id}>
                      <UnitToken
                        unit={unit}
                        colors={level.colors}
                        disabled={rowIndex !== 0 || !canPlay}
                        onClick={() => dispatchOrWarn(unit.id)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      {state.status !== 'playing' && overlayReady && (
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
