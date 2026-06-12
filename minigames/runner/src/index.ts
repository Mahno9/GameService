import {
  type SpeedPoint,
  type ObstacleType,
  type GameState,
  type GameEvent,
  initGameState,
  jump,
  setCrouch,
  stepPhysics,
  GROUND_Y,
  CHAR_X,
  CHAR_WIDTH,
  CHAR_HEIGHT,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / Callback types
// ---------------------------------------------------------------------------

interface BackgroundLayer {
  image: string;
  scrollSpeed: number;
}

interface SoundsConfig {
  jump?: string;
  land?: string;
  hit?: string;
  gameOver?: string;
}

interface GameConfig {
  lives: number;
  speedCurve: SpeedPoint[];
  characterAsset?: string;
  backgroundLayers?: BackgroundLayer[];
  obstacleTypes: ObstacleType[];
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

const PREFIX = 'rn-';
const FADE_MS = 300;
const INVULN_BLINK_HZ = 8; // blinks per second during invulnerability
const OVERCOME_SPRITE_MS = 600; // how long to show overcomeImage

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function playSound(url: string | undefined, muted: boolean): void {
  if (muted || !url) return;
  const audio = new Audio(url);
  audio.play().catch(() => {});
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img); // resolve even on error; draw fallback
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Styles (scoped with PREFIX)
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #87ceeb;
  font-family: system-ui, sans-serif;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  touch-action: none;
}
.${PREFIX}root.${PREFIX}visible {
  opacity: 1;
}
.${PREFIX}canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}
.${PREFIX}canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.${PREFIX}hud {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  pointer-events: none;
  z-index: 5;
}
.${PREFIX}hud-info {
  background: rgba(0,0,0,0.45);
  color: #fff;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 15px;
  font-weight: 600;
  pointer-events: none;
}
.${PREFIX}hud-controls {
  display: flex;
  gap: 6px;
  pointer-events: all;
}
.${PREFIX}btn {
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.3);
  color: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1.4;
}
.${PREFIX}btn:hover {
  background: rgba(0,0,0,0.65);
}
.${PREFIX}overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.7);
  color: #fff;
  z-index: 10;
  text-align: center;
  padding: 24px;
}
.${PREFIX}overlay h2 {
  font-size: 26px;
  margin: 0 0 12px;
  color: #ffd700;
}
.${PREFIX}overlay p {
  font-size: 18px;
  margin: 0;
  color: #e0e0e0;
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
  // --- inject scoped styles ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  // --- root element ---
  const root = document.createElement('div');
  root.className = `${PREFIX}root`;
  container.appendChild(root);

  // Fade in (double rAF for transition to take effect)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add(`${PREFIX}visible`);
    });
  });

  // --- state ---
  let muted = config.muted === true;
  let done = false;
  let rafId = 0;
  let lastTime: number | null = null;
  let musicAudio: HTMLAudioElement | null = null;

  // --- once-latch ---
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

  function fadeOut(cb: () => void): void {
    root.classList.remove(`${PREFIX}visible`);
    setTimeout(cb, FADE_MS);
  }

  // --- canvas ---
  const canvasWrap = document.createElement('div');
  canvasWrap.className = `${PREFIX}canvas-wrap`;
  root.appendChild(canvasWrap);

  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  canvas.className = `${PREFIX}canvas`;
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // --- HUD overlay ---
  const hud = document.createElement('div');
  hud.className = `${PREFIX}hud`;
  canvasWrap.appendChild(hud);

  const hudInfo = document.createElement('div');
  hudInfo.className = `${PREFIX}hud-info`;
  hudInfo.textContent = 'Дистанция: 0 | ♥♥♥';
  hud.appendChild(hudInfo);

  const hudControls = document.createElement('div');
  hudControls.className = `${PREFIX}hud-controls`;
  hud.appendChild(hudControls);

  const muteBtn = document.createElement('button');
  muteBtn.className = `${PREFIX}btn`;
  muteBtn.title = 'Mute / Unmute';
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (musicAudio) {
      musicAudio.muted = muted;
    }
  });
  hudControls.appendChild(muteBtn);

  const exitBtn = document.createElement('button');
  exitBtn.className = `${PREFIX}btn`;
  exitBtn.title = 'Выйти';
  exitBtn.textContent = '✕';
  exitBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    fireExit();
  });
  hudControls.appendChild(exitBtn);

  // --- asset loading ---
  let charImg: HTMLImageElement | null = null;
  const obsImages: Map<number, HTMLImageElement> = new Map();
  const overcomeImages: Map<number, HTMLImageElement> = new Map();
  const bgImages: HTMLImageElement[] = [];

  // --- parallax scroll offset ---
  let bgOffsets: number[] = [];

  // --- overcome sprite tracking ---
  const overcomeSprites: Map<number, { img: HTMLImageElement; until: number; x: number }> = new Map();

  // --- game state ---
  let state: GameState;

  // Canvas sizing helper
  function resizeCanvas(): void {
    const rect = canvasWrap.getBoundingClientRect();
    canvas.width = rect.width || 480;
    canvas.height = rect.height || 320;
  }

  // Scale factor so game units map to canvas pixels
  function gameScale(): number {
    return canvas.height / (GROUND_Y + 60);
  }

  function updateHud(): void {
    const dist = Math.floor(state.distance);
    const hearts = '♥'.repeat(Math.max(0, state.lives));
    hudInfo.textContent = `${dist} м | ${hearts || '💀'}`;
  }

  // --- render ---
  function render(timestamp: number): void {
    const w = canvas.width;
    const h = canvas.height;
    const scale = gameScale();

    ctx.clearRect(0, 0, w, h);

    // Background layers (parallax)
    if (config.backgroundLayers && config.backgroundLayers.length > 0) {
      for (let i = 0; i < config.backgroundLayers.length; i++) {
        const layer = config.backgroundLayers[i];
        if (!layer) continue;
        const img = bgImages[i];
        if (!img || !img.complete || img.naturalWidth === 0) {
          // fallback: draw a solid color band
          ctx.fillStyle = i === 0 ? '#87ceeb' : '#a8d8a0';
          ctx.fillRect(0, 0, w, h);
          continue;
        }
        const offset = (bgOffsets[i] ?? 0) % img.naturalWidth;
        const tileW = (img.naturalWidth / img.naturalHeight) * h;
        // Draw tiled horizontally
        let x = -offset;
        while (x < w) {
          ctx.drawImage(img, x, 0, tileW, h);
          x += tileW;
        }
      }
    } else {
      // Default sky
      ctx.fillStyle = '#87ceeb';
      ctx.fillRect(0, 0, w, h);
    }

    // Ground line
    const groundPx = GROUND_Y * scale;
    ctx.fillStyle = '#5a8a3a';
    ctx.fillRect(0, groundPx, w, h - groundPx);
    ctx.fillStyle = '#7ab64e';
    ctx.fillRect(0, groundPx, w, 4);

    const now = timestamp;

    // Obstacles
    for (const obs of state.obstacles) {
      const ox = obs.x * scale;
      const ow = obs.width * scale;
      const oh = obs.height * scale;
      const oy = groundPx - oh;

      // Check override sprite
      const sprite = overcomeSprites.get(obs.id);
      if (sprite && sprite.until > now && sprite.img.complete && sprite.img.naturalWidth > 0) {
        ctx.drawImage(sprite.img, ox, oy, ow, oh);
      } else {
        const img = obsImages.get(obs.typeIndex);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, ox, oy, ow, oh);
        } else {
          // Fallback colored rect
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(ox, oy, ow, oh);
          ctx.strokeStyle = '#7b241c';
          ctx.lineWidth = 2;
          ctx.strokeRect(ox, oy, ow, oh);
        }
      }
    }

    // Character
    const charW = CHAR_WIDTH * scale;
    const charH = state.crouching ? (CHAR_HEIGHT / 2) * scale : CHAR_HEIGHT * scale;
    const charX = (CHAR_X - CHAR_WIDTH / 2) * scale;
    const charY = state.charY * scale - charH;

    // Blink during invulnerability
    const blink =
      state.invulnerable > 0 &&
      Math.floor(timestamp * INVULN_BLINK_HZ / 1000) % 2 === 0;

    if (!blink) {
      if (charImg && charImg.complete && charImg.naturalWidth > 0) {
        ctx.drawImage(charImg, charX, charY, charW, charH);
      } else {
        // Fallback: draw a simple character rect
        ctx.fillStyle = '#2980b9';
        ctx.fillRect(charX, charY, charW, charH);
        ctx.fillStyle = '#f39c12';
        ctx.beginPath();
        ctx.arc(charX + charW / 2, charY + charW / 2, charW / 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- input ---
  let pointerDownTime = 0;
  let crouchTimer: ReturnType<typeof setTimeout> | null = null;
  const CROUCH_HOLD_MS = 250;

  function onPointerDown(e: PointerEvent): void {
    if (done) return;
    // Ignore clicks on HUD buttons
    if ((e.target as HTMLElement).closest(`.${PREFIX}btn`)) return;
    e.preventDefault();
    pointerDownTime = Date.now();
    jump(state);
    playSound(config.sounds?.jump, muted);

    // Schedule crouch if held
    crouchTimer = setTimeout(() => {
      if (!done) {
        setCrouch(state, true);
        // Immediately land if crouching in air — just set crouch flag
      }
    }, CROUCH_HOLD_MS);
  }

  function onPointerUp(e: PointerEvent): void {
    if (done) return;
    if ((e.target as HTMLElement).closest(`.${PREFIX}btn`)) return;
    e.preventDefault();
    if (crouchTimer !== null) {
      clearTimeout(crouchTimer);
      crouchTimer = null;
    }
    const held = Date.now() - pointerDownTime;
    if (held < CROUCH_HOLD_MS) {
      setCrouch(state, false);
    } else {
      setCrouch(state, false);
    }
  }

  canvasWrap.addEventListener('pointerdown', onPointerDown);
  canvasWrap.addEventListener('pointerup', onPointerUp);
  canvasWrap.addEventListener('pointercancel', onPointerUp);

  // --- game over overlay ---
  function showGameOver(): void {
    const overlay = document.createElement('div');
    overlay.className = `${PREFIX}overlay`;

    const h2 = document.createElement('h2');
    h2.textContent = 'Игра окончена';

    const p = document.createElement('p');
    p.textContent = `Дистанция: ${Math.floor(state.distance)} м`;

    overlay.appendChild(h2);
    overlay.appendChild(p);
    canvasWrap.appendChild(overlay);

    // After a moment, call onComplete
    setTimeout(() => {
      fireComplete({ score: Math.floor(state.distance), won: true });
    }, 2000);
  }

  // --- rAF loop ---
  let wasGrounded = true;

  function loop(timestamp: number): void {
    if (done) return;

    if (lastTime === null) lastTime = timestamp;
    const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = timestamp;

    resizeCanvas();

    // Update parallax offsets
    if (config.backgroundLayers) {
      for (let i = 0; i < config.backgroundLayers.length; i++) {
        const layer = config.backgroundLayers[i];
        if (!layer) continue;
        bgOffsets[i] = (bgOffsets[i] ?? 0) + state.speed * layer.scrollSpeed * rawDt * gameScale();
        const img = bgImages[i];
        if (img && img.naturalWidth > 0) {
          const tileW = (img.naturalWidth / img.naturalHeight) * canvas.height;
          bgOffsets[i] = (bgOffsets[i] ?? 0) % tileW;
        }
      }
    }

    // Step physics
    const events: GameEvent[] = stepPhysics(
      state,
      rawDt,
      config.speedCurve,
      config.obstacleTypes,
      canvas.width / gameScale(),
    );

    // Handle events
    for (const evt of events) {
      if (evt.type === 'hit') {
        playSound(config.sounds?.hit, muted);
        if (state.gameOver) {
          playSound(config.sounds?.gameOver, muted);
        }
      } else if (evt.type === 'overcome') {
        if (evt.overcomeSound) {
          playSound(evt.overcomeSound, muted);
        }
        if (evt.overcomeImage) {
          const img = overcomeImages.get(evt.obstacleTypeIndex);
          if (img) {
            overcomeSprites.set(evt.obstacleId, {
              img,
              until: timestamp + OVERCOME_SPRITE_MS,
              x: CHAR_X,
            });
          }
        }
      }
    }

    // Landing sound
    if (!wasGrounded && state.grounded) {
      playSound(config.sounds?.land, muted);
    }
    wasGrounded = state.grounded;

    // Render
    render(timestamp);
    updateHud();

    if (state.gameOver) {
      stopLoop();
      showGameOver();
      return;
    }

    rafId = requestAnimationFrame(loop);
  }

  function stopLoop(): void {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // --- music ---
  function startMusic(): void {
    if (!config.music || muted) return;
    musicAudio = new Audio(config.music);
    musicAudio.loop = true;
    musicAudio.muted = muted;
    musicAudio.play().catch(() => {});
  }

  function stopMusic(): void {
    if (musicAudio) {
      musicAudio.pause();
      musicAudio = null;
    }
  }

  // --- asset loading & start ---
  async function loadAssets(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (config.characterAsset) {
      promises.push(
        loadImage(config.characterAsset).then((img) => {
          charImg = img;
        }),
      );
    }

    if (config.backgroundLayers) {
      for (let i = 0; i < config.backgroundLayers.length; i++) {
        const layer = config.backgroundLayers[i];
        if (!layer) continue;
        const idx = i;
        bgOffsets[idx] = 0;
        promises.push(
          loadImage(layer.image).then((img) => {
            bgImages[idx] = img;
          }),
        );
      }
    }

    for (let i = 0; i < config.obstacleTypes.length; i++) {
      const obs = config.obstacleTypes[i];
      if (!obs) continue;
      const idx = i;
      if (obs.image) {
        promises.push(
          loadImage(obs.image).then((img) => {
            obsImages.set(idx, img);
          }),
        );
      }
      if (obs.overcomeImage) {
        promises.push(
          loadImage(obs.overcomeImage).then((img) => {
            overcomeImages.set(idx, img);
          }),
        );
      }
    }

    await Promise.all(promises);
  }

  // Kick off
  resizeCanvas();
  state = initGameState(config.lives, canvas.width / gameScale());

  loadAssets().then(() => {
    if (done) return;
    startMusic();
    rafId = requestAnimationFrame(loop);
  });

  // --- destroy ---
  function destroy(): void {
    done = true;
    stopLoop();
    stopMusic();
    if (crouchTimer !== null) {
      clearTimeout(crouchTimer);
      crouchTimer = null;
    }
    canvasWrap.removeEventListener('pointerdown', onPointerDown);
    canvasWrap.removeEventListener('pointerup', onPointerUp);
    canvasWrap.removeEventListener('pointercancel', onPointerUp);
    container.innerHTML = '';
  }

  return { destroy };
}
