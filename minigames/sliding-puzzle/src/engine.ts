/**
 * Pure sliding-puzzle logic. No DOM, no side-effects.
 * Board representation: number[] of length gridSize*gridSize.
 * Value 0 = the empty cell. Tiles 1..(N*N-1) are piece IDs.
 * Solved state: [1, 2, ..., N*N-1, 0]
 */

export type Board = number[];

/** Returns true when the board is in the solved position. */
export function isSolved(board: Board): boolean {
  const n = board.length;
  for (let i = 0; i < n - 1; i++) {
    if (board[i] !== i + 1) return false;
  }
  return board[n - 1] === 0;
}

/**
 * Returns the indices of tiles that can legally slide (i.e. are
 * orthogonally adjacent to the empty cell).
 */
export function movableIndices(board: Board, gridSize: number): number[] {
  const emptyIdx = board.indexOf(0);
  const row = Math.floor(emptyIdx / gridSize);
  const col = emptyIdx % gridSize;
  const result: number[] = [];

  // Up: tile below empty can slide up
  if (row < gridSize - 1) result.push(emptyIdx + gridSize);
  // Down: tile above empty can slide down
  if (row > 0) result.push(emptyIdx - gridSize);
  // Right: tile to the left of empty can slide right
  if (col > 0) result.push(emptyIdx - 1);
  // Left: tile to the right of empty can slide left
  if (col < gridSize - 1) result.push(emptyIdx + 1);

  return result;
}

/**
 * Applies a move: slides the tile at tileIndex into the empty cell.
 * Returns a new board. Throws if the move is invalid.
 */
export function applyMove(board: Board, tileIndex: number): Board {
  const emptyIdx = board.indexOf(0);
  const gridSize = Math.round(Math.sqrt(board.length));

  const emptyRow = Math.floor(emptyIdx / gridSize);
  const emptyCol = emptyIdx % gridSize;
  const tileRow = Math.floor(tileIndex / gridSize);
  const tileCol = tileIndex % gridSize;

  const rowDiff = Math.abs(emptyRow - tileRow);
  const colDiff = Math.abs(emptyCol - tileCol);
  const isAdjacent = (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);

  if (!isAdjacent) {
    throw new Error(`Tile at index ${tileIndex} is not adjacent to the empty cell at ${emptyIdx}`);
  }

  const next = board.slice();
  next[emptyIdx] = next[tileIndex] as number;
  next[tileIndex] = 0;
  return next;
}

/**
 * Generates a solvable board by applying `moves` random valid moves
 * from the solved position. Never immediately undoes the previous move,
 * ensuring the board is always reachable from solved.
 */
export function shuffle(gridSize: number, moves: number, rng: () => number): Board {
  const n = gridSize * gridSize;
  // Build solved board: [1, 2, ..., n-1, 0]
  const solved: Board = [];
  for (let i = 1; i < n; i++) solved.push(i);
  solved.push(0);

  let board: Board = solved.slice();
  let lastEmptyIdx = board.indexOf(0); // starts at n-1

  for (let i = 0; i < moves; i++) {
    const candidates = movableIndices(board, gridSize).filter((idx) => {
      // Avoid immediately undoing: don't move the tile that is now in lastEmptyIdx
      // (that tile came from where the empty just was, moving it back = undo)
      return idx !== lastEmptyIdx;
    });

    // If all candidates would undo (shouldn't happen on a valid board > 1x1), relax filter
    const pool = candidates.length > 0 ? candidates : movableIndices(board, gridSize);

    const pick = pool[Math.floor(rng() * pool.length)] as number;
    const prevEmptyIdx = board.indexOf(0);
    board = applyMove(board, pick);
    lastEmptyIdx = prevEmptyIdx;
  }

  return board;
}

export interface ScoreThreshold {
  maxSeconds: number;
  points: number;
}

/**
 * Returns the points for the given elapsed time.
 * Finds the threshold with the smallest maxSeconds >= elapsedSeconds.
 * Returns 0 if no threshold qualifies or the list is empty.
 */
export function scoreForElapsed(thresholds: ScoreThreshold[], elapsedSeconds: number): number {
  if (thresholds.length === 0) return 0;

  // Find qualifying thresholds (maxSeconds >= elapsedSeconds), pick the smallest maxSeconds
  let best: ScoreThreshold | null = null;
  for (const t of thresholds) {
    if (t.maxSeconds >= elapsedSeconds) {
      if (best === null || t.maxSeconds < best.maxSeconds) {
        best = t;
      }
    }
  }

  return best !== null ? best.points : 0;
}

/** Normalized crop rect over the source image (each in [0,1]). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * CSS background-size/position for one tile so the chosen crop region of the
 * image is stretched across the whole NxN board and this tile shows its slice.
 * With no crop (cw=ch=1) it reduces to the classic `gridSize*100%` /
 * `col/(gridSize-1)` mapping (whole image stretched to the board).
 */
export function tileBackground(
  gridSize: number,
  srcCol: number,
  srcRow: number,
  crop?: Crop,
): { size: string; position: string } {
  const cx = crop?.x ?? 0;
  const cy = crop?.y ?? 0;
  const cw = crop?.w ?? 1;
  const ch = crop?.h ?? 1;
  return {
    size: `${(gridSize / cw) * 100}% ${(gridSize / ch) * 100}%`,
    position:
      `${((gridSize * cx + srcCol * cw) / (gridSize - cw)) * 100}% ` +
      `${((gridSize * cy + srcRow * ch) / (gridSize - ch)) * 100}%`,
  };
}
