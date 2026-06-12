/**
 * Pure arkanoid physics / logic. No DOM, no rendering, no side-effects on
 * anything outside the supplied state object.
 *
 * Coordinate system: a normalized field. x in [0, 1] (left..right),
 * y in [0, 1] (top..bottom). Blocks live in the top band y in [0, 0.5].
 * The paddle sits near the bottom (y ~ 0.92). The ball is lost when it
 * crosses y = 1 (bottom edge) unless a shield is active.
 *
 * Speeds are expressed in field-units per simulated step (dt is a
 * frame-rate multiplier, ~1 at 60fps). The renderer scales everything to
 * pixels; the engine never touches pixels.
 */

// ---------------------------------------------------------------------------
// Configuration types (subset the engine needs)
// ---------------------------------------------------------------------------

export interface ValuedBlockType {
  color: string;
  /** Share of total blocks, in percent (0..100). */
  percent: number;
  points: number;
  /** Seconds of level time before the block loses its value. 0 = never. */
  lifetimeSeconds: number;
}

export interface LevelConfig {
  backgroundImage?: string;
  totalBlocks: number;
  valuedBlockTypes: ValuedBlockType[];
  ballSpeed: number;
  ballAcceleration: number;
}

// ---------------------------------------------------------------------------
// Field / geometry constants
// ---------------------------------------------------------------------------

export const FIELD = {
  cols: 10,
  /** Blocks occupy y in [blockTop, blockTop + rows*blockH]. */
  blockTop: 0.06,
  blockAreaHeight: 0.44, // blocks live in y 0.06..0.50
  blockGap: 0.004,
  paddleY: 0.92,
  paddleHalfBase: 0.09, // half-width of the paddle (normalized) at default size
  paddleHeight: 0.025,
  ballRadius: 0.012,
} as const;

export const BONUS = {
  dropChance: 0.25,
  capsuleHalfW: 0.035,
  capsuleHalfH: 0.02,
  fallSpeed: 0.008,
  durationLong: 10, // seconds (expand / shrink / laser / slowTime)
  expandFactor: 1.5,
  shrinkFactor: 0.6,
  ballFastFactor: 1.3,
  ballSlowFactor: 0.75,
  slowTimeFactor: 0.5,
  laserSpeed: 0.03,
  explosionRadius: 0.15,
} as const;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface Block {
  /** Stable id, unique within a level. */
  id: number;
  /** Center coordinates (normalized). */
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  color: string;
  points: number;
  /** Remaining life in seconds; 0 means already worthless / never decays. */
  lifetimeSeconds: number;
  /** Accumulated level time when this block was placed. */
  bornAt: number;
  /** True once it has decayed to a plain grey worthless block. */
  decayed: boolean;
}

export interface Ball {
  x: number;
  y: number;
  /** Velocity components (field units per step). */
  vx: number;
  vy: number;
  /** Current scalar speed; direction is (vx,vy) normalized. */
  speed: number;
}

export interface BonusCapsule {
  id: number;
  kind: BonusKind;
  x: number;
  y: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
}

export type BonusKind =
  | 'expand'
  | 'shrink'
  | 'ballFast'
  | 'ballSlow'
  | 'extraBall'
  | 'laser'
  | 'shield'
  | 'explosion'
  | 'slowTime';

export const BONUS_KINDS: BonusKind[] = [
  'expand',
  'shrink',
  'ballFast',
  'ballSlow',
  'extraBall',
  'laser',
  'shield',
  'explosion',
  'slowTime',
];

/** Active timed effects (in seconds remaining). 0 / absent = inactive. */
export interface Effects {
  expand: number;
  shrink: number;
  laser: number;
  slowTime: number;
  /** Number of remaining shield uses (0 or 1, but kept as a count). */
  shield: number;
}

export interface GameState {
  level: LevelConfig;
  /** Index of the current level (0-based). */
  levelIndex: number;
  /** Seconds of in-level time elapsed (used for lifetimes). */
  levelTime: number;

  blocks: Block[];
  balls: Ball[];
  capsules: BonusCapsule[];
  projectiles: Projectile[];

  /** Paddle center x (normalized). */
  paddleX: number;
  /** Current paddle half-width (changes with expand/shrink). */
  paddleHalfW: number;

  effects: Effects;

  lives: number;
  score: number;

  /** Base ball speed for this level (before fast/slow multipliers). */
  baseSpeed: number;
  acceleration: number;

  /** Last broken block center — origin for explosion bonus. */
  lastBreak: { x: number; y: number } | null;

  /** Monotonic id source for spawned entities. */
  nextId: number;
}

// ---------------------------------------------------------------------------
// Events emitted by step()
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'bounceWall' }
  | { type: 'bouncePaddle' }
  | { type: 'blockBreak'; points: number; valued: boolean }
  | { type: 'bonusDrop'; kind: BonusKind }
  | { type: 'bonusCollect'; kind: BonusKind }
  | { type: 'ballLost' }
  | { type: 'shieldBounce' }
  | { type: 'lifeLost' }
  | { type: 'explosion'; x: number; y: number }
  | { type: 'levelClear' }
  | { type: 'gameOver' };

// ---------------------------------------------------------------------------
// Level / block-grid generation
// ---------------------------------------------------------------------------

/**
 * Generates the block grid for a level. Blocks fill a `cols`-wide grid with
 * `ceil(totalBlocks / cols)` rows; the last row may be partially filled so
 * exactly `totalBlocks` blocks are produced.
 *
 * Valued types are assigned by percentage (floor of percent * total),
 * scattered randomly; every remaining block is a plain grey worthless block
 * (points 0).
 */
export function generateBlocks(
  level: LevelConfig,
  rng: () => number,
  startId: number,
): { blocks: Block[]; nextId: number } {
  const total = Math.max(0, Math.floor(level.totalBlocks));
  const cols = FIELD.cols;
  const rows = Math.max(1, Math.ceil(total / cols));

  const cellW = 1 / cols;
  const cellH = FIELD.blockAreaHeight / rows;
  const halfW = cellW / 2 - FIELD.blockGap;
  const halfH = cellH / 2 - FIELD.blockGap;

  // Decide the type of each of the `total` slots.
  // -1 => plain grey block; >=0 => index into valuedBlockTypes.
  const typeOfSlot: number[] = new Array<number>(total).fill(-1);

  let cursor = 0;
  level.valuedBlockTypes.forEach((vt, vtIndex) => {
    const count = Math.floor((vt.percent / 100) * total);
    for (let i = 0; i < count && cursor < total; i++) {
      typeOfSlot[cursor++] = vtIndex;
    }
  });

  // Shuffle the assignments so valued blocks scatter (Fisher-Yates).
  for (let i = typeOfSlot.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = typeOfSlot[i] as number;
    typeOfSlot[i] = typeOfSlot[j] as number;
    typeOfSlot[j] = tmp;
  }

  const blocks: Block[] = [];
  let id = startId;
  for (let slot = 0; slot < total; slot++) {
    const row = Math.floor(slot / cols);
    const col = slot % cols;
    const cx = col * cellW + cellW / 2;
    const cy = FIELD.blockTop + row * cellH + cellH / 2;

    const typeIdx = typeOfSlot[slot] as number;
    const vt = typeIdx >= 0 ? level.valuedBlockTypes[typeIdx] : undefined;

    blocks.push({
      id: id++,
      cx,
      cy,
      halfW,
      halfH,
      color: vt ? vt.color : GREY,
      points: vt ? vt.points : 0,
      lifetimeSeconds: vt ? vt.lifetimeSeconds : 0,
      bornAt: 0,
      decayed: !vt,
    });
  }

  return { blocks, nextId: id };
}

export const GREY = '#8a8a9a';

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function defaultEffects(): Effects {
  return { expand: 0, shrink: 0, laser: 0, slowTime: 0, shield: 0 };
}

/** Builds a fresh ball launched upward from just above the paddle. */
export function makeBall(speed: number, paddleX: number, rng: () => number): Ball {
  // Launch angle: roughly straight up, with a small random horizontal tilt.
  const angle = (rng() - 0.5) * (Math.PI / 3); // +-30 deg from vertical
  const vx = Math.sin(angle);
  const vy = -Math.cos(angle); // upward (negative y)
  return { x: paddleX, y: FIELD.paddleY - FIELD.paddleHeight - FIELD.ballRadius - 0.01, vx, vy, speed };
}

/**
 * Creates the full game state for a given level. `lives` and `score` carry
 * over across levels (the caller supplies them).
 */
export function createState(
  level: LevelConfig,
  levelIndex: number,
  lives: number,
  score: number,
  rng: () => number,
): GameState {
  const speed = level.ballSpeed > 0 ? level.ballSpeed * 0.0016 : 0.0096;
  // ballSpeed config (~6) is a designer-facing number; scale into field units.
  const baseSpeed = speed;
  const paddleX = 0.5;
  const { blocks, nextId } = generateBlocks(level, rng, 1);

  return {
    level,
    levelIndex,
    levelTime: 0,
    blocks,
    balls: [makeBall(baseSpeed, paddleX, rng)],
    capsules: [],
    projectiles: [],
    paddleX,
    paddleHalfW: FIELD.paddleHalfBase,
    effects: defaultEffects(),
    lives,
    score,
    baseSpeed,
    acceleration: level.ballAcceleration,
    lastBreak: null,
    nextId,
  };
}

// ---------------------------------------------------------------------------
// Paddle
// ---------------------------------------------------------------------------

/** Clamps the paddle center so the whole paddle stays inside the field. */
export function clampPaddle(x: number, halfW: number): number {
  return Math.max(halfW, Math.min(1 - halfW, x));
}

/** Effective paddle half-width given active expand / shrink effects. */
export function effectivePaddleHalfW(state: GameState): number {
  let hw = FIELD.paddleHalfBase;
  if (state.effects.expand > 0) hw *= BONUS.expandFactor;
  if (state.effects.shrink > 0) hw *= BONUS.shrinkFactor;
  return hw;
}

// ---------------------------------------------------------------------------
// Collision helpers
// ---------------------------------------------------------------------------

/** AABB vs circle overlap test. Returns true if the ball touches the box. */
function ballHitsBox(
  bx: number,
  by: number,
  r: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): boolean {
  const nearestX = Math.max(cx - halfW, Math.min(bx, cx + halfW));
  const nearestY = Math.max(cy - halfH, Math.min(by, cy + halfH));
  const dx = bx - nearestX;
  const dy = by - nearestY;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Resolves a ball/box collision by reflecting the velocity on whichever axis
 * has the shallower penetration. Mutates the ball's vx/vy direction.
 */
function reflectBallOffBox(ball: Ball, cx: number, cy: number, halfW: number, halfH: number): void {
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const overlapX = halfW + FIELD.ballRadius - Math.abs(dx);
  const overlapY = halfH + FIELD.ballRadius - Math.abs(dy);
  if (overlapX < overlapY) {
    ball.vx = Math.abs(ball.vx) * Math.sign(dx || 1);
  } else {
    ball.vy = Math.abs(ball.vy) * Math.sign(dy || -1);
  }
  normalizeVel(ball);
}

function normalizeVel(ball: Ball): void {
  const mag = Math.hypot(ball.vx, ball.vy) || 1;
  ball.vx /= mag;
  ball.vy /= mag;
}

// ---------------------------------------------------------------------------
// Lifetime decay
// ---------------------------------------------------------------------------

/**
 * Decays valued blocks whose lifetime has expired into grey worthless blocks.
 * Mutates blocks in place. Returns the number that decayed this call.
 */
export function applyLifetimes(state: GameState): number {
  let decayedCount = 0;
  for (const b of state.blocks) {
    if (b.decayed || b.lifetimeSeconds <= 0) continue;
    if (state.levelTime - b.bornAt >= b.lifetimeSeconds) {
      b.decayed = true;
      b.color = GREY;
      b.points = 0;
      decayedCount++;
    }
  }
  return decayedCount;
}

// ---------------------------------------------------------------------------
// Block breaking
// ---------------------------------------------------------------------------

/**
 * Removes the block with the given index, scores its points, records the
 * break position, possibly drops a bonus, and returns the events produced.
 */
function breakBlockAt(state: GameState, index: number, rng: () => number, events: GameEvent[]): void {
  const block = state.blocks[index];
  if (!block) return;
  state.blocks.splice(index, 1);

  const valued = !block.decayed && block.points > 0;
  state.score += block.points;
  state.lastBreak = { x: block.cx, y: block.cy };
  events.push({ type: 'blockBreak', points: block.points, valued });

  // Only valued blocks can drop bonuses.
  if (valued && rng() < BONUS.dropChance) {
    const kind = BONUS_KINDS[Math.floor(rng() * BONUS_KINDS.length)] as BonusKind;
    state.capsules.push({ id: state.nextId++, kind, x: block.cx, y: block.cy });
    events.push({ type: 'bonusDrop', kind });
  }
}

// ---------------------------------------------------------------------------
// Bonus application
// ---------------------------------------------------------------------------

/** Applies a collected bonus effect to the state. */
export function applyBonus(state: GameState, kind: BonusKind, rng: () => number): void {
  switch (kind) {
    case 'expand':
      state.effects.expand = BONUS.durationLong;
      state.effects.shrink = 0;
      break;
    case 'shrink':
      state.effects.shrink = BONUS.durationLong;
      state.effects.expand = 0;
      break;
    case 'ballFast':
      state.baseSpeed *= BONUS.ballFastFactor;
      break;
    case 'ballSlow':
      state.baseSpeed *= BONUS.ballSlowFactor;
      break;
    case 'extraBall': {
      const src = state.balls[0];
      const speed = src ? src.speed : state.baseSpeed;
      const nb = makeBall(speed, state.paddleX, rng);
      // launch from current first ball position if available
      if (src) {
        nb.x = src.x;
        nb.y = src.y;
      }
      state.balls.push(nb);
      break;
    }
    case 'laser':
      state.effects.laser = BONUS.durationLong;
      break;
    case 'shield':
      state.effects.shield = 1;
      break;
    case 'explosion':
      // handled instantly by caller via detonateExplosion; nothing timed.
      break;
    case 'slowTime':
      state.effects.slowTime = BONUS.durationLong;
      break;
  }
}

/**
 * Destroys all blocks within `radius` of the given point (the last broken
 * block, by spec). Scores them and pushes blockBreak events.
 */
export function detonateExplosion(
  state: GameState,
  x: number,
  y: number,
  rng: () => number,
  events: GameEvent[],
): void {
  events.push({ type: 'explosion', x, y });
  const r2 = BONUS.explosionRadius * BONUS.explosionRadius;
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const b = state.blocks[i];
    if (!b) continue;
    const dx = b.cx - x;
    const dy = b.cy - y;
    if (dx * dx + dy * dy <= r2) {
      breakBlockAt(state, i, rng, events);
    }
  }
}

// ---------------------------------------------------------------------------
// Laser
// ---------------------------------------------------------------------------

/** Fires two laser projectiles from the paddle edges (only while laser active). */
export function fire(state: GameState): boolean {
  if (state.effects.laser <= 0) return false;
  const y = FIELD.paddleY - FIELD.paddleHeight;
  state.projectiles.push({ id: state.nextId++, x: state.paddleX - state.paddleHalfW, y });
  state.projectiles.push({ id: state.nextId++, x: state.paddleX + state.paddleHalfW, y });
  return true;
}

// ---------------------------------------------------------------------------
// Single ball step
// ---------------------------------------------------------------------------

/**
 * Advances a single ball by dt, resolving wall, paddle and block collisions.
 * Returns true if the ball survived, false if it fell past the bottom edge
 * (and was not saved by a shield). Pushes events.
 *
 * Exposed for tests; normally driven by step().
 */
export function stepBall(
  state: GameState,
  ball: Ball,
  dt: number,
  rng: () => number,
  events: GameEvent[],
): boolean {
  const timeScale = state.effects.slowTime > 0 ? BONUS.slowTimeFactor : 1;
  const move = ball.speed * dt * timeScale;
  ball.x += ball.vx * move;
  ball.y += ball.vy * move;

  const r = FIELD.ballRadius;

  // Walls (left / right / top).
  if (ball.x - r < 0) {
    ball.x = r;
    ball.vx = Math.abs(ball.vx);
    events.push({ type: 'bounceWall' });
  } else if (ball.x + r > 1) {
    ball.x = 1 - r;
    ball.vx = -Math.abs(ball.vx);
    events.push({ type: 'bounceWall' });
  }
  if (ball.y - r < 0) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
    events.push({ type: 'bounceWall' });
  }

  // Paddle bounce (only when moving downward and near the paddle row).
  const paddleTop = FIELD.paddleY - FIELD.paddleHeight / 2;
  if (
    ball.vy > 0 &&
    ball.y + r >= paddleTop &&
    ball.y - r <= FIELD.paddleY + FIELD.paddleHeight / 2 &&
    ball.x >= state.paddleX - state.paddleHalfW &&
    ball.x <= state.paddleX + state.paddleHalfW
  ) {
    bounceOffPaddle(state, ball);
    events.push({ type: 'bouncePaddle' });
  }

  // Block collisions: hit at most a few per step.
  for (let i = state.blocks.length - 1; i >= 0; i--) {
    const b = state.blocks[i];
    if (!b) continue;
    if (ballHitsBox(ball.x, ball.y, r, b.cx, b.cy, b.halfW, b.halfH)) {
      reflectBallOffBox(ball, b.cx, b.cy, b.halfW, b.halfH);
      breakBlockAt(state, i, rng, events);
      break; // one block per step keeps physics stable
    }
  }

  // Bottom edge.
  if (ball.y - r > 1) {
    if (state.effects.shield > 0) {
      state.effects.shield -= 1;
      ball.y = 1 - r;
      ball.vy = -Math.abs(ball.vy);
      events.push({ type: 'shieldBounce' });
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Reflects the ball off the paddle, choosing an outgoing angle in
 * [-60deg, +60deg] from vertical based on where it hit the paddle.
 * The angle's sign matches the hit-offset sign (left half => left, etc.).
 */
export function bounceOffPaddle(state: GameState, ball: Ball): void {
  const offset = (ball.x - state.paddleX) / state.paddleHalfW; // -1..1
  const clamped = Math.max(-1, Math.min(1, offset));
  const maxAngle = (60 * Math.PI) / 180;
  const angle = clamped * maxAngle;
  ball.vx = Math.sin(angle);
  ball.vy = -Math.cos(angle); // always upward after a paddle bounce
  normalizeVel(ball);
  // nudge above paddle so it doesn't immediately retrigger
  ball.y = FIELD.paddleY - FIELD.paddleHeight / 2 - FIELD.ballRadius - 0.001;
}

// ---------------------------------------------------------------------------
// Capsules & projectiles step
// ---------------------------------------------------------------------------

function stepCapsules(state: GameState, dt: number, rng: () => number, events: GameEvent[]): void {
  for (let i = state.capsules.length - 1; i >= 0; i--) {
    const c = state.capsules[i];
    if (!c) continue;
    c.y += BONUS.fallSpeed * dt;

    // Caught by paddle?
    const paddleTop = FIELD.paddleY - FIELD.paddleHeight / 2 - BONUS.capsuleHalfH;
    const paddleBottom = FIELD.paddleY + FIELD.paddleHeight / 2 + BONUS.capsuleHalfH;
    if (
      c.y >= paddleTop &&
      c.y <= paddleBottom &&
      c.x >= state.paddleX - state.paddleHalfW &&
      c.x <= state.paddleX + state.paddleHalfW
    ) {
      state.capsules.splice(i, 1);
      events.push({ type: 'bonusCollect', kind: c.kind });
      if (c.kind === 'explosion') {
        const origin = state.lastBreak ?? { x: c.x, y: c.y };
        detonateExplosion(state, origin.x, origin.y, rng, events);
      } else {
        applyBonus(state, c.kind, rng);
      }
      continue;
    }

    // Fell off the bottom.
    if (c.y - BONUS.capsuleHalfH > 1) {
      state.capsules.splice(i, 1);
    }
  }
}

function stepProjectiles(state: GameState, dt: number, rng: () => number, events: GameEvent[]): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (!p) continue;
    p.y -= BONUS.laserSpeed * dt;

    if (p.y < 0) {
      state.projectiles.splice(i, 1);
      continue;
    }

    // Hit first block?
    let hit = -1;
    for (let j = 0; j < state.blocks.length; j++) {
      const b = state.blocks[j];
      if (!b) continue;
      if (
        p.x >= b.cx - b.halfW &&
        p.x <= b.cx + b.halfW &&
        p.y >= b.cy - b.halfH &&
        p.y <= b.cy + b.halfH
      ) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      breakBlockAt(state, hit, rng, events);
      state.projectiles.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Effect timers
// ---------------------------------------------------------------------------

function tickEffects(state: GameState, dtSeconds: number): void {
  const e = state.effects;
  if (e.expand > 0) e.expand = Math.max(0, e.expand - dtSeconds);
  if (e.shrink > 0) e.shrink = Math.max(0, e.shrink - dtSeconds);
  if (e.laser > 0) e.laser = Math.max(0, e.laser - dtSeconds);
  if (e.slowTime > 0) e.slowTime = Math.max(0, e.slowTime - dtSeconds);
}

// ---------------------------------------------------------------------------
// Top-level step
// ---------------------------------------------------------------------------

/** Seconds of wall-clock time one unit of dt represents (60fps => 1/60). */
export const SECONDS_PER_DT = 1 / 60;

/**
 * Advances the whole simulation by dt (1 == one 60fps frame). Mutates state.
 * Returns the list of events that occurred this step. Lives are only lost
 * when ALL balls are gone; the level/game-over transitions emit their own
 * events but the renderer owns level switching.
 */
export function step(state: GameState, dt: number, rng: () => number): GameEvent[] {
  const events: GameEvent[] = [];

  // Time advance (real seconds for timers / lifetimes).
  const dtSeconds = dt * SECONDS_PER_DT;
  state.levelTime += dtSeconds;
  tickEffects(state, dtSeconds);
  applyLifetimes(state);

  // Sync paddle width to active effects.
  state.paddleHalfW = effectivePaddleHalfW(state);
  state.paddleX = clampPaddle(state.paddleX, state.paddleHalfW);

  // Gentle acceleration of every ball's scalar speed.
  for (const ball of state.balls) {
    ball.speed += state.acceleration * dtSeconds;
  }

  // Move balls; drop the ones that fall out.
  const survivors: Ball[] = [];
  for (const ball of state.balls) {
    const alive = stepBall(state, ball, dt, rng, events);
    if (alive) survivors.push(ball);
  }
  state.balls = survivors;

  // All balls gone -> lose a life (or game over).
  if (state.balls.length === 0) {
    events.push({ type: 'ballLost' });
    state.lives -= 1;
    if (state.lives <= 0) {
      events.push({ type: 'gameOver' });
    } else {
      events.push({ type: 'lifeLost' });
      // Reset paddle effects partially and respawn one ball.
      state.paddleX = 0.5;
      state.effects = defaultEffects();
      state.paddleHalfW = FIELD.paddleHalfBase;
      state.balls = [makeBall(state.baseSpeed, state.paddleX, rng)];
    }
  }

  stepCapsules(state, dt, rng, events);
  stepProjectiles(state, dt, rng, events);

  // Level cleared when every block (valued AND grey) is destroyed.
  if (state.blocks.length === 0) {
    events.push({ type: 'levelClear' });
  }

  return events;
}
