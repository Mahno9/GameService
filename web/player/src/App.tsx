import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import maplibregl from 'maplibre-gl';
import { api, type Bbox, type Minigame, type Poi } from './api';
import { MapView } from './map/MapView';
import { Joystick } from './map/Joystick';
import { PoiMarkers } from './map/PoiMarkers';
import { JoystickProvider, type PlayerPosition, type PositionProvider } from './map/positionProvider';
import { localState } from './state/localState';
import { startSync, syncNow } from './state/sync';
import { RegistrationScreen } from './ui/RegistrationScreen';
import type { MinigameResult } from './game/minigameLoader';

function bboxCenter([w, s, e, n]: Bbox): { lat: number; lon: number } {
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

interface Config {
  provider: PositionProvider;
  joystick: JoystickProvider | null;
  triggerRadiusM: number;
  syncIntervalS: number;
  pois: Poi[];
  minigames: Minigame[];
}

export function App() {
  const state = useSyncExternalStore(localState.subscribe, localState.getSnapshot);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [player, setPlayer] = useState<PlayerPosition | null>(null);
  const configRef = useRef<Config | null>(null);

  const hasProfile = state.profile.userId !== '';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settings, meta, pois, minigames] = await Promise.all([
          api.getSettings(),
          api.getMapMeta(),
          api.getPois().catch(() => [] as Poi[]),
          api.getMinigames().catch(() => [] as Minigame[]),
        ]);
        if (cancelled) return;
        const joystick = new JoystickProvider({
          initial: bboxCenter(meta.bbox),
          speedMps: settings.joystick_speed_mps,
        });
        const next: Config = {
          provider: joystick,
          joystick,
          triggerRadiusM: settings.trigger_radius_m,
          syncIntervalS: settings.sync_interval_s,
          pois,
          minigames,
        };
        configRef.current = next;
        setConfig(next);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      }
    }
    void load();
    return () => {
      cancelled = true;
      configRef.current?.provider.stop();
    };
  }, []);

  // Subscribe to the position provider for distance / radius checks.
  useEffect(() => {
    if (!config) return;
    const unsubscribe = config.provider.subscribe((p) => setPlayer(p));
    return unsubscribe;
  }, [config]);

  // Periodic + session-start sync, once a profile and config exist.
  useEffect(() => {
    if (!config || !hasProfile) return;
    void syncNow();
    const stop = startSync(config.syncIntervalS);
    return stop;
  }, [config, hasProfile]);

  const joystick = config?.joystick ?? null;
  const handleVector = useMemo(
    () => (dx: number, dy: number) => joystick?.setVector(dx, dy),
    [joystick],
  );

  const minigameTitles = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const m of config?.minigames ?? []) titles[m.id] = m.title;
    return titles;
  }, [config]);

  const totalScore = useMemo(() => {
    let sum = 0;
    for (const r of Object.values(state.poiResults)) sum += r.bestScore;
    return sum;
  }, [state.poiResults]);

  function handleResult(poiId: string, result: MinigameResult) {
    localState.recordGameResult(poiId, result.score, result.won);
    void syncNow();
  }

  if (error && !config) {
    return <div className="map-message">{error}</div>;
  }
  if (!config) {
    return <div className="map-message">Загрузка…</div>;
  }

  if (!hasProfile) {
    return <RegistrationScreen onDone={() => undefined} />;
  }

  return (
    <div className="app">
      <MapView provider={config.provider} onMapReady={setMap} />
      {joystick && <Joystick onChange={handleVector} />}

      <div className="hud-chip">
        <span className="hud-avatar">{state.profile.avatarEmoji}</span>
        <span className="hud-name">{state.profile.name}</span>
        <span className="hud-score">{totalScore}</span>
      </div>

      {map && (
        <PoiMarkers
          map={map}
          pois={config.pois}
          state={state}
          player={player}
          triggerRadiusM={config.triggerRadiusM}
          muted={state.prefs.muted}
          minigameTitles={minigameTitles}
          onResult={handleResult}
        />
      )}
    </div>
  );
}
