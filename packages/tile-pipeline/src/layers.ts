import osmtogeojson from 'osmtogeojson';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type LayerName = 'building' | 'road' | 'water' | 'green' | 'landuse';

export type LayeredGeojson = Record<LayerName, FeatureCollection>;

const LEVEL_HEIGHT_M = 3;
const DEFAULT_BUILDING_HEIGHT_M = 8;

/** Road category → relative visual weight, carried into MVT for styling. */
const ROAD_CLASSES: Record<string, string> = {
  motorway: 'major',
  trunk: 'major',
  primary: 'major',
  secondary: 'major',
  tertiary: 'street',
  residential: 'street',
  unclassified: 'street',
  service: 'street',
  living_street: 'street',
  pedestrian: 'path',
  footway: 'path',
  path: 'path',
  cycleway: 'path',
  steps: 'path',
  track: 'path',
};

const GREEN_TAGS = new Set([
  'park',
  'garden',
  'playground',
  'pitch',
  'wood',
  'scrub',
  'grassland',
  'grass',
  'forest',
  'meadow',
  'recreation_ground',
  'village_green',
]);

export function parseRenderHeight(tags: Record<string, string>): number {
  const h = parseFloat(tags['height'] ?? '');
  if (Number.isFinite(h) && h > 0) return h;
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * LEVEL_HEIGHT_M;
  return DEFAULT_BUILDING_HEIGHT_M;
}

function isPolygonal(geom: Geometry): boolean {
  return geom.type === 'Polygon' || geom.type === 'MultiPolygon';
}

function isLinear(geom: Geometry): boolean {
  return geom.type === 'LineString' || geom.type === 'MultiLineString';
}

function classify(feature: Feature): { layer: LayerName; props: Record<string, unknown> } | null {
  const tags = (feature.properties ?? {}) as Record<string, string>;
  const geom = feature.geometry;

  if (tags['building'] && tags['building'] !== 'no' && isPolygonal(geom)) {
    return { layer: 'building', props: { render_height: parseRenderHeight(tags) } };
  }

  const highway = tags['highway'];
  if (highway && isLinear(geom)) {
    const cls = ROAD_CLASSES[highway];
    if (cls) return { layer: 'road', props: { class: cls, kind: highway } };
    return null;
  }

  if (
    (tags['natural'] === 'water' || tags['waterway'] === 'riverbank') &&
    isPolygonal(geom)
  ) {
    return { layer: 'water', props: {} };
  }
  if (tags['waterway'] && isLinear(geom)) {
    return { layer: 'water', props: { kind: tags['waterway'] } };
  }

  const greenTag = tags['leisure'] ?? tags['landuse'] ?? tags['natural'];
  if (greenTag && GREEN_TAGS.has(greenTag) && isPolygonal(geom)) {
    return { layer: 'green', props: { kind: greenTag } };
  }

  if (tags['landuse'] && isPolygonal(geom)) {
    return { layer: 'landuse', props: { kind: tags['landuse'] } };
  }

  return null;
}

/** Overpass JSON → GeoJSON features bucketed into named style layers. */
export function overpassToLayers(overpassJson: unknown): LayeredGeojson {
  const collection = osmtogeojson(overpassJson) as FeatureCollection;

  const layers: LayeredGeojson = {
    building: { type: 'FeatureCollection', features: [] },
    road: { type: 'FeatureCollection', features: [] },
    water: { type: 'FeatureCollection', features: [] },
    green: { type: 'FeatureCollection', features: [] },
    landuse: { type: 'FeatureCollection', features: [] },
  };

  for (const feature of collection.features) {
    const hit = classify(feature);
    if (!hit) continue;
    layers[hit.layer].features.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: hit.props,
    });
  }

  return layers;
}
