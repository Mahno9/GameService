import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type Poi, type Settings } from '../api';
import { bboxToPolygon, circlePolygon } from '../lib/geo';

// ---------------------------------------------------------------------------
// OSM style (same as PoiSection)
// ---------------------------------------------------------------------------

// Shared with the player app (same origin): debug joystick start point.
const DEBUG_START_KEY = 'gs_debug_start';

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

// ---------------------------------------------------------------------------
// Player preview tab
// ---------------------------------------------------------------------------

function PlayerPreviewTab() {
  // In dev the player may run on a different port (e.g. 5174 vs 5173).
  // We point to the same origin which works in production; in dev we show
  // an absolute URL hint so the developer can copy it manually.
  const previewUrl = '/?preview=1';
  const absoluteUrl = `${window.location.protocol}//${window.location.host}${previewUrl}`;

  return (
    <div className='preview-player-tab'>
      <div className='preview-player-hint'>
        <span>Предпросмотр плеера (полный UI). В dev-режиме плеер может работать на другом порту.</span>
        <a
          href={absoluteUrl}
          target='_blank'
          rel='noreferrer'
          className='preview-player-url'
        >
          {absoluteUrl}
        </a>
      </div>
      <iframe
        src={previewUrl}
        className='preview-player-iframe'
        title='Предпросмотр игрока'
        allow='geolocation'
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// POI overview tab (read-only MapLibre map)
// ---------------------------------------------------------------------------

function PoiOverviewTab() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [pois, setPois] = useState<Poi[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  const [startPoint, setStartPoint] = useState<{ lat: number; lon: number } | null>(null);

  // Drop or move the start-point pin at the given coords.
  function placeStartMarker(map: maplibregl.Map, lat: number, lon: number) {
    if (startMarkerRef.current) {
      startMarkerRef.current.setLngLat([lon, lat]);
    } else {
      const el = document.createElement('div');
      el.textContent = '📍';
      el.style.fontSize = '28px';
      el.style.cursor = 'pointer';
      startMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lon, lat])
        .addTo(map);
    }
  }

  function clearStartPoint() {
    localStorage.removeItem(DEBUG_START_KEY);
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    setStartPoint(null);
  }

  useEffect(() => {
    void Promise.all([api.getPois(), api.getSettings()]).then(([ps, s]) => {
      setPois(ps);
      setSettings(s);
    });
  }, []);

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [37.62, 55.755],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl());
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('bbox', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'bbox-fill', type: 'fill', source: 'bbox', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.06 } });
      map.addLayer({ id: 'bbox-line', type: 'line', source: 'bbox', paint: { 'line-color': '#2563eb', 'line-width': 2 } });

      map.addSource('radii', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'radii-fill', type: 'fill', source: 'radii', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.14 } });
      map.addLayer({ id: 'radii-line', type: 'line', source: 'radii', paint: { 'line-color': '#d97706', 'line-width': 1 } });

      // Restore previously saved test start point, if any.
      try {
        const saved = localStorage.getItem(DEBUG_START_KEY);
        if (saved) {
          const p = JSON.parse(saved) as { lat: number; lon: number };
          placeStartMarker(map, p.lat, p.lon);
          setStartPoint(p);
        }
      } catch { /* ignore malformed value */ }

      setReady(true);
    });

    // Right-click the map to set the test start point.
    map.on('contextmenu', (e) => {
      e.preventDefault();
      const p = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      localStorage.setItem(DEBUG_START_KEY, JSON.stringify(p));
      placeStartMarker(map, p.lat, p.lon);
      setStartPoint(p);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Populate map when data + map are both ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !settings) return;

    // Bbox
    if (settings.map_bbox) {
      const [w, s, e, n] = settings.map_bbox;
      (map.getSource('bbox') as maplibregl.GeoJSONSource | undefined)?.setData(
        bboxToPolygon([w, s, e, n]),
      );
      map.fitBounds([w, s, e, n], { padding: 60, duration: 0 });
    }

    // Radii circles
    const radiusM = settings.trigger_radius_m;
    const circleFeatures = pois.map((p) => circlePolygon(p.lat, p.lon, radiusM));
    (map.getSource('radii') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: circleFeatures,
    });

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Add POI markers (read-only, no click handler needed beyond name)
    for (const poi of pois) {
      const el = document.createElement('div');
      el.className = 'poi-marker';
      const dot = document.createElement('div');
      dot.className = 'poi-marker-dot poi-marker-dot--preview';
      const label = document.createElement('div');
      label.className = 'poi-marker-label';
      label.textContent = poi.name;
      el.appendChild(dot);
      el.appendChild(label);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lon, poi.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    // Fit to POIs if no bbox
    if (!settings.map_bbox && pois.length > 0) {
      const lngs = pois.map((p) => p.lon);
      const lats = pois.map((p) => p.lat);
      const w = Math.min(...lngs) - 0.002;
      const e = Math.max(...lngs) + 0.002;
      const s = Math.min(...lats) - 0.002;
      const n = Math.max(...lats) + 0.002;
      map.fitBounds([w, s, e, n], { padding: 60, duration: 0 });
    }
  }, [pois, settings, ready]);

  return (
    <div className='preview-poi-tab'>
      <div className='preview-poi-legend'>
        <span className='preview-legend-item preview-legend-item--poi'>Точки интереса</span>
        <span className='preview-legend-item preview-legend-item--radius'>Радиус триггера</span>
        {settings?.map_bbox && (
          <span className='preview-legend-item preview-legend-item--bbox'>Область карты</span>
        )}
        <span className='preview-legend-count'>{pois.length} POI</span>
        <span className='preview-legend-hint'>
          {startPoint
            ? `📍 старт теста: ${startPoint.lat.toFixed(5)}, ${startPoint.lon.toFixed(5)}`
            : 'Правый клик по карте — задать точку старта теста'}
        </span>
        {startPoint && (
          <button type='button' className='preview-start-clear' onClick={clearStartPoint}>
            Сбросить
          </button>
        )}
      </div>
      <div ref={containerRef} className='preview-poi-map' />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

type PreviewTab = 'player' | 'poi';

export function PreviewSection() {
  const [tab, setTab] = useState<PreviewTab>('player');

  return (
    <div className='preview-section'>
      <div className='preview-tabs'>
        <button
          className={`preview-tab-btn${tab === 'player' ? ' preview-tab-btn--active' : ''}`}
          onClick={() => setTab('player')}
        >
          Глазами игрока
        </button>
        <button
          className={`preview-tab-btn${tab === 'poi' ? ' preview-tab-btn--active' : ''}`}
          onClick={() => setTab('poi')}
        >
          Обзор POI
        </button>
      </div>

      <div className='preview-body'>
        {tab === 'player' && <PlayerPreviewTab />}
        {tab === 'poi' && <PoiOverviewTab />}
      </div>
    </div>
  );
}
