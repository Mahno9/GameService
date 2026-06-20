import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { getAllSettings } from '../repos/settings.js';
import type { Settings } from '../repos/settings.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapMeta {
  bbox: [number, number, number, number];
  vectorZooms: { min: 14; max: 17 };
  rasterZooms: { min: 11; max: 13 };
  zoomThreshold: number;
}

// Minimal MapLibre GL Style Spec v8 shapes (only what we produce)
type ColorSpec = string;
type ExpressionSpec = unknown[];

interface BackgroundLayer {
  id: string;
  type: 'background';
  paint: { 'background-color': ColorSpec };
}

interface RasterLayer {
  id: string;
  type: 'raster';
  source: string;
  maxzoom?: number;
}

interface FillLayer {
  id: string;
  type: 'fill';
  source: string;
  'source-layer': string;
  minzoom?: number;
  filter?: ExpressionSpec;
  paint: { 'fill-color': ColorSpec };
}

interface LineLayer {
  id: string;
  type: 'line';
  source: string;
  'source-layer': string;
  minzoom?: number;
  filter?: ExpressionSpec;
  paint: {
    'line-color': ColorSpec;
    'line-width': number | ExpressionSpec;
    'line-dasharray'?: number[];
  };
}

interface FillExtrusionLayer {
  id: string;
  type: 'fill-extrusion';
  source: string;
  'source-layer': string;
  minzoom?: number;
  paint: {
    'fill-extrusion-color': ColorSpec;
    'fill-extrusion-height': ExpressionSpec;
    'fill-extrusion-base': number;
    'fill-extrusion-opacity': number;
  };
}

type AnyLayer =
  | BackgroundLayer
  | RasterLayer
  | FillLayer
  | LineLayer
  | FillExtrusionLayer;

export interface MapStyle {
  version: 8;
  sources: {
    vector: {
      type: 'vector';
      tiles: [string];
      minzoom: 14;
      maxzoom: 17;
      bounds: [number, number, number, number];
    };
    raster: {
      type: 'raster';
      tiles: [string];
      tileSize: 256;
      minzoom: 11;
      maxzoom: 13;
      bounds: [number, number, number, number];
    };
  };
  layers: AnyLayer[];
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function buildMeta(settings: Settings): MapMeta | null {
  const bbox = settings.map_bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const typed = bbox as [number, number, number, number];
  const zoomThreshold =
    typeof settings.zoom_threshold === 'number' ? settings.zoom_threshold : 15.5;
  return {
    bbox: typed,
    vectorZooms: { min: 14, max: 17 },
    rasterZooms: { min: 11, max: 13 },
    zoomThreshold,
  };
}

export function buildStyle(settings: Settings, origin: string): MapStyle | null {
  const meta = buildMeta(settings);
  if (!meta) return null;

  const { bbox } = meta;

  // Helper: zoom interpolate expression for line-width
  const widthInterp = (z14: number, z17: number): ExpressionSpec => [
    'interpolate',
    ['linear'],
    ['zoom'],
    14,
    z14,
    17,
    z17,
  ];

  const vectorLayers: AnyLayer[] = [
    // landuse
    {
      id: 'landuse',
      type: 'fill',
      source: 'vector',
      'source-layer': 'landuse',
      paint: { 'fill-color': '#1a1e2e' },
    } satisfies FillLayer,

    // green
    {
      id: 'green',
      type: 'fill',
      source: 'vector',
      'source-layer': 'green',
      paint: { 'fill-color': '#16321f' },
    } satisfies FillLayer,

    // water polygon
    {
      id: 'water',
      type: 'fill',
      source: 'vector',
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#10243d' },
    } satisfies FillLayer,

    // water line (waterway)
    {
      id: 'water-line',
      type: 'line',
      source: 'vector',
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#1d3a5f',
        'line-width': 2,
      },
    } satisfies LineLayer,

    // road: major
    {
      id: 'road-major',
      type: 'line',
      source: 'vector',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'major'],
      paint: {
        'line-color': '#3d4466',
        'line-width': widthInterp(2, 8),
      },
    } satisfies LineLayer,

    // road: street
    {
      id: 'road-street',
      type: 'line',
      source: 'vector',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'street'],
      paint: {
        'line-color': '#2e3450',
        'line-width': widthInterp(1.5, 6),
      },
    } satisfies LineLayer,

    // road: path
    {
      id: 'road-path',
      type: 'line',
      source: 'vector',
      'source-layer': 'road',
      filter: ['==', ['get', 'class'], 'path'],
      paint: {
        'line-color': '#262c44',
        'line-width': widthInterp(1, 3),
        'line-dasharray': [2, 2],
      },
    } satisfies LineLayer,

    // buildings
    {
      id: 'building',
      type: 'fill-extrusion',
      source: 'vector',
      'source-layer': 'building',
      paint: {
        'fill-extrusion-color': '#2a3052',
        'fill-extrusion-height': ['get', 'render_height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.85,
      },
    } satisfies FillExtrusionLayer,
  ];

  const layers: AnyLayer[] = [
    // background
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#12121f' },
    } satisfies BackgroundLayer,

    // Raster basemap disabled for now: vector layers render at every zoom.
    // The raster source + tile pipeline stay in place — re-add a raster layer
    // here (e.g. { id, type: 'raster', source: 'raster', maxzoom: zoomThreshold })
    // to bring it back.

    ...vectorLayers,
  ];

  return {
    version: 8,
    sources: {
      vector: {
        type: 'vector',
        tiles: [`${origin}/tiles/vector/{z}/{x}/{y}.mvt`],
        minzoom: 14,
        maxzoom: 17,
        bounds: bbox,
      },
      raster: {
        type: 'raster',
        tiles: [`${origin}/tiles/raster/{z}/{x}/{y}.webp`],
        tileSize: 256,
        minzoom: 11,
        maxzoom: 13,
        bounds: bbox,
      },
    },
    layers,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function mapStyleRoutes(app: FastifyInstance) {
  app.get('/api/map/meta', async (_req, reply) => {
    const meta = buildMeta(getAllSettings(getDb()));
    if (!meta) return reply.code(409).send({ error: 'map not configured' });
    return meta;
  });

  app.get('/api/map/style.json', async (req, reply) => {
    const origin = `${req.protocol}://${req.headers.host as string}`;
    const style = buildStyle(getAllSettings(getDb()), origin);
    if (!style) return reply.code(409).send({ error: 'map not configured' });
    void reply.header('Cache-Control', 'no-cache');
    return style;
  });
}
