/// <reference lib="webworker" />
import type { LayeredGeojson } from '../layers.js';
import type { TileCoord } from '../tileMath.js';
import { renderTileToCanvas, type Canvas2DLike } from './renderTile.js';

export interface RasterWorkerRequest {
  layers: LayeredGeojson;
  tiles: TileCoord[];
  size: number;
}

export type RasterWorkerMessage =
  | { type: 'tile'; coord: TileCoord; buffer: ArrayBuffer }
  | { type: 'done' }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<RasterWorkerRequest>): Promise<void> => {
  const { layers, tiles, size } = ev.data;
  try {
    for (const coord of tiles) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) throw new Error('OffscreenCanvas 2D context unavailable');
      renderTileToCanvas(ctx2d as unknown as Canvas2DLike, layers, coord, size);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
      const buffer = await blob.arrayBuffer();
      const msg: RasterWorkerMessage = { type: 'tile', coord, buffer };
      ctx.postMessage(msg, [buffer]);
    }
    ctx.postMessage({ type: 'done' } satisfies RasterWorkerMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'error', message } satisfies RasterWorkerMessage);
  }
};
