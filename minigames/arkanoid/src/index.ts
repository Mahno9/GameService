import {
  type GameState,
  type LevelConfig,
  type ValuedBlockType,
  type GameEvent,
  type BonusKind,
  FIELD,
  BONUS,
  createState,
  step,
  fire,
  clampPaddle,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / Callback types
// ---------------------------------------------------------------------------

interface LevelConfigRaw {
  backgroundImage?: string;
  totalBlocks?: number;
  valuedBlockTypes?: Partial<ValuedBlockType>[];
  ballSpeed?: number;
  ballAcceleration?: number;
}

interface SoundsConfig {
  bounce?: string;
  blockBreak?: string;
  bonus?: string;
  ballLost?: string;
  win?: string;
  lose?: string;
}

interface GameConfig {
  lives?: number;
  levels?: LevelConfigRaw[];
  sounds?: SoundsConfig;
  music?: string;
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
// Constants
// ---------------------------------------------------------------------------

const PREFIX = 'ak-';
const FADE_MS = 300;

const BONUS_LABEL: Record<BonusKind, string> = {
  expand: 'W',
  shrink: 'S',
  ballFast: 'F',
  ballSlow: 'L',
  extraBall: '+',
  laser: '✷',
  shield: 'U',
  explosion: 'X',
  slowTime: 'T',
};

const BONUS_COLOR: Record<BonusKind, string> = {
  expand: '#4caf50',
  shrink: '#e91e63',
  ballFast: '#ff9800',
  ballSlow: '#03a9f4',
  extraBall: '#9c27b0',
  laser: '#f44336',
  shield: '#00bcd4',
  explosion: '#ff5722',
  slowTime: '#673ab7',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function num(v: number | undefined, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function normalizeLevel(raw: LevelConfigRaw): LevelConfig {
  const valued: ValuedBlockType[] = (raw.valuedBlockTypes ?? []).map((v) => ({
    color: typeof v.color === 'string' ? v.color : '#ffeb3b',
    percent: num(v.percent, 0),
    points: Math.floor(num(v.points, 0)),
    lifetimeSeconds: Math.floor(num(v.lifetimeSeconds, 0)),
  }));
  const level: LevelConfig = {
    totalBlocks: Math.max(1, Math.floor(num(raw.totalBlocks, 40))),
    valuedBlockTypes: valued,
    ballSpeed: num(raw.ballSpeed, 6),
    ballAcceleration: num(raw.ballAcceleration, 0.002),
  };
  if (typeof raw.backgroundImage === 'string') {
    level.backgroundImage = raw.backgroundImage;
  }
  return level;
}

// ---------------------------------------------------------------------------
// Styles (scoped to the container via the ak- prefix)
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b0b1a;
  color: #e0e0f0;
  font-family: system-ui, sans-serif;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  touch-action: none;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }
.${PREFIX}hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #14142b;
  font-size: 14px;
  gap: 8px;
  flex-shrink: 0;
}
.${PREFIX}hud-left { display: flex; gap: 14px; align-items: center; }
.${PREFIX}hud-lives { color: #ff6b8a; font-weight: 600; }
.${PREFIX}hud-score { font-variant-numeric: tabular-nums; color: #ffd166; }
.${PREFIX}hud-level { color: #a0c4ff; }
.${PREFIX}hud-controls { display: flex; gap: 6px; }
.${PREFIX}btn {
  background: #1c2c54;
  border: 1px solid #3a3a6a;
  color: #e0e0f0;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1.2;
}
.${PREFIX}btn:hover { background: #26407a; }
.${PREFIX}legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 4px 10px;
  background: #10102100;
  font-size: 12px;
  flex-shrink: 0;
}
.${PREFIX}legend-item { display: flex; align-items: center; gap: 4px; }
.${PREFIX}swatch {
  width: 12px; height: 12px; border-radius: 3px;
  display: inline-block; flex-shrink: 0;
}
.${PREFIX}canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}
.${PREFIX}canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.${PREFIX}overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(8, 8, 24, 0.88);
  z-index: 10;
  text-align: center;
  padding: 24px;
}
.${PREFIX}overlay h2 { font-size: 24px; margin: 0 0 12px; color: #a0c4ff; }
.${PREFIX}overlay p { font-size: 16px; margin: 0 0 20px; color: #d0d0e8; }
.${PREFIX}overlay .${PREFIX}btn { font-size: 15px; padding: 8px 24px; }
`;

// ---------------------------------------------------------------------------
// Main init export
// ---------------------------------------------------------------------------

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): { destroy: () => void } {
  // --- styles ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = el('div', `${PREFIX}root`);
  container.appendChild(root);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`));
  });

  // --- config normalization ---
  const lives = Math.max(1, Math.floor(num(config.lives, 3)));
  const rawLevels = config.levels ?? [];
  const levels: LevelConfig[] = rawLevels.length > 0 ? rawLevels.map(normalizeLevel) : [normalizeLevel({})];
  const sounds = config.sounds ?? {};

  // --- once-latch / lifecycle ---
  let done = false;
  let rafId: number | null = null;

  function fadeOut(cb: () => void): void {
    root.classList.remove(`${PREFIX}visible`);
    window.setTimeout(cb, FADE_MS);
  }

  function fireComplete(result: GameResult): void {
    if (done) return;
    done = true;
    stopLoop();
    stopMusic();
    fadeOut(() => callbacks.onComplete(result));
  }

  function fireExit(): void {
    if (done) return;
    done = true;
    stopLoop();
    stopMusic();
    fadeOut(() => callbacks.onExit());
  }

  // --- audio ---
  let muted = config.muted === true;
  let music: HTMLAudioElement | null = null;

  const audioCtx = new AudioContext();
  const audioBuffers = new Map<string, AudioBuffer>();
  for (const url of Object.values(sounds)) {
    if (url) void fetch(url).then(r => r.arrayBuffer()).then(ab => audioCtx.decodeAudioData(ab)).then(buf => audioBuffers.set(url, buf)).catch(() => {});
  }

  function playSound(url: string | undefined): void {
    if (muted || !url) return;
    const buf = audioBuffers.get(url);
    if (!buf) { new Audio(url).play().catch(() => {}); return; }
    const fire = () => {
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
    };
    audioCtx.state !== 'running' ? void audioCtx.resume().then(fire) : fire();
  }

  function startMusic(): void {
    if (!config.music) return;
    music = new Audio(config.music);
    music.loop = true;
    music.volume = 0.4;
    if (!muted) music.play().catch(() => {});
  }

  function stopMusic(): void {
    if (music) {
      music.pause();
      music.src = '';
      music = null;
    }
  }

  function applyMute(): void {
    if (music) {
      if (muted) music.pause();
      else music.play().catch(() => {});
    }
  }

  // --- HUD ---
  const hud = el('div', `${PREFIX}hud`);
  const hudLeft = el('div', `${PREFIX}hud-left`);
  const hudLives = el('div', `${PREFIX}hud-lives`);
  const hudScore = el('div', `${PREFIX}hud-score`);
  const hudLevel = el('div', `${PREFIX}hud-level`);
  hudLeft.appendChild(hudLives);
  hudLeft.appendChild(hudScore);
  hudLeft.appendChild(hudLevel);

  const hudControls = el('div', `${PREFIX}hud-controls`);
  const muteBtn = el('button', `${PREFIX}btn`);
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.title = 'Звук';
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    applyMute();
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

  hud.appendChild(hudLeft);
  hud.appendChild(hudControls);
  root.appendChild(hud);

  // --- legend ---
  const legend = el('div', `${PREFIX}legend`);
  root.appendChild(legend);

  function renderLegend(level: LevelConfig): void {
    legend.innerHTML = '';
    for (const vt of level.valuedBlockTypes) {
      if (vt.points <= 0) continue;
      const item = el('div', `${PREFIX}legend-item`);
      const sw = el('span', `${PREFIX}swatch`);
      sw.style.background = vt.color;
      const label = el('span');
      label.textContent = `${vt.points}`;
      item.appendChild(sw);
      item.appendChild(label);
      legend.appendChild(item);
    }
  }

  // --- canvas ---
  const canvasWrap = el('div', `${PREFIX}canvas-wrap`);
  const canvas = el('canvas', `${PREFIX}canvas`);
  canvasWrap.appendChild(canvas);
  root.appendChild(canvasWrap);
  const ctx = canvas.getContext('2d');

  // Pixel dimensions of the field (computed on resize).
  let fieldX = 0;
  let fieldY = 0;
  let fieldW = 0;
  let fieldH = 0;
  let dpr = 1;

  function resize(): void {
    const rect = canvasWrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    // The field is normalized 0..1 x 0..1; fit it into the canvas as a
    // portrait-friendly rectangle (use full area, the field is already tall).
    fieldX = 0;
    fieldY = 0;
    fieldW = canvas.width;
    fieldH = canvas.height;
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvasWrap);
  resize();

  function fx(nx: number): number {
    return fieldX + nx * fieldW;
  }
  function fy(ny: number): number {
    return fieldY + ny * fieldH;
  }

  // --- background images (lazy, per level) ---
  const bgCache = new Map<string, HTMLImageElement>();
  function getBg(url: string): HTMLImageElement {
    let img = bgCache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      bgCache.set(url, img);
    }
    return img;
  }

  // --- game state ---
  const rng = Math.random;
  let levelIndex = 0;
  let state: GameState = createState(levels[0] as LevelConfig, 0, lives, 0, rng);
  let paused = false; // paused during overlays / transitions

  function loadLevel(idx: number): void {
    const level = levels[idx] as LevelConfig;
    state = createState(level, idx, state.lives, state.score, rng);
    levelIndex = idx;
    renderLegend(level);
    updateHud();
  }

  renderLegend(levels[0] as LevelConfig);

  function updateHud(): void {
    hudLives.textContent = '♥'.repeat(Math.max(0, state.lives));
    hudScore.textContent = `${state.score}`;
    hudLevel.textContent = `Ур. ${levelIndex + 1}/${levels.length}`;
  }
  updateHud();

  // --- controls: pointer drag (delta) + device orientation tilt ---
  let dragging = false;
  let lastPointerX = 0;
  let tiltVel = 0; // paddle velocity contributed by device tilt

  function onPointerDown(e: PointerEvent): void {
    if (done || paused) return;
    dragging = true;
    lastPointerX = e.clientX;
    // Tap fires laser when active.
    fire(state);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging || done || paused) return;
    const dxPx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    const rect = canvas.getBoundingClientRect();
    const dxNorm = rect.width > 0 ? dxPx / rect.width : 0;
    state.paddleX = clampPaddle(state.paddleX + dxNorm, state.paddleHalfW);
  }
  function onPointerUp(): void {
    dragging = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  function onOrientation(e: DeviceOrientationEvent): void {
    if (e.gamma == null) return;
    // gamma: left-right tilt in degrees (-90..90). Map to a velocity.
    const g = Math.max(-45, Math.min(45, e.gamma));
    tiltVel = (g / 45) * 0.018;
  }
  window.addEventListener('deviceorientation', onOrientation);

  // --- overlays ---
  let overlay: HTMLDivElement | null = null;

  function showOverlay(title: string, sub: string, btnLabel: string, onBtn: () => void): void {
    clearOverlay();
    paused = true;
    const ov = el('div', `${PREFIX}overlay`);
    const h2 = el('h2');
    h2.textContent = title;
    const p = el('p');
    p.textContent = sub;
    const btn = el('button', `${PREFIX}btn`);
    btn.textContent = btnLabel;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      clearOverlay();
      onBtn();
    });
    ov.appendChild(h2);
    ov.appendChild(p);
    ov.appendChild(btn);
    canvasWrap.appendChild(ov);
    overlay = ov;
  }

  function clearOverlay(): void {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    paused = false;
  }

  // --- event handling from the engine ---
  function handleEvents(events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'bounceWall':
        case 'bouncePaddle':
        case 'shieldBounce':
          playSound(sounds.bounce);
          break;
        case 'blockBreak':
          playSound(sounds.bounce);
          playSound(sounds.blockBreak);
          break;
        case 'bonusCollect':
          playSound(sounds.bonus);
          break;
        case 'ballLost':
          playSound(sounds.ballLost);
          break;
        case 'gameOver':
          updateHud();
          playSound(sounds.lose);
          showOverlay('Игра окончена', `Счёт: ${state.score}`, 'Завершить', () =>
            fireComplete({ score: state.score, won: false }),
          );
          return;
        case 'levelClear':
          updateHud();
          if (levelIndex + 1 >= levels.length) {
            playSound(sounds.win);
            showOverlay('Победа!', `Счёт: ${state.score}`, 'Завершить', () =>
              fireComplete({ score: state.score, won: true }),
            );
          } else {
            showOverlay(
              `Уровень ${levelIndex + 1} пройден`,
              `Счёт: ${state.score}`,
              'Дальше',
              () => loadLevel(levelIndex + 1),
            );
          }
          return;
        default:
          break;
      }
    }
    updateHud();
  }

  // --- render ---
  function draw(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background image (dimmed) behind the block band.
    const bgUrl = state.level.backgroundImage;
    if (bgUrl) {
      const img = getBg(bgUrl);
      if (img.complete && img.naturalWidth > 0) {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
    }

    // Blocks.
    for (const b of state.blocks) {
      const x = fx(b.cx - b.halfW);
      const y = fy(b.cy - b.halfH);
      const w = b.halfW * 2 * fieldW;
      const h = b.halfH * 2 * fieldH;
      ctx.fillStyle = b.color;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }

    // Paddle — visual differs with active effects.
    const px = fx(state.paddleX);
    const py = fy(FIELD.paddleY);
    const phw = state.paddleHalfW * fieldW;
    const phh = (FIELD.paddleHeight * fieldH) / 2;
    let paddleColor = '#cfe3ff';
    if (state.effects.laser > 0) paddleColor = '#ff6b6b';
    else if (state.effects.expand > 0) paddleColor = '#7bed9f';
    else if (state.effects.shrink > 0) paddleColor = '#ff9ff3';
    ctx.fillStyle = paddleColor;
    roundRect(ctx, px - phw, py - phh, phw * 2, phh * 2, Math.min(8, phh));
    ctx.fill();
    if (state.effects.shield > 0) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, fy(0.985));
      ctx.lineTo(canvas.width, fy(0.985));
      ctx.stroke();
    }

    // Balls.
    ctx.fillStyle = '#ffffff';
    for (const ball of state.balls) {
      ctx.beginPath();
      ctx.arc(fx(ball.x), fy(ball.y), FIELD.ballRadius * fieldW, 0, Math.PI * 2);
      ctx.fill();
    }

    // Projectiles.
    ctx.fillStyle = '#ff5252';
    for (const p of state.projectiles) {
      ctx.fillRect(fx(p.x) - 1.5, fy(p.y) - 8, 3, 12);
    }

    // Bonus capsules.
    for (const c of state.capsules) {
      const cw = BONUS.capsuleHalfW * fieldW;
      const ch = BONUS.capsuleHalfH * fieldH;
      ctx.fillStyle = BONUS_COLOR[c.kind];
      roundRect(ctx, fx(c.x) - cw, fy(c.y) - ch, cw * 2, ch * 2, Math.min(6, ch));
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.floor(ch * 1.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(BONUS_LABEL[c.kind], fx(c.x), fy(c.y));
    }
  }

  function roundRect(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // --- main loop ---
  let lastTime = performance.now();

  function loop(now: number): void {
    rafId = window.requestAnimationFrame(loop);
    let dtMs = now - lastTime;
    lastTime = now;
    // Clamp to avoid huge jumps after tab switch; convert to 60fps-frame units.
    if (dtMs > 100) dtMs = 100;
    const dt = dtMs / (1000 / 60);

    if (!done && !paused) {
      // Apply tilt velocity (active alongside drag).
      if (tiltVel !== 0) {
        state.paddleX = clampPaddle(state.paddleX + tiltVel * dt, state.paddleHalfW);
      }
      const events = step(state, dt, rng);
      if (events.length > 0) handleEvents(events);
    }
    draw();
  }

  startMusic();
  rafId = window.requestAnimationFrame(loop);

  function stopLoop(): void {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // --- destroy ---
  function destroy(): void {
    stopLoop();
    stopMusic();
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('deviceorientation', onOrientation);
    bgCache.clear();
    void audioCtx.close();
    container.innerHTML = '';
  }

  return { destroy };
}
