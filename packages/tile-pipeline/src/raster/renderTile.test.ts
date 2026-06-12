import { describe, it, expect } from 'vitest';
import { overpassToLayers } from '../layers.js';
import { renderTileToCanvas, RASTER_COLORS, type Canvas2DLike } from './renderTile.js';
import type { TileCoord } from '../tileMath.js';
import overpassSample from '../fixtures/overpass-sample.json';

interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}

/** Recording fake 2D context: tracks style at the moment each op is issued. */
function makeRecordingCtx() {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const fillRects: FillRectCall[] = [];
  const lineWidths: number[] = [];

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    lineCap: '',
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h, fillStyle: this.fillStyle });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      fillStyles.push(this.fillStyle);
    },
    stroke() {
      strokeStyles.push(this.strokeStyle);
      lineWidths.push(this.lineWidth);
    },
  };

  return { ctx: ctx as Canvas2DLike & typeof ctx, fillStyles, strokeStyles, fillRects, lineWidths };
}

// z14 tile covering the fixture area (lon 37.617, lat 55.755).
const COORD: TileCoord = { z: 14, x: 9903, y: 5121 };

describe('renderTileToCanvas', () => {
  it('draws background, building fill, and road strokes for the fixture tile', () => {
    const layers = overpassToLayers(overpassSample);
    const { ctx, fillStyles, strokeStyles, fillRects } = makeRecordingCtx();

    renderTileToCanvas(ctx, layers, COORD, 512);

    // Background fillRect across the whole tile with the background color.
    const bg = fillRects.find((r) => r.fillStyle === RASTER_COLORS.background);
    expect(bg).toBeDefined();
    expect(bg).toMatchObject({ x: 0, y: 0, w: 512, h: 512 });

    // Building fill color was used.
    expect(fillStyles).toContain(RASTER_COLORS.building);

    // The fixture has a residential (street) and footway (path) road.
    expect(strokeStyles).toContain(RASTER_COLORS.roadStreet);
    expect(strokeStyles).toContain(RASTER_COLORS.roadPath);
  });

  it('uses the default size of 512 for the background', () => {
    const layers = overpassToLayers(overpassSample);
    const { ctx, fillRects } = makeRecordingCtx();
    renderTileToCanvas(ctx, layers, COORD);
    const bg = fillRects.find((r) => r.fillStyle === RASTER_COLORS.background);
    expect(bg).toMatchObject({ w: 512, h: 512 });
  });
});
