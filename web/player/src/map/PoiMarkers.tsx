import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Poi } from '../api';
import type { ClientState } from '../state/localState';
import type { PlayerPosition } from './positionProvider';
import { launchMinigame, type MinigameResult } from '../game/minigameLoader';
import { playClick } from '../audio/uiSound';

interface PoiMarkersProps {
  map: maplibregl.Map;
  pois: Poi[];
  state: ClientState;
  player: PlayerPosition | null;
  triggerRadiusM: number;
  muted: boolean;
  minigameTitles: Record<string, string>;
  /** Called after a completed/exited game so the parent records + syncs. */
  onResult: (poiId: string, result: MinigameResult) => void;
}

type PoiStatus = 'locked' | 'available' | 'completed';

const EARTH_RADIUS_M = 6371000;

function haversineM(a: PlayerPosition, lat: number, lon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - a.lat);
  const dLon = toRad(lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function isCompleted(state: ClientState, poiId: string): boolean {
  return poiId in state.poiResults;
}

function statusOf(state: ClientState, poi: Poi): PoiStatus {
  if (isCompleted(state, poi.id) && !poi.replayable) return 'completed';
  const unlocked = poi.blockerIds.every((b) => isCompleted(state, b));
  if (!unlocked) return 'locked';
  if (isCompleted(state, poi.id)) return 'completed';
  return 'available';
}

function statusLabel(status: PoiStatus): string {
  switch (status) {
    case 'locked':
      return 'Заблокирована';
    case 'completed':
      return 'Пройдена';
    case 'available':
      return 'Доступна';
  }
}

function createPoiElement(poi: Poi): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'poi-marker';
  const icon = document.createElement('div');
  icon.className = 'poi-marker-icon';
  const badge = document.createElement('div');
  badge.className = 'poi-marker-badge';
  const label = document.createElement('div');
  label.className = 'poi-marker-label';
  label.textContent = poi.name;
  el.appendChild(icon);
  el.appendChild(badge);
  el.appendChild(label);
  return el;
}

interface Sheet {
  poi: Poi;
  status: PoiStatus;
  inRadius: boolean;
}

export function PoiMarkers({
  map,
  pois,
  state,
  player,
  triggerRadiusM,
  muted,
  minigameTitles,
  onResult,
}: PoiMarkersProps) {
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [running, setRunning] = useState(false);

  // Latest values for the click handler closures (avoid stale captures).
  const latest = useRef({ pois, state, player, triggerRadiusM });
  latest.current = { pois, state, player, triggerRadiusM };

  function openSheetFor(poiId: string): void {
    playClick();
    const cur = latest.current;
    const poi = cur.pois.find((p) => p.id === poiId);
    if (!poi) return;
    const status = statusOf(cur.state, poi);
    const inRadius =
      cur.player !== null &&
      status !== 'locked' &&
      haversineM(cur.player, poi.lat, poi.lon) <= cur.triggerRadiusM;
    setSheet({ poi, status, inRadius });
  }

  // Create/remove markers when the POI list changes.
  useEffect(() => {
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const poi of pois) {
      seen.add(poi.id);
      if (!markers.has(poi.id)) {
        const element = createPoiElement(poi);
        element.addEventListener('click', (e) => {
          e.stopPropagation();
          openSheetFor(poi.id);
        });
        const marker = new maplibregl.Marker({ element, anchor: 'bottom' })
          .setLngLat([poi.lon, poi.lat])
          .addTo(map);
        markers.set(poi.id, marker);
      } else {
        markers.get(poi.id)?.setLngLat([poi.lon, poi.lat]);
      }
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [map, pois]);

  // Update marker visual state classes on state / position changes.
  useEffect(() => {
    const markers = markersRef.current;
    for (const poi of pois) {
      const marker = markers.get(poi.id);
      if (!marker) continue;
      const el = marker.getElement();
      const status = statusOf(state, poi);
      const completed = isCompleted(state, poi.id);
      const inRadius =
        player !== null &&
        status !== 'locked' &&
        haversineM(player, poi.lat, poi.lon) <= triggerRadiusM;

      el.classList.toggle('poi-locked', status === 'locked');
      el.classList.toggle(
        'poi-available',
        status === 'available' && !completed,
      );
      el.classList.toggle('poi-completed', completed);
      el.classList.toggle('poi-replayable', completed && poi.replayable);
      el.classList.toggle('poi-in-radius', inRadius);

      const badge = el.querySelector('.poi-marker-badge');
      if (badge) {
        if (status === 'locked') badge.textContent = '🔒';
        else if (completed && poi.replayable) badge.textContent = '↻';
        else if (completed) badge.textContent = '✓';
        else badge.textContent = '';
      }
    }
  }, [pois, state, player, triggerRadiusM]);

  // Remove all markers on unmount.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, []);

  function startGame(poi: Poi): void {
    playClick();
    setSheet(null);
    setRunning(true);
    void launchMinigame({
      poiId: poi.id,
      muted,
      onFinished: (result) => {
        setRunning(false);
        if (result) onResult(poi.id, result);
      },
    });
  }

  if (running || !sheet) return null;

  const { poi, status, inRadius } = sheet;
  const title = minigameTitles[poi.minigameId] ?? poi.name;

  return (
    <div className="bottom-sheet-backdrop" onClick={() => { playClick(); setSheet(null); }}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bottom-sheet-title">{poi.name}</div>
        {inRadius ? (
          <>
            <div className="bottom-sheet-game">{title}</div>
            <div className="bottom-sheet-question">Начать?</div>
            <div className="bottom-sheet-actions">
              <button
                type="button"
                className="sheet-btn sheet-btn-primary"
                onClick={() => startGame(poi)}
              >
                Начать
              </button>
              <button
                type="button"
                className="sheet-btn"
                onClick={() => { playClick(); setSheet(null); }}
              >
                Отмена
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bottom-sheet-game">{title}</div>
            <div className="bottom-sheet-status">
              Статус: {statusLabel(status)}
            </div>
            <div className="bottom-sheet-actions">
              <button
                type="button"
                className="sheet-btn"
                onClick={() => { playClick(); setSheet(null); }}
              >
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
