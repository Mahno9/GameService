import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Bbox } from './api';
import { MapView } from './map/MapView';
import { Joystick } from './map/Joystick';
import { JoystickProvider, type PositionProvider } from './map/positionProvider';

function bboxCenter([w, s, e, n]: Bbox): { lat: number; lon: number } {
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

interface Config {
  provider: PositionProvider;
  joystick: JoystickProvider | null;
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [settings, meta] = await Promise.all([api.getSettings(), api.getMapMeta()]);
        if (cancelled) return;
        // Swapping to GpsProvider here is trivial once the GPS flow lands; for
        // now we always drive movement from the on-screen joystick.
        const joystick = new JoystickProvider({
          initial: bboxCenter(meta.bbox),
          speedMps: settings.joystick_speed_mps,
        });
        const next: Config = { provider: joystick, joystick };
        configRef.current = next;
        setConfig(next);
      } catch (err) {
        if (cancelled) return;
        // Map not configured / settings unavailable — MapView shows its own
        // message once it also fails, but surface a fallback here too.
        setError(err instanceof Error ? err.message : 'Ошибка загрузки');
      }
    }
    void load();
    return () => {
      cancelled = true;
      configRef.current?.provider.stop();
    };
  }, []);

  const joystick = config?.joystick ?? null;
  const handleVector = useMemo(
    () => (dx: number, dy: number) => joystick?.setVector(dx, dy),
    [joystick],
  );

  if (error && !config) {
    return <div className="map-message">{error}</div>;
  }
  if (!config) {
    return <div className="map-message">Загрузка…</div>;
  }

  return (
    <div className="app">
      <MapView provider={config.provider} />
      {joystick && <Joystick onChange={handleVector} />}
    </div>
  );
}
