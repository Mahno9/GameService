import {
  scoreForElapsed,
  hitTest,
  type ScoreThreshold,
  type PlacedItem,
  type Point,
} from './engine.js';

// ---------------------------------------------------------------------------
// Config / Callback types
// ---------------------------------------------------------------------------

interface ItemConfig {
  image: string;
  x: number;
  y: number;
  rotation?: number;
  colorFilter?: string;
  zIndex?: number;
  scale?: number;
}

type W = { url: string; weight: number };

interface SoundsConfig {
  found?: string | W[];
  win?: string | W[];
  music?: string | W[];
}

interface GameConfig {
  backgroundImage: string;
  overlays?: ItemConfig[];
  targets: ItemConfig[];
  scoreThresholds?: ScoreThreshold[];
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

const PREFIX = 'fo-';
const FADE_MS = 300;
const ACTIVE_COUNT = 3;
const TAP_MAX_MOVE = 8; // px (screen)
const TAP_MAX_MS = 300;
const MAX_ZOOM = 4;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

// ---------------------------------------------------------------------------
// Styles (scoped under .fo-root)
// ---------------------------------------------------------------------------

const STYLES = `
.${PREFIX}root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0d0d18;
  color: #e0e0f0;
  font-family: system-ui, sans-serif;
  overflow: hidden;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.${PREFIX}root.${PREFIX}visible { opacity: 1; }

.${PREFIX}hud {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: linear-gradient(rgba(13,13,24,0.92), rgba(13,13,24,0));
  gap: 8px;
  z-index: 20;
  pointer-events: none;
}
.${PREFIX}hud > * { pointer-events: auto; }
.${PREFIX}targets {
  display: flex;
  gap: 8px;
}
.${PREFIX}thumb {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  border: 2px solid #4a4a7a;
  background: #16213e center/contain no-repeat;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.${PREFIX}thumb.${PREFIX}thumb-enter {
  transform: translateY(-8px) scale(0.6);
  opacity: 0;
}
.${PREFIX}hud-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.${PREFIX}timer {
  font-variant-numeric: tabular-nums;
  color: #c0c0d8;
  background: rgba(15,52,96,0.7);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 14px;
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
}
.${PREFIX}btn:hover { background: #1a4a80; }

.${PREFIX}viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
}
.${PREFIX}scene {
  position: absolute;
  top: 0; left: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.${PREFIX}bg {
  position: absolute;
  top: 0; left: 0;
  display: block;
  pointer-events: none;
}
.${PREFIX}item {
  position: absolute;
  transform-origin: center center;
  cursor: grab;
  will-change: transform, filter;
}
.${PREFIX}item.${PREFIX}lifted {
  cursor: grabbing;
}
.${PREFIX}item.${PREFIX}settling {
  transition: transform 0.18s ease, filter 0.18s ease;
}

.${PREFIX}item.${PREFIX}found {
  animation: ${PREFIX}found-pulse 0.55s ease forwards;
}
@keyframes ${PREFIX}found-pulse {
  0%   { filter: brightness(1) saturate(1) drop-shadow(0 0 0 #fff); }
  35%  { filter: brightness(2.2) saturate(2) drop-shadow(0 0 12px #ffe680); }
  100% { filter: brightness(2.6) saturate(2.4) drop-shadow(0 0 20px #fff7c2); opacity: 0; }
}

.${PREFIX}particle {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff7c2, #ffcc33);
  pointer-events: none;
  will-change: transform, opacity;
}

.${PREFIX}end {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(10,10,30,0.85);
  z-index: 30;
  text-align: center;
  padding: 24px;
}
.${PREFIX}end h2 { font-size: 24px; margin: 0 0 12px; color: #ffe680; }
.${PREFIX}end p { font-size: 16px; margin: 0; color: #d0d0e8; }
`;

// ---------------------------------------------------------------------------
// Main init export
// ---------------------------------------------------------------------------

export function init(
  container: HTMLElement,
  config: GameConfig,
  callbacks: Callbacks,
): { destroy: () => void } {
  // --- scoped styles ---
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  container.appendChild(styleEl);

  const root = el('div', `${PREFIX}root`);
  container.appendChild(root);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add(`${PREFIX}visible`));
  });

  // --- state ---
  let muted = config.muted === true;
  let done = false;
  let timerStarted = false;
  let elapsedSeconds = 0;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let rafId: number | null = null;

  const overlaysCfg = config.overlays ?? [];
  const targetsCfg = config.targets;
  const thresholds = config.scoreThresholds ?? [];

  // Per-item live state. id is stable.
  interface ItemState {
    id: string;
    cfg: ItemConfig;
    isTarget: boolean;
    targetOrder: number; // index within targets list (-1 for overlays)
    found: boolean;
    x: number;
    y: number;
    naturalWidth: number;
    naturalHeight: number;
    scale: number;
    rotation: number;
    zIndex: number;
    elImg: HTMLImageElement;
  }

  const items: ItemState[] = [];

  // --- audio: background music ---
  let music: HTMLAudioElement | null = null;
  function pickSound(val: string | W[] | undefined): string | undefined {
    if (!val) return undefined;
    if (typeof val === 'string') return val;
    if (!val.length) return undefined;
    let r = Math.random() * val.reduce((s, v) => s + v.weight, 0);
    for (const v of val) { r -= v.weight; if (r <= 0) return v.url; }
    return val[val.length - 1]!.url;
  }
  const musicUrl = pickSound(config.sounds?.music);
  if (musicUrl) {
    music = new Audio(musicUrl);
    music.loop = true;
  }
  function startMusic(): void {
    if (music && !muted) music.play().catch(() => {});
  }
  function stopMusic(): void {
    if (music) music.pause();
  }
  const sfxCtx = new AudioContext();
  const sfxBuffers = new Map<string, AudioBuffer>();
  function preloadSfx(val: string | W[] | undefined): void {
    const urls = typeof val === 'string' ? [val] : (Array.isArray(val) ? val.map(v => v.url) : []);
    for (const url of urls) {
      if (url && !sfxBuffers.has(url))
        void fetch(url).then(r => r.arrayBuffer()).then(ab => sfxCtx.decodeAudioData(ab)).then(buf => sfxBuffers.set(url, buf)).catch(() => {});
    }
  }
  for (const v of [config.sounds?.found, config.sounds?.win]) preloadSfx(v);

  function playSfx(url: string | undefined): void {
    if (muted || !url) return;
    const buf = sfxBuffers.get(url);
    if (!buf) { new Audio(url).play().catch(() => {}); return; }
    const fire = () => {
      const src = sfxCtx.createBufferSource();
      src.buffer = buf; src.connect(sfxCtx.destination); src.start(0);
    };
    sfxCtx.state !== 'running' ? void sfxCtx.resume().then(fire) : fire();
  }

  // --- once-latch ---
  function fadeOut(cb: () => void): void {
    root.classList.remove(`${PREFIX}visible`);
    setTimeout(cb, FADE_MS);
  }
  function fireComplete(result: GameResult): void {
    if (done) return;
    done = true;
    teardownLoops();
    stopMusic();
    fadeOut(() => callbacks.onComplete(result));
  }
  function fireExit(): void {
    if (done) return;
    done = true;
    teardownLoops();
    stopMusic();
    fadeOut(() => callbacks.onExit());
  }

  // --- HUD ---
  const hud = el('div', `${PREFIX}hud`);
  const targetsBar = el('div', `${PREFIX}targets`);
  const hudRight = el('div', `${PREFIX}hud-right`);
  const timerEl = el('div', `${PREFIX}timer`);
  timerEl.textContent = '0:00';
  const muteBtn = el('button', `${PREFIX}btn`);
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.title = 'Звук';
  const exitBtn = el('button', `${PREFIX}btn`);
  exitBtn.textContent = '✕';
  exitBtn.title = 'Выйти';

  muteBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (muted) stopMusic();
    else startMusic();
  });
  exitBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    fireExit();
  });

  hudRight.appendChild(timerEl);
  hudRight.appendChild(muteBtn);
  hudRight.appendChild(exitBtn);
  hud.appendChild(targetsBar);
  hud.appendChild(hudRight);
  root.appendChild(hud);

  // --- viewport + scene ---
  const viewport = el('div', `${PREFIX}viewport`);
  const scene = el('div', `${PREFIX}scene`);
  const bg = el('img', `${PREFIX}bg`) as HTMLImageElement;
  scene.appendChild(bg);
  viewport.appendChild(scene);
  root.appendChild(viewport);

  // --- camera transform ---
  let camScale = 1;
  let minScale = 1;
  let camX = 0; // translate of scene (screen px)
  let camY = 0;
  let bgW = 0;
  let bgH = 0;

  function applyCamera(): void {
    scene.style.transform = `translate(${camX}px, ${camY}px) scale(${camScale})`;
  }

  function clampCamera(): void {
    camScale = Math.max(minScale, Math.min(MAX_ZOOM, camScale));
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const contentW = bgW * camScale;
    const contentH = bgH * camScale;
    // If content smaller than viewport, center it; else clamp within bounds.
    if (contentW <= vw) camX = (vw - contentW) / 2;
    else camX = Math.min(0, Math.max(vw - contentW, camX));
    if (contentH <= vh) camY = (vh - contentH) / 2;
    else camY = Math.min(0, Math.max(vh - contentH, camY));
  }

  function fitToViewport(): void {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (bgW === 0 || bgH === 0 || vw === 0 || vh === 0) return;
    minScale = Math.min(vw / bgW, vh / bgH);
    camScale = minScale;
    clampCamera();
    applyCamera();
  }

  // screen -> background pixel coordinates
  function screenToBg(clientX: number, clientY: number): Point {
    const rect = viewport.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - camX) / camScale, y: (sy - camY) / camScale };
  }

  // --- item rendering ---
  function placedSnapshot(): PlacedItem[] {
    return items
      .filter((it) => !it.found)
      .map((it) => ({
        id: it.id,
        x: it.x,
        y: it.y,
        naturalWidth: it.naturalWidth,
        naturalHeight: it.naturalHeight,
        scale: it.scale,
        rotation: it.rotation,
        zIndex: it.zIndex,
      }));
  }

  function activeTargets(): ItemState[] {
    return items
      .filter((it) => it.isTarget && !it.found)
      .sort((a, b) => a.targetOrder - b.targetOrder)
      .slice(0, ACTIVE_COUNT);
  }

  function styleItem(it: ItemState): void {
    const w = it.naturalWidth * it.scale;
    const h = it.naturalHeight * it.scale;
    it.elImg.style.width = `${w}px`;
    it.elImg.style.height = `${h}px`;
    it.elImg.style.left = `${it.x - w / 2}px`;
    it.elImg.style.top = `${it.y - h / 2}px`;
    it.elImg.style.zIndex = String(it.zIndex);
    const filter = it.cfg.colorFilter ?? '';
    setItemTransform(it, 1, false);
    it.elImg.style.filter = filter;
  }

  // baseTransform = rotation; extra = lift scale + shadow
  function setItemTransform(it: ItemState, liftScale: number, lifted: boolean): void {
    it.elImg.style.transform = `rotate(${it.rotation}deg) scale(${liftScale})`;
    if (lifted) {
      const f = it.cfg.colorFilter ?? '';
      it.elImg.style.filter = `${f} drop-shadow(0 8px 10px rgba(0,0,0,0.5))`.trim();
    } else {
      it.elImg.style.filter = it.cfg.colorFilter ?? '';
    }
  }

  // --- thumbnails ---
  // Track which target ids currently have a thumbnail rendered, in order.
  let shownThumbIds: string[] = [];

  function renderThumbs(animateNew: boolean): void {
    const active = activeTargets();
    const activeIds = active.map((it) => it.id);

    // Remove thumbs no longer active.
    for (const child of Array.from(targetsBar.children)) {
      const id = (child as HTMLElement).dataset['id'];
      if (!id || !activeIds.includes(id)) child.remove();
    }

    for (const it of active) {
      let thumb = targetsBar.querySelector<HTMLElement>(`[data-id="${it.id}"]`);
      if (!thumb) {
        thumb = el('div', `${PREFIX}thumb`);
        thumb.dataset['id'] = it.id;
        thumb.style.backgroundImage = `url(${JSON.stringify(it.cfg.image)})`;
        targetsBar.appendChild(thumb);
        if (animateNew && !shownThumbIds.includes(it.id) && shownThumbIds.length > 0) {
          thumb.classList.add(`${PREFIX}thumb-enter`);
          // force reflow then animate in
          void thumb.offsetWidth;
          thumb.classList.remove(`${PREFIX}thumb-enter`);
        }
      }
    }
    shownThumbIds = activeIds;
  }

  // --- timer ---
  function startTimer(): void {
    if (timerStarted) return;
    timerStarted = true;
    startMusic();
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      updateTimer();
    }, 1000);
  }
  function updateTimer(): void {
    const m = Math.floor(elapsedSeconds / 60);
    const s = elapsedSeconds % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  // --- found effect ---
  function spawnParticles(it: ItemState): void {
    const count = 15 + Math.floor(Math.random() * 11); // 15..25
    const w = it.naturalWidth * it.scale;
    const h = it.naturalHeight * it.scale;
    for (let i = 0; i < count; i++) {
      const p = el('div', `${PREFIX}particle`);
      p.style.left = `${it.x}px`;
      p.style.top = `${it.y}px`;
      const sizeJitter = 0.5 + Math.random();
      p.style.transform = `scale(${sizeJitter})`;
      p.style.transition = 'transform 0.7s ease-out, opacity 0.7s ease-out';
      p.style.zIndex = String(it.zIndex + 1);
      scene.appendChild(p);

      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = (Math.max(w, h) / 2) * (0.8 + Math.random() * 1.4) + 20;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          p.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
          p.style.opacity = '0';
        });
      });
      const to = setTimeout(() => {
        p.remove();
        pendingTimeouts.delete(to);
      }, 750);
      pendingTimeouts.add(to);
    }
  }

  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  function markFound(it: ItemState): void {
    it.found = true;
    playSfx(pickSound(config.sounds?.found));
    spawnParticles(it);
    it.elImg.classList.add(`${PREFIX}found`);
    const to = setTimeout(() => {
      it.elImg.remove();
      pendingTimeouts.delete(to);
    }, 600);
    pendingTimeouts.add(to);

    renderThumbs(true);

    // Win check: all targets found.
    const remaining = items.some((i) => i.isTarget && !i.found);
    if (!remaining) {
      const to2 = setTimeout(() => {
        playSfx(pickSound(config.sounds?.win));
        const score = scoreForElapsed(thresholds, elapsedSeconds);
        showEnd(score);
        pendingTimeouts.delete(to2);
      }, 650);
      pendingTimeouts.add(to2);
    }
  }

  function showEnd(score: number): void {
    if (done) return;
    const overlay = el('div', `${PREFIX}end`);
    const h2 = el('h2');
    h2.textContent = 'Все предметы найдены!';
    const p = el('p');
    p.textContent = `Счёт: ${score}`;
    overlay.appendChild(h2);
    overlay.appendChild(p);
    root.appendChild(overlay);
    const to = setTimeout(() => {
      fireComplete({ score, won: true });
      pendingTimeouts.delete(to);
    }, 900);
    pendingTimeouts.add(to);
  }

  // ---------------------------------------------------------------------------
  // Pointer handling: pan / pinch / item drag / tap
  // ---------------------------------------------------------------------------

  interface PointerInfo {
    id: number;
    startClientX: number;
    startClientY: number;
    clientX: number;
    clientY: number;
    lastClientX?: number;
    lastClientY?: number;
    startTime: number;
    target: ItemState | null; // item under the initial press, if any
  }

  const pointers = new Map<number, PointerInfo>();

  // Active single-item drag
  let dragItem: ItemState | null = null;
  let dragMoved = false;

  // Pan state (single pointer on empty space)
  let panning = false;
  let panStartCamX = 0;
  let panStartCamY = 0;

  // Pinch state
  let pinching = false;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchMidBg: Point = { x: 0, y: 0 };

  function itemUnderPoint(bgPt: Point): ItemState | null {
    const id = hitTest(bgPt, placedSnapshot());
    if (!id) return null;
    return items.find((it) => it.id === id) ?? null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (done) return;
    viewport.setPointerCapture(e.pointerId);
    const bgPt = screenToBg(e.clientX, e.clientY);
    const hit = itemUnderPoint(bgPt);
    const info: PointerInfo = {
      id: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      startTime: performance.now(),
      target: hit,
    };
    pointers.set(e.pointerId, info);

    if (pointers.size === 2) {
      // Begin pinch — cancel any single-pointer interaction.
      endDrag(false);
      panning = false;
      beginPinch();
      return;
    }

    if (hit) {
      // potential item drag (becomes drag on move, tap on release)
      dragItem = hit;
      dragMoved = false;
    } else {
      // potential pan
      panning = true;
      panStartCamX = camX;
      panStartCamY = camY;
    }
  }

  function beginPinch(): void {
    const pts = Array.from(pointers.values());
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return;
    pinching = true;
    dragItem = null;
    pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    pinchStartScale = camScale;
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    pinchMidBg = screenToBg(midX, midY);
  }

  function onPointerMove(e: PointerEvent): void {
    const info = pointers.get(e.pointerId);
    if (!info) return;
    info.clientX = e.clientX;
    info.clientY = e.clientY;

    if (pinching) {
      const pts = Array.from(pointers.values());
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      camScale = pinchStartScale * (dist / pinchStartDist);
      camScale = Math.max(minScale, Math.min(MAX_ZOOM, camScale));
      // keep pinch midpoint anchored
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const rect = viewport.getBoundingClientRect();
      camX = midX - rect.left - pinchMidBg.x * camScale;
      camY = midY - rect.top - pinchMidBg.y * camScale;
      clampCamera();
      applyCamera();
      return;
    }

    const dxScreen = info.clientX - info.startClientX;
    const dyScreen = info.clientY - info.startClientY;
    const movedFar = Math.hypot(dxScreen, dyScreen) > TAP_MAX_MOVE;

    if (dragItem) {
      if (movedFar && !dragMoved) {
        dragMoved = true;
        liftItem(dragItem);
        if (!timerStarted) startTimer();
      }
      if (dragMoved) {
        // Move item in bg space by the screen delta / scale.
        dragItem.x += (e.clientX - (info.lastClientX ?? info.clientX)) / camScale;
        dragItem.y += (e.clientY - (info.lastClientY ?? info.clientY)) / camScale;
        positionItem(dragItem);
      }
    } else if (panning) {
      camX = panStartCamX + dxScreen;
      camY = panStartCamY + dyScreen;
      clampCamera();
      applyCamera();
    }
    info.lastClientX = e.clientX;
    info.lastClientY = e.clientY;
  }

  function positionItem(it: ItemState): void {
    const w = it.naturalWidth * it.scale;
    const h = it.naturalHeight * it.scale;
    it.elImg.style.left = `${it.x - w / 2}px`;
    it.elImg.style.top = `${it.y - h / 2}px`;
  }

  function liftItem(it: ItemState): void {
    it.elImg.classList.remove(`${PREFIX}settling`);
    it.elImg.classList.add(`${PREFIX}lifted`);
    // raise above siblings while dragging
    it.elImg.style.zIndex = String(10000);
    setItemTransform(it, 1.1, true);
  }

  function settleItem(it: ItemState): void {
    it.elImg.classList.remove(`${PREFIX}lifted`);
    it.elImg.classList.add(`${PREFIX}settling`);
    it.elImg.style.zIndex = String(it.zIndex);
    setItemTransform(it, 1, false);
    const to = setTimeout(() => {
      it.elImg.classList.remove(`${PREFIX}settling`);
      pendingTimeouts.delete(to);
    }, 200);
    pendingTimeouts.add(to);
  }

  function endDrag(settle: boolean): void {
    if (dragItem && dragMoved && settle) settleItem(dragItem);
    dragItem = null;
    dragMoved = false;
  }

  function onPointerUp(e: PointerEvent): void {
    const info = pointers.get(e.pointerId);
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (!info) {
      pointers.delete(e.pointerId);
      return;
    }

    if (pinching) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        pinching = false;
        // If one pointer remains, restart pan from its position.
        const rem = Array.from(pointers.values())[0];
        if (rem) {
          panning = true;
          panStartCamX = camX;
          panStartCamY = camY;
          rem.startClientX = rem.clientX;
          rem.startClientY = rem.clientY;
        }
      }
      return;
    }

    const elapsedMs = performance.now() - info.startTime;
    const dist = Math.hypot(info.clientX - info.startClientX, info.clientY - info.startClientY);
    const isTap = dist <= TAP_MAX_MOVE && elapsedMs <= TAP_MAX_MS;

    if (dragItem) {
      if (isTap && !dragMoved) {
        handleTap(info);
      } else {
        endDrag(true);
      }
    } else if (panning) {
      // a tap on empty space with no item is ignored (could also be a tap that
      // missed all items)
      if (isTap) handleTap(info);
    }

    panning = false;
    pointers.delete(e.pointerId);
  }

  function handleTap(info: PointerInfo): void {
    if (done) return;
    if (!timerStarted) startTimer();

    const bgPt = screenToBg(info.clientX, info.clientY);
    const hitId = hitTest(bgPt, placedSnapshot());
    if (!hitId) return;

    const hitItem = items.find((it) => it.id === hitId);
    if (!hitItem) return;

    // Found only if the topmost item at the point is one of the active targets.
    const active = activeTargets();
    if (active.some((t) => t.id === hitItem.id)) {
      markFound(hitItem);
    }
    // Otherwise: either a decoy on top (must drag it away) or a non-active
    // target — nothing happens.
  }

  function onPointerCancel(e: PointerEvent): void {
    const info = pointers.get(e.pointerId);
    if (info && dragItem && dragMoved) settleItem(dragItem);
    if (dragItem) endDrag(false);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinching = false;
    panning = false;
  }

  function onWheel(e: WheelEvent): void {
    if (done) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const anchor = screenToBg(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    camScale = Math.max(minScale, Math.min(MAX_ZOOM, camScale * factor));
    camX = e.clientX - rect.left - anchor.x * camScale;
    camY = e.clientY - rect.top - anchor.y * camScale;
    clampCamera();
    applyCamera();
    if (!timerStarted) startTimer();
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerCancel);
  viewport.addEventListener('wheel', onWheel, { passive: false });

  // --- resize handling ---
  const resizeObserver = new ResizeObserver(() => {
    // Recompute fit min-scale, keep within bounds.
    if (bgW === 0 || bgH === 0) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw === 0 || vh === 0) return;
    minScale = Math.min(vw / bgW, vh / bgH);
    if (camScale < minScale) camScale = minScale;
    clampCamera();
    applyCamera();
  });
  resizeObserver.observe(viewport);

  // ---------------------------------------------------------------------------
  // Asset loading
  // ---------------------------------------------------------------------------

  function buildItem(cfg: ItemConfig, idx: number, isTarget: boolean, order: number): void {
    const img = el('img', `${PREFIX}item`) as HTMLImageElement;
    img.draggable = false;
    img.src = cfg.image;
    const state: ItemState = {
      id: `${isTarget ? 't' : 'o'}${idx}`,
      cfg,
      isTarget,
      targetOrder: order,
      found: false,
      x: cfg.x,
      y: cfg.y,
      naturalWidth: 0,
      naturalHeight: 0,
      scale: cfg.scale ?? 1,
      rotation: cfg.rotation ?? 0,
      zIndex: cfg.zIndex ?? 0,
      elImg: img,
    };
    img.addEventListener('load', () => {
      state.naturalWidth = img.naturalWidth;
      state.naturalHeight = img.naturalHeight;
      styleItem(state);
    });
    // In case the image fails to load, give it a tiny fallback so hitTest is sane.
    img.addEventListener('error', () => {
      state.naturalWidth = state.naturalWidth || 64;
      state.naturalHeight = state.naturalHeight || 64;
      styleItem(state);
    });
    scene.appendChild(img);
    items.push(state);
  }

  bg.addEventListener('load', () => {
    bgW = bg.naturalWidth;
    bgH = bg.naturalHeight;
    bg.style.width = `${bgW}px`;
    bg.style.height = `${bgH}px`;
    fitToViewport();
  });
  bg.src = config.backgroundImage;

  overlaysCfg.forEach((cfg, i) => buildItem(cfg, i, false, -1));
  targetsCfg.forEach((cfg, i) => buildItem(cfg, i, true, i));

  renderThumbs(false);
  updateTimer();

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  function teardownLoops(): void {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const to of pendingTimeouts) clearTimeout(to);
    pendingTimeouts.clear();
  }

  function destroy(): void {
    teardownLoops();
    resizeObserver.disconnect();
    viewport.removeEventListener('pointerdown', onPointerDown);
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerup', onPointerUp);
    viewport.removeEventListener('pointercancel', onPointerCancel);
    viewport.removeEventListener('wheel', onWheel);
    stopMusic();
    if (music) {
      music.src = '';
      music = null;
    }
    void sfxCtx.close();
    container.innerHTML = '';
  }

  return { destroy };
}
