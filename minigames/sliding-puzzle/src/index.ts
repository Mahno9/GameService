import {
  type Board,
  isSolved,
  movableIndices,
  applyMove,
  shuffle,
  scoreForElapsed,
  type ScoreThreshold,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / Callback types
// ---------------------------------------------------------------------------

interface RoundConfig {
  image: string;
  shuffleMoves: number;
  scoreThresholds: ScoreThreshold[];
}

interface SoundsConfig {
  tileMove?: string;
  roundWin?: string;
  gameWin?: string;
}

interface GameConfig {
  gridSize: number;
  rounds: RoundConfig[];
  sounds?: SoundsConfig;
  muted?: boolean;
}

interface GameResult {
  score: number;
  won: boolean;
}

interface Callbacks {
  onComplete: (result: GameResult) => void;
  onExit: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREFIX = 'sp-';
const FADE_MS = 300;
const TILE_TRANSITION_MS = 120;

function cls(...names: string[]): string {
  return names.map((n) => PREFIX + n).join(' ');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      e.setAttribute(k, v);
    }
  }
  return e;
}

let audioCtx: AudioContext | null = null;
const audioBuffers = new Map<string, AudioBuffer>();

function preloadSound(url: string | undefined): void {
  if (!url || audioBuffers.has(url)) return;
  if (!audioCtx) audioCtx = new AudioContext();
  void fetch(url).then(r => r.arrayBuffer()).then(ab => audioCtx!.decodeAudioData(ab)).then(buf => audioBuffers.set(url, buf)).catch(() => {});
}

function playSound(url: string | undefined, muted: boolean): void {
  if (muted || !url) return;
  const buf = audioBuffers.get(url);
  if (!buf || !audioCtx) { new Audio(url).play().catch(() => {}); return; }
  const ctx = audioCtx;
  const fire = () => {
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
  };
  ctx.state !== 'running' ? void ctx.resume().then(fire) : fire();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  color: #e0e0f0;
  font-family: system-ui, sans-serif;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
}
.${PREFIX}root.${PREFIX}visible {
  opacity: 1;
}
.${PREFIX}hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #16213e;
  font-size: 14px;
  gap: 8px;
  flex-shrink: 0;
}
.${PREFIX}hud-round {
  font-weight: 600;
  color: #a0c4ff;
}
.${PREFIX}hud-timer {
  font-variant-numeric: tabular-nums;
  color: #c0c0d8;
}
.${PREFIX}hud-controls {
  display: flex;
  gap: 6px;
}
.${PREFIX}btn {
  background: #0f3460;
  border: 1px solid #4a4a7a;
  color: #e0e0f0;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1.2;
  transition: background 0.15s;
}
.${PREFIX}btn:hover {
  background: #1a4a80;
}
.${PREFIX}board-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  min-height: 0;
}
.${PREFIX}board {
  position: relative;
}
.${PREFIX}tile {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #2a2a4a;
  border-radius: 4px;
  cursor: pointer;
  transition: left ${TILE_TRANSITION_MS}ms ease, top ${TILE_TRANSITION_MS}ms ease;
  overflow: hidden;
  touch-action: none;
}
.${PREFIX}tile:hover {
  border-color: #6a6aaa;
  z-index: 1;
}
.${PREFIX}tile.${PREFIX}empty {
  visibility: hidden;
  cursor: default;
}
.${PREFIX}overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 30, 0.85);
  z-index: 10;
  text-align: center;
  padding: 24px;
}
.${PREFIX}overlay h2 {
  font-size: 22px;
  margin: 0 0 12px;
  color: #a0c4ff;
}
.${PREFIX}overlay p {
  font-size: 16px;
  margin: 0 0 20px;
  color: #d0d0e8;
}
.${PREFIX}overlay .${PREFIX}btn {
  font-size: 15px;
  padding: 8px 24px;
}
.${PREFIX}assembled {
  transition: border-color 0.3s;
  border-color: transparent !important;
}
`;

// ---------------------------------------------------------------------------
// Main init export
// ---------------------------------------------------------------------------

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): { destroy: () => void } {
  // --- inject styles scoped inside container ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  // --- root element ---
  const root = el('div', `${PREFIX}root`);
  container.appendChild(root);

  // Fade in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add(`${PREFIX}visible`);
    });
  });

  // --- state ---
  let muted = config.muted === true;
  let done = false;
  let currentRound = 0;

  // Preload sounds so cloneNode() plays instantly
  Object.values(config.sounds ?? {}).forEach(preloadSound);
  let board: Board = [];
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let elapsedSeconds = 0;
  let timerStarted = false;
  let totalScore = 0;
  let roundScore = 0;

  const gridSize = config.gridSize;
  const rounds = config.rounds;

  // --- once-latch helpers ---
  function fireComplete(result: GameResult): void {
    if (done) return;
    done = true;
    stopTimer();
    fadeOut(() => callbacks.onComplete(result));
  }

  function fireExit(): void {
    if (done) return;
    done = true;
    stopTimer();
    fadeOut(() => callbacks.onExit());
  }

  function fadeOut(cb: () => void): void {
    root.classList.remove(`${PREFIX}visible`);
    setTimeout(cb, FADE_MS);
  }

  // --- HUD ---
  const hud = el('div', `${PREFIX}hud`);
  const hudRound = el('div', `${PREFIX}hud-round`);
  const hudTimer = el('div', `${PREFIX}hud-timer`);
  const hudControls = el('div', `${PREFIX}hud-controls`);
  const muteBtn = el('button', `${PREFIX}btn`);
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.title = 'Mute / Unmute';
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  const exitBtn = el('button', `${PREFIX}btn`);
  exitBtn.textContent = '✕';
  exitBtn.title = 'Выйти';
  exitBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    fireExit();
  });

  hudControls.appendChild(muteBtn);
  hudControls.appendChild(exitBtn);
  hud.appendChild(hudRound);
  hud.appendChild(hudTimer);
  hud.appendChild(hudControls);
  root.appendChild(hud);

  // --- board wrapper ---
  const boardWrap = el('div', `${PREFIX}board-wrap`);
  const boardEl = el('div', `${PREFIX}board`);
  boardWrap.appendChild(boardEl);
  root.appendChild(boardWrap);

  // --- timer ---
  function startTimer(): void {
    if (timerStarted) return;
    timerStarted = true;
    elapsedSeconds = 0;
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      updateHudTimer();
    }, 1000);
  }

  function stopTimer(): void {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateHudTimer(): void {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    hudTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateHudRound(): void {
    hudRound.textContent = `Раунд ${currentRound + 1} / ${rounds.length}`;
  }

  // --- tile rendering ---
  type TileDiv = HTMLDivElement & { _tileValue: number };
  let tiles: TileDiv[] = [];
  let tileSize = 0;

  function computeTileSize(): number {
    // Fit inside boardWrap, square
    const wrapW = boardWrap.clientWidth - 24;
    const wrapH = boardWrap.clientHeight - 24;
    const maxBoard = Math.min(wrapW, wrapH, 560);
    return Math.floor(maxBoard / gridSize);
  }

  function renderBoard(roundCfg: RoundConfig): void {
    boardEl.innerHTML = '';
    tiles = [];

    tileSize = computeTileSize();
    const boardPx = tileSize * gridSize;
    boardEl.style.width = `${boardPx}px`;
    boardEl.style.height = `${boardPx}px`;

    for (let i = 0; i < board.length; i++) {
      const value = board[i] as number;
      const tileEl = el('div', `${PREFIX}tile`) as TileDiv;
      tileEl._tileValue = value;

      const col = i % gridSize;
      const row = Math.floor(i / gridSize);
      tileEl.style.width = `${tileSize}px`;
      tileEl.style.height = `${tileSize}px`;
      tileEl.style.left = `${col * tileSize}px`;
      tileEl.style.top = `${row * tileSize}px`;

      if (value === 0) {
        tileEl.classList.add(`${PREFIX}empty`);
      } else {
        // background-image
        const srcCol = (value - 1) % gridSize;
        const srcRow = Math.floor((value - 1) / gridSize);
        tileEl.style.backgroundImage = `url(${JSON.stringify(roundCfg.image)})`;
        tileEl.style.backgroundSize = `${gridSize * 100}% ${gridSize * 100}%`;
        tileEl.style.backgroundPosition = `${(srcCol / (gridSize - 1)) * 100}% ${(srcRow / (gridSize - 1)) * 100}%`;
        tileEl.style.backgroundRepeat = 'no-repeat';

        tileEl.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          handleTileTap(tileEl);
        });
      }

      boardEl.appendChild(tileEl);
      tiles.push(tileEl);
    }
  }

  function syncTilePositions(): void {
    for (let i = 0; i < board.length; i++) {
      const value = board[i] as number;
      const tileEl = tiles.find((t) => t._tileValue === value);
      if (!tileEl) continue;
      const col = i % gridSize;
      const row = Math.floor(i / gridSize);
      tileEl.style.left = `${col * tileSize}px`;
      tileEl.style.top = `${row * tileSize}px`;
    }
  }

  function handleTileTap(tileEl: TileDiv): void {
    if (done) return;

    const tileIndex = board.indexOf(tileEl._tileValue);
    const movable = movableIndices(board, gridSize);
    if (!movable.includes(tileIndex)) return;

    if (!timerStarted) startTimer();

    board = applyMove(board, tileIndex);
    syncTilePositions();

    playSound(config.sounds?.tileMove, muted);

    if (isSolved(board)) {
      stopTimer();
      const round = rounds[currentRound];
      roundScore = round ? scoreForElapsed(round.scoreThresholds, elapsedSeconds) : 0;
      totalScore += roundScore;
      setTimeout(() => showRoundWin(), TILE_TRANSITION_MS + 50);
    }
  }

  // --- round win overlay ---
  function showRoundWin(): void {
    if (done) return;
    playSound(config.sounds?.roundWin, muted);

    // Assemble: remove tile gaps (make borders transparent)
    for (const t of tiles) {
      t.classList.add(`${PREFIX}assembled`);
    }

    const overlay = el('div', `${PREFIX}overlay`);
    const h2 = el('h2');
    h2.textContent = `Раунд ${currentRound + 1} пройден!`;
    const p = el('p');
    p.textContent = roundScore > 0 ? `+${roundScore} баллов` : 'Раунд завершён';
    const btn = el('button', `${PREFIX}btn`);
    btn.textContent = 'Продолжить';
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      overlay.remove();
      advanceRound();
    });

    overlay.appendChild(h2);
    overlay.appendChild(p);
    overlay.appendChild(btn);
    boardEl.appendChild(overlay);
  }

  function advanceRound(): void {
    currentRound++;
    if (currentRound >= rounds.length) {
      // All rounds done
      playSound(config.sounds?.gameWin, muted);
      fireComplete({ score: totalScore, won: true });
      return;
    }
    startRound(currentRound);
  }

  // --- start round ---
  function startRound(idx: number): void {
    timerStarted = false;
    elapsedSeconds = 0;
    updateHudTimer();
    updateHudRound();

    const roundCfg = rounds[idx];
    if (!roundCfg) return;

    board = shuffle(gridSize, roundCfg.shuffleMoves, Math.random);
    renderBoard(roundCfg);
  }

  // --- kick off ---
  updateHudRound();
  updateHudTimer();
  startRound(0);

  // --- destroy ---
  function destroy(): void {
    stopTimer();
    container.innerHTML = '';
  }

  return { destroy };
}
