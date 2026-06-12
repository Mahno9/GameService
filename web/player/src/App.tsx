import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import maplibregl from 'maplibre-gl';
import { api, type Bbox, type Minigame, type Poi } from './api';
import { MapView } from './map/MapView';
import { Joystick } from './map/Joystick';
import { PoiMarkers } from './map/PoiMarkers';
import {
  GpsProvider,
  JoystickProvider,
  type PlayerPosition,
  type PositionProvider,
} from './map/positionProvider';
import { compassNeedsPermission, requestCompassPermission } from './map/heading';
import { localState } from './state/localState';
import { startSync, syncNow } from './state/sync';
import { RegistrationScreen } from './ui/RegistrationScreen';
import { Toast } from './ui/Toast';
import type { MinigameResult } from './game/minigameLoader';

function bboxCenter([w, s, e, n]: Bbox): { lat: number; lon: number } {
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedSettings {
  debug_mode: boolean;
  joystick_speed_mps: number;
  gps_timeout_min: number;
  trigger_radius_m: number;
  sync_interval_s: number;
}

interface BootData {
  settings: LoadedSettings;
  bboxCenter: { lat: number; lon: number };
  pois: Poi[];
  minigames: Minigame[];
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const state = useSyncExternalStore(localState.subscribe, localState.getSnapshot);

  // Raw loaded data from the server.
  const [boot, setBoot] = useState<BootData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [player, setPlayer] = useState<PlayerPosition | null>(null);

  // Active position provider (may be swapped at runtime).
  const [provider, setProvider] = useState<PositionProvider | null>(null);
  // Non-null only when provider is a JoystickProvider.
  const [joystickProvider, setJoystickProvider] = useState<JoystickProvider | null>(null);

  // GPS-loss toast visibility.
  const [showGpsToast, setShowGpsToast] = useState(false);

  // iOS compass permission gate: show "Начать игру" button only when needed.
  const [needsStartGesture, setNeedsStartGesture] = useState(false);

  const providerRef = useRef<PositionProvider | null>(null);

  const hasProfile = state.profile.userId !== '';

  // -------------------------------------------------------------------------
  // Boot: load settings + map meta + POIs + minigames once.
  // -------------------------------------------------------------------------
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
        setBoot({
          settings: {
            debug_mode: settings.debug_mode,
            joystick_speed_mps: settings.joystick_speed_mps,
            gps_timeout_min: settings.gps_timeout_min,
            trigger_radius_m: settings.trigger_radius_m,
            sync_interval_s: settings.sync_interval_s,
          },
          bboxCenter: bboxCenter(meta.bbox),
          pois,
          minigames,
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Ошибка загрузки');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // -------------------------------------------------------------------------
  // Provider initialisation: runs once when boot data arrives.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!boot) return;

    let initialProvider: PositionProvider;
    let joystick: JoystickProvider | null = null;

    if (boot.settings.debug_mode) {
      // Debug mode: always use the joystick.
      joystick = new JoystickProvider({
        initial: boot.bboxCenter,
        speedMps: boot.settings.joystick_speed_mps,
      });
      initialProvider = joystick;
    } else {
      // Real GPS mode.
      const gps = new GpsProvider({
        signalTimeoutMs: boot.settings.gps_timeout_min * 60_000,
        onSignalLoss: () => { setShowGpsToast(true); },
      });
      initialProvider = gps;
    }

    providerRef.current = initialProvider;
    setProvider(initialProvider);
    setJoystickProvider(joystick);

    // Decide whether we need the iOS "start" overlay.
    if (!boot.settings.debug_mode && compassNeedsPermission()) {
      setNeedsStartGesture(true);
    }

    return () => {
      providerRef.current?.stop();
      providerRef.current = null;
    };
  }, [boot]);

  // -------------------------------------------------------------------------
  // Subscribe to the active provider for distance / radius checks.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!provider) return;
    const unsub = provider.subscribe((p) => { setPlayer(p); });
    return unsub;
  }, [provider]);

  // -------------------------------------------------------------------------
  // Periodic + session-start sync.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!boot || !hasProfile) return;
    void syncNow();
    const stop = startSync(boot.settings.sync_interval_s);
    return stop;
  }, [boot, hasProfile]);

  // -------------------------------------------------------------------------
  // iOS compass permission: "Начать игру" tap handler.
  // -------------------------------------------------------------------------
  const handleStartGesture = useCallback(async () => {
    const granted = await requestCompassPermission();
    if (!granted) {
      // Permission denied — fall back to joystick immediately so the game
      // is still usable, and hide the overlay.
      if (boot) {
        switchToJoystick(boot);
      }
    }
    setNeedsStartGesture(false);
    // Provider.start() is called by MapView on mount; nothing else needed here.
  }, [boot]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // GPS-loss: swap provider to joystick.
  // -------------------------------------------------------------------------
  function switchToJoystick(bootData: BootData) {
    // Stop old provider.
    providerRef.current?.stop();

    const lastPos = player
      ? { lat: player.lat, lon: player.lon }
      : bootData.bboxCenter;

    const joystick = new JoystickProvider({
      initial: lastPos,
      speedMps: bootData.settings.joystick_speed_mps,
    });
    providerRef.current = joystick;
    setProvider(joystick);
    setJoystickProvider(joystick);
  }

  // -------------------------------------------------------------------------
  // Joystick onChange callback (stable ref via useMemo).
  // -------------------------------------------------------------------------
  const handleVector = useMemo(
    () => (dx: number, dy: number) => { joystickProvider?.setVector(dx, dy); },
    [joystickProvider],
  );

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------
  const minigameTitles = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const m of boot?.minigames ?? []) titles[m.id] = m.title;
    return titles;
  }, [boot]);

  const totalScore = useMemo(() => {
    let sum = 0;
    for (const r of Object.values(state.poiResults)) sum += r.bestScore;
    return sum;
  }, [state.poiResults]);

  function handleResult(poiId: string, result: MinigameResult) {
    localState.recordGameResult(poiId, result.score, result.won);
    void syncNow();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loadError && !boot) {
    return <div className="map-message">{loadError}</div>;
  }
  if (!boot || !provider) {
    return <div className="map-message">Загрузка…</div>;
  }
  if (!hasProfile) {
    return <RegistrationScreen onDone={() => undefined} />;
  }

  return (
    <div className="app">
      <MapView provider={provider} onMapReady={setMap} />

      {joystickProvider !== null && <Joystick onChange={handleVector} />}

      <div className="hud-chip">
        <span className="hud-avatar">{state.profile.avatarEmoji}</span>
        <span className="hud-name">{state.profile.name}</span>
        <span className="hud-score">{totalScore}</span>
      </div>

      {map && (
        <PoiMarkers
          map={map}
          pois={boot.pois}
          state={state}
          player={player}
          triggerRadiusM={boot.settings.trigger_radius_m}
          muted={state.prefs.muted}
          minigameTitles={minigameTitles}
          onResult={handleResult}
        />
      )}

      {/* GPS-loss toast */}
      {showGpsToast && (
        <Toast
          message="GPS не определяется. Включить виртуальный джойстик?"
          onDismiss={() => { setShowGpsToast(false); }}
          actions={[
            {
              label: 'Включить',
              onClick: () => {
                setShowGpsToast(false);
                switchToJoystick(boot);
              },
            },
          ]}
        />
      )}

      {/* iOS compass permission gate — shown only when DeviceOrientationEvent.requestPermission exists */}
      {needsStartGesture && (
        <div className="start-overlay">
          <button
            className="start-overlay-btn"
            type="button"
            onClick={() => { void handleStartGesture(); }}
          >
            Начать игру
          </button>
        </div>
      )}
    </div>
  );
}
