import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, ApiError, type Bbox } from '../api';
import type { PlayerPosition, PositionProvider } from './positionProvider';
import './map.css';

interface MapViewProps {
  provider: PositionProvider;
  /** Called with the map once 'load' fires, and with null on teardown. */
  onMapReady?: (map: maplibregl.Map | null) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

function bboxCenter([w, s, e, n]: Bbox): [number, number] {
  return [(w + e) / 2, (s + n) / 2];
}

/** Pads a bbox by ~10% of its span so the player can't pan to the very edge. */
function padBounds([w, s, e, n]: Bbox): [[number, number], [number, number]] {
  const padX = (e - w) * 0.1;
  const padY = (n - s) * 0.1;
  return [
    [w - padX, s - padY],
    [e + padX, n + padY],
  ];
}

function createMarkerElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'player-marker';
  const arrow = document.createElement('div');
  arrow.className = 'player-marker-arrow';
  const dot = document.createElement('div');
  dot.className = 'player-marker-dot';
  el.appendChild(arrow);
  el.appendChild(dot);
  return el;
}

export function MapView({ provider, onMapReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const followRef = useRef(true);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [followMode, setFollowMode] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    async function init() {
      let style: maplibregl.StyleSpecification;
      let meta;
      try {
        [style, meta] = await Promise.all([
          api.getMapStyle() as Promise<maplibregl.StyleSpecification>,
          api.getMapMeta(),
        ]);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 409) {
          setState({ kind: 'unconfigured' });
        } else {
          setState({ kind: 'error', message: err instanceof Error ? err.message : 'Ошибка' });
        }
        return;
      }
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: bboxCenter(meta.bbox),
        zoom: 16,
        pitch: 45,
        maxBounds: padBounds(meta.bbox),
        attributionControl: false,
      });
      mapRef.current = map;

      // Bearing is driven by movement heading, not user gestures.
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();

      const marker = new maplibregl.Marker({
        element: createMarkerElement(),
        rotationAlignment: 'map',
      })
        .setLngLat(bboxCenter(meta.bbox))
        .addTo(map);
      markerRef.current = marker;

      // User panning breaks follow mode until «центрировать» is pressed.
      map.on('dragstart', () => {
        followRef.current = false;
        setFollowMode(false);
      });

      map.on('load', () => {
        if (cancelled) return;
        setState({ kind: 'ready' });
        onMapReady?.(map);
      });

      const onPosition = (p: PlayerPosition) => {
        const m = markerRef.current;
        if (m) {
          m.setLngLat([p.lon, p.lat]);
          if (p.heading !== null) m.setRotation(p.heading);
        }
        if (followRef.current) {
          map.easeTo({
            center: [p.lon, p.lat],
            bearing: p.heading ?? map.getBearing(),
            duration: 500,
          });
        }
      };
      unsubscribe = provider.subscribe(onPosition);
      provider.start();
    }

    void init();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      provider.stop();
      onMapReady?.(null);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [provider, onMapReady]);

  function recenter() {
    followRef.current = true;
    setFollowMode(true);
    const m = markerRef.current;
    const map = mapRef.current;
    if (m && map) {
      const ll = m.getLngLat();
      map.easeTo({ center: [ll.lng, ll.lat], duration: 500 });
    }
  }

  if (state.kind === 'unconfigured') {
    return (
      <div className="map-message">
        Карта не настроена. Сгенерируйте тайлы в AdminPanel.
      </div>
    );
  }
  if (state.kind === 'error') {
    return <div className="map-message">{state.message}</div>;
  }

  return (
    <div className="map-root">
      <div ref={containerRef} className="map-container" />
      {state.kind === 'ready' && (
        <>
          {!followMode && (
            <button className="map-btn map-btn-recenter" onClick={recenter} type="button">
              Центрировать
            </button>
          )}
          <div className="map-zoom-controls">
            <button
              className="map-btn"
              onClick={() => mapRef.current?.zoomIn()}
              type="button"
              aria-label="Приблизить"
            >
              +
            </button>
            <button
              className="map-btn"
              onClick={() => mapRef.current?.zoomOut()}
              type="button"
              aria-label="Отдалить"
            >
              −
            </button>
          </div>
        </>
      )}
    </div>
  );
}
