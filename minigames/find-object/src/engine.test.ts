import { describe, it, expect } from 'vitest';
import { scoreForElapsed, hitTest, pointInItem, type PlacedItem } from './engine.js';

// ---------------------------------------------------------------------------
// scoreForElapsed (same semantics as sliding-puzzle)
// ---------------------------------------------------------------------------

describe('scoreForElapsed', () => {
  const thresholds = [
    { maxSeconds: 30, points: 100 },
    { maxSeconds: 60, points: 50 },
    { maxSeconds: 120, points: 20 },
  ];

  it('returns highest points at exact smallest boundary', () => {
    expect(scoreForElapsed(thresholds, 30)).toBe(100);
  });

  it('picks smallest qualifying maxSeconds — elapsed=31 → 60s tier', () => {
    expect(scoreForElapsed(thresholds, 31)).toBe(50);
  });

  it('exact boundary for 60s tier', () => {
    expect(scoreForElapsed(thresholds, 60)).toBe(50);
  });

  it('picks 120s tier when elapsed=61', () => {
    expect(scoreForElapsed(thresholds, 61)).toBe(20);
  });

  it('exact boundary for 120s tier', () => {
    expect(scoreForElapsed(thresholds, 120)).toBe(20);
  });

  it('returns 0 when elapsed exceeds all thresholds', () => {
    expect(scoreForElapsed(thresholds, 121)).toBe(0);
    expect(scoreForElapsed(thresholds, 9999)).toBe(0);
  });

  it('returns 0 for empty thresholds array', () => {
    expect(scoreForElapsed([], 10)).toBe(0);
    expect(scoreForElapsed([], 0)).toBe(0);
  });

  it('handles single threshold at boundary / exceeded', () => {
    expect(scoreForElapsed([{ maxSeconds: 10, points: 500 }], 10)).toBe(500);
    expect(scoreForElapsed([{ maxSeconds: 10, points: 500 }], 11)).toBe(0);
  });

  it('returns points for elapsed=0 with valid threshold', () => {
    expect(scoreForElapsed(thresholds, 0)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// hitTest / pointInItem
// ---------------------------------------------------------------------------

function item(overrides: Partial<PlacedItem> & { id: string }): PlacedItem {
  return {
    x: 100,
    y: 100,
    naturalWidth: 40,
    naturalHeight: 20,
    scale: 1,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  };
}

describe('pointInItem (unrotated)', () => {
  const a = item({ id: 'a' }); // center (100,100), 40x20 → x:[80,120] y:[90,110]

  it('hits the center', () => {
    expect(pointInItem({ x: 100, y: 100 }, a)).toBe(true);
  });

  it('hits inside near the edge', () => {
    expect(pointInItem({ x: 119, y: 109 }, a)).toBe(true);
  });

  it('hits exactly on the corner (inclusive)', () => {
    expect(pointInItem({ x: 120, y: 110 }, a)).toBe(true);
  });

  it('misses just outside on x', () => {
    expect(pointInItem({ x: 121, y: 100 }, a)).toBe(false);
  });

  it('misses just outside on y', () => {
    expect(pointInItem({ x: 100, y: 111 }, a)).toBe(false);
  });
});

describe('pointInItem (rotated 45°)', () => {
  // A 20x20 square centered at origin, rotated 45°.
  const sq = item({ id: 'sq', x: 0, y: 0, naturalWidth: 20, naturalHeight: 20, rotation: 45 });
  // Half-diagonal = sqrt(2)*10 ≈ 14.14. Rotated square has a vertex pointing
  // straight up/right/down/left at distance ~14.14 from center.

  it('hits along the rotated axis toward a vertex (point that would miss the unrotated square)', () => {
    // (13, 0): for the unrotated 20x20 square half-width is 10 so x=13 would MISS,
    // but the 45°-rotated square reaches a vertex at (~14.14, 0), so this HITS.
    expect(pointInItem({ x: 13, y: 0 }, sq)).toBe(true);
  });

  it('misses at the original corner direction (10,10) which is now outside', () => {
    // (10,10) is a corner of the unrotated square (on the boundary), but after a
    // 45° rotation the square no longer covers that diagonal corner.
    expect(pointInItem({ x: 10, y: 10 }, sq)).toBe(false);
  });

  it('hits the center', () => {
    expect(pointInItem({ x: 0, y: 0 }, sq)).toBe(true);
  });

  it('misses beyond the vertex', () => {
    expect(pointInItem({ x: 15, y: 0 }, sq)).toBe(false);
  });
});

describe('pointInItem (scale handling)', () => {
  // 20x20 base, scale 2 → effective 40x40, center (0,0), x/y:[-20,20]
  const big = item({ id: 'big', x: 0, y: 0, naturalWidth: 20, naturalHeight: 20, scale: 2 });

  it('hits a point that is only inside because of scale', () => {
    // x=15 is outside the unscaled half-width (10) but inside scaled half-width (20)
    expect(pointInItem({ x: 15, y: 15 }, big)).toBe(true);
  });

  it('misses beyond the scaled extent', () => {
    expect(pointInItem({ x: 21, y: 0 }, big)).toBe(false);
  });

  it('returns false for zero scale', () => {
    expect(pointInItem({ x: 0, y: 0 }, item({ id: 'z', x: 0, y: 0, scale: 0 }))).toBe(false);
  });
});

describe('hitTest (topmost selection)', () => {
  it('returns null when nothing is hit', () => {
    const items = [item({ id: 'a', x: 0, y: 0 })];
    expect(hitTest({ x: 1000, y: 1000 }, items)).toBeNull();
  });

  it('returns the only hit item', () => {
    const items = [item({ id: 'a', x: 0, y: 0 })];
    expect(hitTest({ x: 0, y: 0 }, items)).toBe('a');
  });

  it('returns the topmost item by zIndex among overlapping hits', () => {
    const items = [
      item({ id: 'low', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 1 }),
      item({ id: 'high', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 5 }),
      item({ id: 'mid', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 3 }),
    ];
    expect(hitTest({ x: 0, y: 0 }, items)).toBe('high');
  });

  it('breaks zIndex ties by later array position (paint order)', () => {
    const items = [
      item({ id: 'first', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 2 }),
      item({ id: 'second', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 2 }),
    ];
    expect(hitTest({ x: 0, y: 0 }, items)).toBe('second');
  });

  it('ignores items not under the point even if higher zIndex', () => {
    const items = [
      item({ id: 'under', x: 0, y: 0, naturalWidth: 40, naturalHeight: 40, zIndex: 1 }),
      item({ id: 'far', x: 500, y: 500, naturalWidth: 40, naturalHeight: 40, zIndex: 99 }),
    ];
    expect(hitTest({ x: 0, y: 0 }, items)).toBe('under');
  });
});
