import type { LayeredGeojson } from '../layers.js';
import type { TileCoord } from '../tileMath.js';
import type { RasterWorkerMessage, RasterWorkerRequest } from './rasterWorker.js';

export interface RenderedTile {
  coord: TileCoord;
  buffer: ArrayBuffer;
}

export interface RenderPoolOptions {
  layers: LayeredGeojson;
  tiles: TileCoord[];
  size: number;
  /** Called for each rendered tile as soon as it arrives from any worker. */
  onTile: (tile: RenderedTile) => void | Promise<void>;
  signal?: AbortSignal;
}

function workerCount(): number {
  const hc =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 2;
  return Math.max(1, Math.min(hc - 1, 4));
}

/** Split tiles into `n` roughly even contiguous chunks. */
function chunk<T>(items: T[], n: number): T[][] {
  if (items.length === 0) return [];
  const parts = Math.max(1, Math.min(n, items.length));
  const out: T[][] = [];
  const per = Math.ceil(items.length / parts);
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

/**
 * Spawn a pool of module workers, distribute the tile list across them, and
 * invoke `onTile` for each rendered tile. Resolves when every worker reports
 * `done`; rejects on the first worker error or on abort. Always terminates all
 * workers before settling.
 */
export function renderTilesWithPool(opts: RenderPoolOptions): Promise<void> {
  const { layers, tiles, size, onTile, signal } = opts;

  return new Promise<void>((resolve, reject) => {
    if (tiles.length === 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }

    const chunks = chunk(tiles, workerCount());
    const workers: Worker[] = [];
    let remaining = chunks.length;
    let settled = false;
    const pending: Promise<unknown>[] = [];

    const cleanup = (): void => {
      for (const w of workers) w.terminate();
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else void Promise.all(pending).then(() => resolve(), reject);
    };

    function onAbort(): void {
      finish(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    }
    if (signal) signal.addEventListener('abort', onAbort);

    for (const tileChunk of chunks) {
      const worker = new Worker(new URL('./rasterWorker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);

      worker.onmessage = (ev: MessageEvent<RasterWorkerMessage>): void => {
        const msg = ev.data;
        if (msg.type === 'tile') {
          const r = onTile({ coord: msg.coord, buffer: msg.buffer });
          if (r) pending.push(Promise.resolve(r).catch((e) => finish(e as Error)));
        } else if (msg.type === 'done') {
          remaining -= 1;
          if (remaining === 0) finish();
        } else {
          finish(new Error(msg.message));
        }
      };
      worker.onerror = (ev: ErrorEvent): void => {
        finish(new Error(ev.message || 'worker error'));
      };

      const req: RasterWorkerRequest = { layers, tiles: tileChunk, size };
      worker.postMessage(req);
    }
  });
}
