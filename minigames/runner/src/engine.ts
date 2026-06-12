/**
 * Pure runner simulation. No DOM, no side-effects.
 * All tunables are constants defined here.
 * Game units: 1 unit = 1px at base scale.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const GRAVITY = 1800;          // px/s²
export const JUMP_IMPULSE = -700;     // px/s (negative = upward)
export const GROUND_Y = 300;          // y-coordinate of the ground line (character bottom rests here)
export const CHAR_WIDTH = 48;         // character hitbox width
export const CHAR_HEIGHT = 64;        // character hitbox height (full)
export const CHAR_X = 80;             // character fixed x position
export const FORGIVENESS = 0.10;      // 10% shrink on each side of hitbox for collision

export const MIN_GAP_BASE = 200;      // minimum distance between obstacles (base)
export const MAX_GAP_BASE = 500;      // maximum distance between obstacles (base)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpeedPoint {
  distance: number;
  speed: number;
}

export interface ObstacleType {
  width: number;
  height: number;
  weight: number;
  image?: string;
  overcomeImage?: string;
  overcomeSound?: string;
}

export interface Obstacle {
  id: number;
  typeIndex: number;
  x: number;        // left edge in world/canvas x
  width: number;
  height: number;
  overcome: boolean;
}

export interface GameState {
  distance: number;       // total distance covered
  speed: number;          // current speed (px/s)
  lives: number;
  charY: number;          // character bottom y (ground = GROUND_Y)
  charVY: number;         // vertical velocity (positive = downward)
  grounded: boolean;
  crouching: boolean;
  invulnerable: number;   // seconds of remaining invulnerability after hit
  obstacles: Obstacle[];
  nextObstacleX: number;  // x at which next obstacle spawns (world x = canvas right edge + gap)
  dead: boolean;
  gameOver: boolean;
  idCounter: number;
}

export type GameEvent =
  | { type: 'hit'; obstacleId: number }
  | { type: 'overcome'; obstacleId: number; obstacleTypeIndex: number; overcomeSound?: string; overcomeImage?: string };

// ---------------------------------------------------------------------------
// speedAt — piecewise-linear interpolation, clamped to endpoints
// ---------------------------------------------------------------------------

export function speedAt(curve: SpeedPoint[], distance: number): number {
  if (curve.length === 0) return 6;
  if (curve.length === 1) return (curve[0] as SpeedPoint).speed;

  // Clamp below first point
  const first = curve[0] as SpeedPoint;
  if (distance <= first.distance) return first.speed;

  // Clamp above last point
  const last = curve[curve.length - 1] as SpeedPoint;
  if (distance >= last.distance) return last.speed;

  // Find bracketing segment
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i] as SpeedPoint;
    const b = curve[i + 1] as SpeedPoint;
    if (distance >= a.distance && distance <= b.distance) {
      const t = (distance - a.distance) / (b.distance - a.distance);
      return a.speed + t * (b.speed - a.speed);
    }
  }

  return last.speed;
}

// ---------------------------------------------------------------------------
// pickWeighted — weighted random obstacle type index
// ---------------------------------------------------------------------------

export function pickWeighted(types: ObstacleType[], rnd: number): number {
  if (types.length === 0) return 0;
  const totalWeight = types.reduce((sum, t) => sum + t.weight, 0);
  let r = rnd * totalWeight;
  for (let i = 0; i < types.length; i++) {
    const t = types[i] as ObstacleType;
    r -= t.weight;
    if (r <= 0) return i;
  }
  return types.length - 1;
}

// ---------------------------------------------------------------------------
// initGameState
// ---------------------------------------------------------------------------

export function initGameState(lives: number, canvasWidth: number): GameState {
  return {
    distance: 0,
    speed: 6,
    lives,
    charY: GROUND_Y,
    charVY: 0,
    grounded: true,
    crouching: false,
    invulnerable: 0,
    obstacles: [],
    nextObstacleX: canvasWidth + MIN_GAP_BASE + Math.random() * (MAX_GAP_BASE - MIN_GAP_BASE),
    dead: false,
    gameOver: false,
    idCounter: 0,
  };
}

// ---------------------------------------------------------------------------
// jump / crouch
// ---------------------------------------------------------------------------

export function jump(state: GameState): void {
  if (!state.grounded || state.dead) return;
  state.charVY = JUMP_IMPULSE;
  state.grounded = false;
}

export function setCrouch(state: GameState, crouching: boolean): void {
  state.crouching = crouching;
}

// ---------------------------------------------------------------------------
// stepPhysics — main simulation step
// ---------------------------------------------------------------------------

export function stepPhysics(
  state: GameState,
  dt: number,
  curve: SpeedPoint[],
  obstacleTypes: ObstacleType[],
  canvasWidth: number,
): GameEvent[] {
  if (state.dead || state.gameOver) return [];

  const events: GameEvent[] = [];

  // Update speed from curve
  state.speed = speedAt(curve, state.distance);

  // Advance distance
  state.distance += state.speed * dt;

  // Character physics
  if (!state.grounded) {
    state.charVY += GRAVITY * dt;
    state.charY += state.charVY * dt;

    if (state.charY >= GROUND_Y) {
      state.charY = GROUND_Y;
      state.charVY = 0;
      state.grounded = true;
    }
  }

  // Invulnerability countdown
  if (state.invulnerable > 0) {
    state.invulnerable = Math.max(0, state.invulnerable - dt);
  }

  // Move obstacles left
  const dx = state.speed * dt;
  for (const obs of state.obstacles) {
    obs.x -= dx;
  }

  // Spawn new obstacle when needed
  // nextObstacleX tracks where (in screen coords) the next obstacle should appear
  // We convert: spawn when all existing obstacles have cleared the screen enough
  // Use a simpler model: track spawn by distance
  state.nextObstacleX -= dx;
  if (state.nextObstacleX <= canvasWidth && obstacleTypes.length > 0) {
    const typeIdx = pickWeighted(obstacleTypes, Math.random());
    const obsType = obstacleTypes[typeIdx] as ObstacleType;
    const gapScale = Math.max(0.5, 6 / state.speed); // smaller gap at higher speed
    const minGap = MIN_GAP_BASE * gapScale;
    const maxGap = MAX_GAP_BASE * gapScale;
    const gap = minGap + Math.random() * (maxGap - minGap);

    const newObs: Obstacle = {
      id: state.idCounter++,
      typeIndex: typeIdx,
      x: canvasWidth + gap,
      width: obsType.width,
      height: obsType.height,
      overcome: false,
    };
    state.obstacles.push(newObs);
    state.nextObstacleX = canvasWidth + gap + obsType.width;
  }

  // Effective character hitbox
  const charHeight = state.crouching ? CHAR_HEIGHT / 2 : CHAR_HEIGHT;
  const charTop = state.charY - charHeight;
  const charBottom = state.charY;
  const fw = CHAR_WIDTH * (1 - FORGIVENESS * 2);
  const fh = charHeight * (1 - FORGIVENESS * 2);
  const charLeft = CHAR_X - CHAR_WIDTH / 2 + CHAR_WIDTH * FORGIVENESS;
  const charRight = charLeft + fw;
  const charTopF = charTop + charHeight * FORGIVENESS;
  const charBottomF = charTopF + fh;

  // Collision and overcome detection
  const toRemove: number[] = [];
  for (const obs of state.obstacles) {
    const obsLeft = obs.x;
    const obsRight = obs.x + obs.width;
    const obsTop = GROUND_Y - obs.height;
    const obsBottom = GROUND_Y;

    // Check overcome: obstacle right edge has passed character left edge (without collision)
    if (!obs.overcome && obsRight < CHAR_X - CHAR_WIDTH / 2) {
      obs.overcome = true;
      const obsType = obstacleTypes[obs.typeIndex];
      const overcomeEvt: GameEvent = {
        type: 'overcome',
        obstacleId: obs.id,
        obstacleTypeIndex: obs.typeIndex,
        ...(obsType?.overcomeSound !== undefined && { overcomeSound: obsType.overcomeSound }),
        ...(obsType?.overcomeImage !== undefined && { overcomeImage: obsType.overcomeImage }),
      };
      events.push(overcomeEvt);
    }

    // Remove obstacles that are fully off-screen to the left
    if (obsRight < -200) {
      toRemove.push(obs.id);
      continue;
    }

    // Collision detection (AABB with forgiveness)
    if (state.invulnerable <= 0) {
      const overlap =
        charLeft < obsRight &&
        charRight > obsLeft &&
        charTopF < obsBottom &&
        charBottomF > obsTop;

      if (overlap) {
        events.push({ type: 'hit', obstacleId: obs.id });
        state.lives--;
        state.invulnerable = 1.5;
        if (state.lives <= 0) {
          state.dead = true;
          state.gameOver = true;
        }
        // Remove the collided obstacle
        toRemove.push(obs.id);
      }
    }
  }

  // Remove processed obstacles
  state.obstacles = state.obstacles.filter((o) => !toRemove.includes(o.id));

  return events;
}
