import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, ApiError, type Bbox } from '../api';
import type { PlayerPosition, PositionProvider } from './positionProvider';
import { playClick } from '../audio/uiSound';
import { useI18n } from '../i18n/index';
import './map.css';

interface MapViewProps {
  provider: PositionProvider;
  /** Called with the map once 'load' fires, and with null on teardown. */
  onMapReady?: (map: maplibregl.Map | null) => void;
  /** When true, map stays north-up; otherwise it rotates to follow heading. */
  northUp: boolean;
  onToggleNorthUp: () => void;
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

export function MapView({ provider, onMapReady, northUp, onToggleNorthUp }: MapViewProps) {
  const t = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const followRef = useRef(true);
  const northUpRef = useRef(northUp);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [followMode, setFollowMode] = useState(true);

  // Keep the ref the camera loop reads in sync with the prop, and snap the map
  // to north when the mode turns on.
  useEffect(() => {
    northUpRef.current = northUp;
    if (northUp) mapRef.current?.easeTo({ bearing: 0, duration: 500 });
  }, [northUp]);

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
          setState({ kind: 'error', message: err instanceof Error ? err.message : t('map.error') });
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
        pitchWithRotate: false,
        maxBounds: padBounds(meta.bbox),
        attributionControl: false,
      });
      mapRef.current = map;

      // Bearing follows movement heading by default, but the user can rotate by
      // hand: right-mouse drag on desktop, two-finger twist on touch. Keep pitch
      // fixed (no tilt-on-rotate, no two-finger pitch) so gestures only rotate/zoom.
      map.touchPitch.disable();

      const marker = new maplibregl.Marker({
        element: createMarkerElement(),
        rotationAlignment: 'map',
      })
        .setLngLat(bboxCenter(meta.bbox))
        .addTo(map);
      markerRef.current = marker;

      // User panning or rotating breaks follow mode until «центрировать» is pressed.
      map.on('dragstart', () => {
        followRef.current = false;
        setFollowMode(false);
      });
      map.on('rotatestart', (e) => {
        if (!e.originalEvent) return; // ignore programmatic easeTo, only user gestures
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
            bearing: northUpRef.current ? 0 : (p.heading ?? map.getBearing()),
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
  }, [provider, onMapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  function recenter() {
    playClick();
    followRef.current = true;
    setFollowMode(true);
    const m = markerRef.current;
    const map = mapRef.current;
    if (m && map) {
      const ll = m.getLngLat();
      map.easeTo({
        center: [ll.lng, ll.lat],
        bearing: northUpRef.current ? 0 : map.getBearing(),
        duration: 500,
      });
    }
  }

  if (state.kind === 'unconfigured') {
    return (
      <div className="map-message">
        {t('map.unconfigured')}
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
        <div className="map-zoom-controls">
          {!followMode && (
            <button
              className="map-btn"
              onClick={recenter}
              type="button"
              title={t('map.center')}
              aria-label={t('map.center')}
            >
              🎯
            </button>
          )}
          <button
            className={`map-btn${northUp ? ' active' : ''}`}
            onClick={() => { playClick(); onToggleNorthUp(); }}
            type="button"
            title={t('map.northUp')}
            aria-label={t('map.northUp')}
          >
            🧭
          </button>
          <button
            className="map-btn"
            onClick={() => { playClick(); mapRef.current?.zoomIn(); }}
            type="button"
            aria-label={t('map.zoomIn')}
          >
            +
          </button>
          <button
            className="map-btn"
            onClick={() => { playClick(); mapRef.current?.zoomOut(); }}
            type="button"
            aria-label={t('map.zoomOut')}
          >
            −
          </button>
        </div>
      )}
    </div>
  );
}
