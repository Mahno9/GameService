import { describe, expect, it } from 'vitest';
import { buildMeta, buildStyle } from './mapStyle.js';
import type { Settings } from '../repos/settings.js';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    trigger_radius_m: 25,
    sync_interval_s: 30,
    debug_mode: false,
    gps_timeout_min: 5,
    joystick_speed_mps: 3,
    zoom_threshold: 15.5,
    map_bbox: null,
    ...overrides,
  };
}

const BBOX = [37.6, 55.75, 37.63, 55.76] as const;
const ORIGIN = 'http://localhost:3000';

describe('buildMeta', () => {
  it('returns null when map_bbox is null', () => {
    expect(buildMeta(makeSettings())).toBeNull();
  });

  it('returns correct meta when bbox is set', () => {
    const meta = buildMeta(makeSettings({ map_bbox: [...BBOX] }));
    expect(meta).not.toBeNull();
    expect(meta!.bbox).toEqual([37.6, 55.75, 37.63, 55.76]);
    expect(meta!.vectorZooms).toEqual({ min: 14, max: 17 });
    expect(meta!.rasterZooms).toEqual({ min: 11, max: 13 });
    expect(meta!.zoomThreshold).toBe(15.5);
  });

  it('uses default zoom_threshold 15.5 when not a number', () => {
    const meta = buildMeta(makeSettings({ map_bbox: [...BBOX], zoom_threshold: undefined }));
    expect(meta!.zoomThreshold).toBe(15.5);
  });
});

describe('buildStyle', () => {
  it('returns null when map_bbox is null', () => {
    expect(buildStyle(makeSettings(), ORIGIN)).toBeNull();
  });

  it('returns a valid style object when bbox is set', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX] }), ORIGIN);
    expect(style).not.toBeNull();
    expect(style!.version).toBe(8);
  });

  it('vector source tiles URL starts with origin and contains /tiles/vector/', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX] }), ORIGIN)!;
    const url = style.sources.vector.tiles[0];
    expect(url.startsWith(ORIGIN)).toBe(true);
    expect(url).toContain('/tiles/vector/');
  });

  it('raster source tiles URL starts with origin and contains /tiles/raster/', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX] }), ORIGIN)!;
    const url = style.sources.raster.tiles[0];
    expect(url.startsWith(ORIGIN)).toBe(true);
    expect(url).toContain('/tiles/raster/');
  });

  it('building layer has type fill-extrusion', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX] }), ORIGIN)!;
    const buildingLayer = style.layers.find((l) => l.id === 'building');
    expect(buildingLayer).toBeDefined();
    expect(buildingLayer!.type).toBe('fill-extrusion');
  });

  it('has no raster layer (raster basemap disabled, vector-only)', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX], zoom_threshold: 15.5 }), ORIGIN)!;
    expect(style.layers.find((l) => l.id === 'raster')).toBeUndefined();
  });

  it('vector-source layers have no minzoom gate (render at all zooms)', () => {
    const style = buildStyle(
      makeSettings({ map_bbox: [...BBOX], zoom_threshold: 15.5 }),
      ORIGIN,
    )!;
    const vectorLayers = style.layers.filter(
      (l) => 'source' in l && l.source === 'vector',
    );
    expect(vectorLayers.length).toBeGreaterThan(0);
    for (const layer of vectorLayers) {
      expect((layer as { minzoom?: number }).minzoom).toBeUndefined();
    }
  });

  it('sources have correct bounds matching bbox', () => {
    const style = buildStyle(makeSettings({ map_bbox: [...BBOX] }), ORIGIN)!;
    expect(style.sources.vector.bounds).toEqual([37.6, 55.75, 37.63, 55.76]);
    expect(style.sources.raster.bounds).toEqual([37.6, 55.75, 37.63, 55.76]);
  });
});
