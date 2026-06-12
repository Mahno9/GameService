import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type Bbox } from '../api';

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function bboxToPolygon([w, s, e, n]: Bbox): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}

export function MapSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [bbox, setBbox] = useState<Bbox | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [saved, setSaved] = useState(false);
  const drawingRef = useRef(false);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: OSM_STYLE,
      center: [37.62, 55.755],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl());
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('bbox', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'bbox-fill',
        type: 'fill',
        source: 'bbox',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: 'bbox-line',
        type: 'line',
        source: 'bbox',
        paint: { 'line-color': '#2563eb', 'line-width': 2 },
      });

      api.getSettings().then((s) => {
        if (s.map_bbox) {
          setBbox(s.map_bbox);
          const [w, so, e, n] = s.map_bbox;
          map.fitBounds([w, so, e, n], { padding: 40, duration: 0 });
        }
      });
    });

    // drag-rectangle: mousedown → mousemove preview → mouseup commit
    let start: maplibregl.LngLat | null = null;

    function toBbox(a: maplibregl.LngLat, b: maplibregl.LngLat): Bbox {
      return [
        Math.min(a.lng, b.lng),
        Math.min(a.lat, b.lat),
        Math.max(a.lng, b.lng),
        Math.max(a.lat, b.lat),
      ];
    }

    map.on('mousedown', (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      start = e.lngLat;
    });
    map.on('mousemove', (e) => {
      if (!drawingRef.current || !start) return;
      const box = toBbox(start, e.lngLat);
      (map.getSource('bbox') as maplibregl.GeoJSONSource)?.setData(bboxToPolygon(box));
    });
    map.on('mouseup', (e) => {
      if (!drawingRef.current || !start) return;
      const box = toBbox(start, e.lngLat);
      start = null;
      drawingRef.current = false;
      setDrawing(false);
      map.dragPan.enable();
      setBbox(box);
      setSaved(false);
      (map.getSource('bbox') as maplibregl.GeoJSONSource)?.setData(bboxToPolygon(box));
    });

    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (bbox && map.isStyleLoaded()) {
      (map.getSource('bbox') as maplibregl.GeoJSONSource)?.setData(bboxToPolygon(bbox));
    }
  }, [bbox]);

  function startDrawing() {
    drawingRef.current = true;
    setDrawing(true);
    setSaved(false);
    mapRef.current?.dragPan.disable();
  }

  async function save() {
    if (!bbox) return;
    await api.updateSettings({ map_bbox: bbox });
    setSaved(true);
  }

  return (
    <div className="map-section">
      <div className="map-toolbar">
        <button onClick={startDrawing} disabled={drawing}>
          {drawing ? 'Растяните прямоугольник…' : 'Выбрать участок'}
        </button>
        <button onClick={save} disabled={!bbox || saved}>
          {saved ? 'Сохранено ✓' : 'Сохранить участок'}
        </button>
        {bbox && (
          <span className="bbox-label">
            [{bbox.map((v) => v.toFixed(4)).join(', ')}]
          </span>
        )}
      </div>
      <div ref={containerRef} className="map-container" />
    </div>
  );
}
