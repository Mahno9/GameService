import { describe, it, expect } from 'vitest';
import {
  type GameState,
  type LevelConfig,
  type GameEvent,
  FIELD,
  BONUS,
  GREY,
  generateBlocks,
  createState,
  bounceOffPaddle,
  stepBall,
  applyLifetimes,
  applyBonus,
  detonateExplosion,
  step,
  makeBall,
} from './engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic LCG. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** rng stub that always returns a fixed value. */
function constRng(v: number): () => number {
  return () => v;
}

function level(overrides: Partial<LevelConfig> = {}): LevelConfig {
  return {
    totalBlocks: 40,
    valuedBlockTypes: [],
    ballSpeed: 6,
    ballAcceleration: 0.002,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateBlocks — total count + percent distribution
// ---------------------------------------------------------------------------

describe('generateBlocks', () => {
  it('produces exactly totalBlocks blocks', () => {
    const lv = level({ totalBlocks: 40 });
    const { blocks } = generateBlocks(lv, seededRng(1), 1);
    expect(blocks.length).toBe(40);
  });

  it('handles a partial last row (totalBlocks not a multiple of cols)', () => {
    const lv = level({ totalBlocks: 23 });
    const { blocks } = generateBlocks(lv, seededRng(2), 1);
    expect(blocks.length).toBe(23);
  });

  it('distributes valued types by floor(percent) of total; rest are grey worthless', () => {
    const lv = level({
      totalBlocks: 40,
      valuedBlockTypes: [
        { color: 'red', percent: 25, points: 10, lifetimeSeconds: 0 }, // 10 blocks
        { color: 'gold', percent: 10, points: 50, lifetimeSeconds: 0 }, // 4 blocks
      ],
    });
    const { blocks } = generateBlocks(lv, seededRng(3), 1);
    const red = blocks.filter((b) => b.color === 'red');
    const gold = blocks.filter((b) => b.color === 'gold');
    const grey = blocks.filter((b) => b.color === GREY);
    expect(red.length).toBe(10);
    expect(gold.length).toBe(4);
    expect(grey.length).toBe(40 - 10 - 4);
    // Grey blocks are worthless and already decayed.
    expect(grey.every((b) => b.points === 0 && b.decayed)).toBe(true);
    expect(red.every((b) => b.points === 10 && !b.decayed)).toBe(true);
  });

  it('rounds percentages down (floor), never exceeding total', () => {
    const lv = level({
      totalBlocks: 7,
      valuedBlockTypes: [{ color: 'red', percent: 50, points: 5, lifetimeSeconds: 0 }], // floor(3.5)=3
    });
    const { blocks } = generateBlocks(lv, seededRng(4), 1);
    expect(blocks.filter((b) => b.color === 'red').length).toBe(3);
    expect(blocks.length).toBe(7);
  });

  it('assigns unique ids starting from startId', () => {
    const { blocks, nextId } = generateBlocks(level({ totalBlocks: 5 }), seededRng(5), 100);
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(5);
    expect(Math.min(...ids)).toBe(100);
    expect(nextId).toBe(105);
  });
});

// ---------------------------------------------------------------------------
// bounceOffPaddle — angle sign depends on hit offset
// ---------------------------------------------------------------------------

describe('bounceOffPaddle', () => {
  function makeState(): GameState {
    return createState(level(), 0, 3, 0, seededRng(1));
  }

  it('hitting left of paddle center sends the ball left (vx < 0)', () => {
    const st = makeState();
    st.paddleX = 0.5;
    const ball = makeBall(st.baseSpeed, 0.5, constRng(0.5));
    ball.x = 0.5 - st.paddleHalfW * 0.8; // left side
    ball.vy = 1; // moving down before bounce
    bounceOffPaddle(st, ball);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.vy).toBeLessThan(0); // always upward after bounce
  });

  it('hitting right of paddle center sends the ball right (vx > 0)', () => {
    const st = makeState();
    st.paddleX = 0.5;
    const ball = makeBall(st.baseSpeed, 0.5, constRng(0.5));
    ball.x = 0.5 + st.paddleHalfW * 0.8;
    ball.vy = 1;
    bounceOffPaddle(st, ball);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeLessThan(0);
  });

  it('hitting dead center bounces nearly straight up (vx ~ 0)', () => {
    const st = makeState();
    st.paddleX = 0.5;
    const ball = makeBall(st.baseSpeed, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.vy = 1;
    bounceOffPaddle(st, ball);
    expect(Math.abs(ball.vx)).toBeLessThan(1e-6);
  });

  it('outgoing angle never exceeds 60 degrees from vertical', () => {
    const st = makeState();
    st.paddleX = 0.5;
    const ball = makeBall(st.baseSpeed, 0.5, constRng(0.5));
    ball.x = 0.5 + st.paddleHalfW * 2; // beyond the edge -> clamped
    ball.vy = 1;
    bounceOffPaddle(st, ball);
    const angle = Math.atan2(ball.vx, -ball.vy); // from vertical
    expect(Math.abs(angle)).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// stepBall — block collision removes block & yields points
// ---------------------------------------------------------------------------

describe('stepBall block collision', () => {
  it('removes the hit block and adds its points to score, emitting blockBreak', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    // Single known block right in front of the ball.
    st.blocks = [
      {
        id: 1,
        cx: 0.5,
        cy: 0.3,
        halfW: 0.04,
        halfH: 0.02,
        color: 'red',
        points: 25,
        lifetimeSeconds: 0,
        bornAt: 0,
        decayed: false,
      },
    ];
    const ball = makeBall(0.001, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.y = 0.3; // overlapping the block; tiny speed keeps it overlapping after the move
    ball.vx = 0;
    ball.vy = -1;
    const events: GameEvent[] = [];
    // dropChance: use rng that never drops a bonus (>= 0.25)
    stepBall(st, ball, 1, constRng(0.99), events);
    expect(st.blocks.length).toBe(0);
    expect(st.score).toBe(25);
    const breaks = events.filter((e) => e.type === 'blockBreak');
    expect(breaks.length).toBe(1);
    expect((breaks[0] as { points: number }).points).toBe(25);
  });

  it('records lastBreak position at the broken block center', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [
      {
        id: 1,
        cx: 0.42,
        cy: 0.31,
        halfW: 0.04,
        halfH: 0.02,
        color: 'red',
        points: 10,
        lifetimeSeconds: 0,
        bornAt: 0,
        decayed: false,
      },
    ];
    const ball = makeBall(0.001, 0.42, constRng(0.5));
    ball.x = 0.42;
    ball.y = 0.31;
    ball.vy = -1;
    stepBall(st, ball, 1, constRng(0.99), []);
    expect(st.lastBreak).toEqual({ x: 0.42, y: 0.31 });
  });
});

// ---------------------------------------------------------------------------
// applyLifetimes — expiry zeroes value
// ---------------------------------------------------------------------------

describe('applyLifetimes', () => {
  it('decays a valued block into a grey worthless block after its lifetime', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [
      {
        id: 1,
        cx: 0.5,
        cy: 0.2,
        halfW: 0.04,
        halfH: 0.02,
        color: 'gold',
        points: 100,
        lifetimeSeconds: 5,
        bornAt: 0,
        decayed: false,
      },
    ];
    st.levelTime = 4.9;
    expect(applyLifetimes(st)).toBe(0);
    expect(st.blocks[0]!.points).toBe(100);

    st.levelTime = 5.0;
    expect(applyLifetimes(st)).toBe(1);
    expect(st.blocks[0]!.points).toBe(0);
    expect(st.blocks[0]!.color).toBe(GREY);
    expect(st.blocks[0]!.decayed).toBe(true);
  });

  it('leaves lifetimeSeconds=0 (permanent) blocks untouched', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [
      {
        id: 1,
        cx: 0.5,
        cy: 0.2,
        halfW: 0.04,
        halfH: 0.02,
        color: 'gold',
        points: 100,
        lifetimeSeconds: 0,
        bornAt: 0,
        decayed: false,
      },
    ];
    st.levelTime = 9999;
    expect(applyLifetimes(st)).toBe(0);
    expect(st.blocks[0]!.points).toBe(100);
  });

  it('a decayed block scores 0 when later broken', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [
      {
        id: 1,
        cx: 0.5,
        cy: 0.3,
        halfW: 0.04,
        halfH: 0.02,
        color: 'gold',
        points: 100,
        lifetimeSeconds: 1,
        bornAt: 0,
        decayed: false,
      },
    ];
    st.levelTime = 2;
    applyLifetimes(st);
    const ball = makeBall(0.001, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.y = 0.3;
    ball.vy = -1;
    stepBall(st, ball, 1, constRng(0.99), []);
    expect(st.blocks.length).toBe(0);
    expect(st.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shield — consumes exactly once
// ---------------------------------------------------------------------------

describe('shield', () => {
  it('bounces the ball once at the bottom edge, consuming the shield', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.effects.shield = 1;
    const ball = makeBall(0.05, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.y = 1 + FIELD.ballRadius + 0.05; // past the bottom
    ball.vx = 0;
    ball.vy = 1; // heading down
    const events: GameEvent[] = [];
    const alive = stepBall(st, ball, 1, constRng(0.99), events);
    expect(alive).toBe(true);
    expect(st.effects.shield).toBe(0);
    expect(events.some((e) => e.type === 'shieldBounce')).toBe(true);
    expect(ball.vy).toBeLessThan(0); // now going up
  });

  it('the next fall through the bottom (no shield left) loses the ball', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.effects.shield = 0;
    const ball = makeBall(0.05, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.y = 1 + FIELD.ballRadius + 0.05;
    ball.vy = 1;
    const alive = stepBall(st, ball, 1, constRng(0.99), []);
    expect(alive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// explosion — removes neighbours within radius
// ---------------------------------------------------------------------------

describe('detonateExplosion', () => {
  it('destroys blocks within the explosion radius and leaves far ones', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [
      mkBlock(1, 0.5, 0.3, 5), // origin (within radius)
      mkBlock(2, 0.5 + BONUS.explosionRadius * 0.5, 0.3, 5), // within radius
      mkBlock(3, 0.5 + BONUS.explosionRadius * 2, 0.3, 5), // far away
    ];
    const events: GameEvent[] = [];
    detonateExplosion(st, 0.5, 0.3, constRng(0.99), events);
    const remainingIds = st.blocks.map((b) => b.id);
    expect(remainingIds).toEqual([3]);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
  });
});

function mkBlock(id: number, cx: number, cy: number, points: number) {
  return {
    id,
    cx,
    cy,
    halfW: 0.04,
    halfH: 0.02,
    color: 'red',
    points,
    lifetimeSeconds: 0,
    bornAt: 0,
    decayed: false,
  };
}

// ---------------------------------------------------------------------------
// extraBall + multi-ball life rule
// ---------------------------------------------------------------------------

describe('multi-ball life loss', () => {
  it('extraBall adds a second ball', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    expect(st.balls.length).toBe(1);
    applyBonus(st, 'extraBall', seededRng(2));
    expect(st.balls.length).toBe(2);
  });

  it('losing one of two balls does NOT decrement lives', () => {
    const st = createState(level({ valuedBlockTypes: [] }), 0, 3, 0, seededRng(1));
    st.blocks = []; // avoid levelClear interference is fine; we check life only
    // Two balls: one safe near the paddle going up, one about to fall out.
    const safe = makeBall(0.001, 0.5, constRng(0.5));
    safe.x = 0.5;
    safe.y = 0.5;
    safe.vx = 0;
    safe.vy = -1;
    const doomed = makeBall(0.05, 0.5, constRng(0.5));
    doomed.x = 0.2;
    doomed.y = 1 + FIELD.ballRadius + 0.05;
    doomed.vx = 0;
    doomed.vy = 1;
    st.balls = [safe, doomed];

    const events = step(st, 1, constRng(0.99));
    expect(st.lives).toBe(3); // unchanged
    expect(st.balls.length).toBe(1);
    expect(events.some((e) => e.type === 'ballLost')).toBe(false);
  });

  it('losing the LAST ball decrements lives and emits ballLost + lifeLost', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [];
    const doomed = makeBall(0.05, 0.5, constRng(0.5));
    doomed.x = 0.5;
    doomed.y = 1 + FIELD.ballRadius + 0.05;
    doomed.vx = 0;
    doomed.vy = 1;
    st.balls = [doomed];

    const events = step(st, 1, constRng(0.99));
    expect(st.lives).toBe(2);
    expect(events.some((e) => e.type === 'ballLost')).toBe(true);
    expect(events.some((e) => e.type === 'lifeLost')).toBe(true);
    // A fresh ball is respawned.
    expect(st.balls.length).toBe(1);
  });

  it('losing the last ball at 1 life emits gameOver', () => {
    const st = createState(level(), 0, 1, 0, seededRng(1));
    st.blocks = [];
    const doomed = makeBall(0.05, 0.5, constRng(0.5));
    doomed.x = 0.5;
    doomed.y = 1 + FIELD.ballRadius + 0.05;
    doomed.vy = 1;
    st.balls = [doomed];

    const events = step(st, 1, constRng(0.99));
    expect(st.lives).toBe(0);
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bonus effects
// ---------------------------------------------------------------------------

describe('bonus effects', () => {
  it('expand and shrink are mutually exclusive and timed', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    applyBonus(st, 'expand', seededRng(1));
    expect(st.effects.expand).toBe(BONUS.durationLong);
    expect(st.effects.shrink).toBe(0);
    applyBonus(st, 'shrink', seededRng(1));
    expect(st.effects.shrink).toBe(BONUS.durationLong);
    expect(st.effects.expand).toBe(0);
  });

  it('ballFast / ballSlow scale base speed', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    const base = st.baseSpeed;
    applyBonus(st, 'ballFast', seededRng(1));
    expect(st.baseSpeed).toBeCloseTo(base * BONUS.ballFastFactor, 10);
    applyBonus(st, 'ballSlow', seededRng(1));
    expect(st.baseSpeed).toBeCloseTo(base * BONUS.ballFastFactor * BONUS.ballSlowFactor, 10);
  });
});

// ---------------------------------------------------------------------------
// level clear
// ---------------------------------------------------------------------------

describe('level clear', () => {
  it('emits levelClear when all blocks (grey and valued) are destroyed', () => {
    const st = createState(level(), 0, 3, 0, seededRng(1));
    st.blocks = [];
    // Keep the ball alive in the middle going up.
    const ball = makeBall(0.001, 0.5, constRng(0.5));
    ball.x = 0.5;
    ball.y = 0.5;
    ball.vy = -1;
    st.balls = [ball];
    const events = step(st, 1, constRng(0.99));
    expect(events.some((e) => e.type === 'levelClear')).toBe(true);
  });
});
