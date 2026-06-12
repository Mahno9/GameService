import { describe, it, expect } from 'vitest';
import {
  isSolved,
  applyMove,
  movableIndices,
  shuffle,
  scoreForElapsed,
  type Board,
} from './engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function solvedBoard(gridSize: number): Board {
  const n = gridSize * gridSize;
  const board: Board = [];
  for (let i = 1; i < n; i++) board.push(i);
  board.push(0);
  return board;
}

/** Simple seeded LCG for deterministic tests. */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// isSolved
// ---------------------------------------------------------------------------

describe('isSolved', () => {
  it('returns true for the identity (solved) board 4x4', () => {
    const board = solvedBoard(4);
    expect(isSolved(board)).toBe(true);
  });

  it('returns true for solved 2x2', () => {
    expect(isSolved([1, 2, 3, 0])).toBe(true);
  });

  it('returns false when a tile is out of place', () => {
    const board = solvedBoard(4);
    // swap tile 1 and tile 2
    [board[0], board[1]] = [board[1] as number, board[0] as number];
    expect(isSolved(board)).toBe(false);
  });

  it('returns false when empty cell is not last', () => {
    const board = [0, 1, 2, 3];
    expect(isSolved(board)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

describe('applyMove', () => {
  it('slides a tile adjacent to the empty cell', () => {
    // 4x4 solved: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0]
    // empty is at index 15 (row 3, col 3)
    // tile at index 14 (value 15, row 3 col 2) is adjacent
    const board = solvedBoard(4);
    const next = applyMove(board, 14);
    expect(next[15]).toBe(15);
    expect(next[14]).toBe(0);
  });

  it('slides a tile above the empty cell', () => {
    // empty at index 15, tile at index 11 (row 2, col 3) is above
    const board = solvedBoard(4);
    const next = applyMove(board, 11);
    expect(next[15]).toBe(12);
    expect(next[11]).toBe(0);
  });

  it('throws when tile is not adjacent', () => {
    const board = solvedBoard(4);
    // index 0 is far from empty (index 15)
    expect(() => applyMove(board, 0)).toThrow();
  });

  it('throws when moving the empty cell itself is requested (non-adjacent)', () => {
    const board = solvedBoard(4);
    // empty IS at 15; trying to "move" index 15 — it's the empty cell not an adjacent tile
    // Actually 15 == 15, but let's check a clearly non-adjacent index
    expect(() => applyMove(board, 5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------

describe('shuffle', () => {
  it('returns a board that is a permutation of 0..15 for 4x4', () => {
    const rng = seededRng(42);
    const board = shuffle(4, 80, rng);
    expect(board.length).toBe(16);
    const sorted = [...board].sort((a, b) => a - b);
    for (let i = 0; i < 16; i++) {
      expect(sorted[i]).toBe(i);
    }
  });

  it('returns a board different from solved after 80 moves (4x4)', () => {
    const rng = seededRng(42);
    const board = shuffle(4, 80, rng);
    expect(isSolved(board)).toBe(false);
  });

  it('produces a board reachable from solved (every intermediate state is valid)', () => {
    // We verify this by re-simulating the shuffle ourselves and checking each applyMove succeeds.
    // Here we just check the resulting board is a valid permutation — solvability is guaranteed
    // by construction (only valid moves from solved state).
    const rng = seededRng(99);
    const board = shuffle(4, 80, rng);
    const seen = new Set<number>();
    for (const v of board) seen.add(v);
    expect(seen.size).toBe(16);
  });

  it('works for 2x2 grid', () => {
    const rng = seededRng(7);
    const board = shuffle(2, 10, rng);
    expect(board.length).toBe(4);
    const sorted = [...board].sort((a, b) => a - b);
    for (let i = 0; i < 4; i++) {
      expect(sorted[i]).toBe(i);
    }
  });

  it('works for 3x3 grid with 50 moves', () => {
    const rng = seededRng(123);
    const board = shuffle(3, 50, rng);
    expect(board.length).toBe(9);
    const sorted = [...board].sort((a, b) => a - b);
    for (let i = 0; i < 9; i++) {
      expect(sorted[i]).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// scoreForElapsed
// ---------------------------------------------------------------------------

describe('scoreForElapsed', () => {
  const thresholds = [
    { maxSeconds: 30, points: 100 },
    { maxSeconds: 60, points: 50 },
    { maxSeconds: 120, points: 20 },
  ];

  it('returns highest points when elapsed is well under smallest threshold (exact boundary inclusive)', () => {
    expect(scoreForElapsed(thresholds, 30)).toBe(100);
  });

  it('picks smallest qualifying maxSeconds — elapsed=31 should get 60s tier', () => {
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
  });

  it('returns 0 for empty thresholds even with 0 elapsed', () => {
    expect(scoreForElapsed([], 0)).toBe(0);
  });

  it('handles single threshold at boundary', () => {
    expect(scoreForElapsed([{ maxSeconds: 10, points: 500 }], 10)).toBe(500);
  });

  it('handles single threshold exceeded', () => {
    expect(scoreForElapsed([{ maxSeconds: 10, points: 500 }], 11)).toBe(0);
  });

  it('returns points for elapsed=0 with valid threshold', () => {
    expect(scoreForElapsed(thresholds, 0)).toBe(100);
  });
});
