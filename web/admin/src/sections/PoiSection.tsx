import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api, type Bbox, type Poi, type Settings } from '../api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

interface MinigameOption {
  id: string;
  label: string;
}

const MINIGAMES: MinigameOption[] = [
  { id: 'sliding-puzzle', label: 'Пятнашки' },
  { id: 'find-object', label: 'Найди предмет' },
  { id: 'runner', label: 'Раннер' },
  { id: 'arkanoid', label: 'Арканоид' },
];

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------

function bboxToPolygon([w, s, e, n]: Bbox): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    },
  };
}

/** Approximate circle as a GeoJSON polygon (32 points). */
function circlePolygon(lat: number, lon: number, radiusM: number): GeoJSON.Feature {
  const points = 32;
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (2 * Math.PI * i) / points;
    coords.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

function poisToCircles(pois: Poi[], radiusM: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois.map((p) => circlePolygon(p.lat, p.lon, radiusM)),
  };
}

// ---------------------------------------------------------------------------
// Inline add-POI form (shown on map after click in add mode)
// ---------------------------------------------------------------------------

interface AddFormProps {
  onSubmit: (name: string, minigameId: string, replayable: boolean) => void;
  onCancel: () => void;
}

function AddPoiForm({ onSubmit, onCancel }: AddFormProps) {
  const [name, setName] = useState('');
  const [minigameId, setMinigameId] = useState(MINIGAMES[0]!.id);
  const [replayable, setReplayable] = useState(false);

  return (
    <div className='poi-add-form'>
      <div className='poi-add-form-row'>
        <input
          placeholder='Название'
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className='poi-add-form-row'>
        <select value={minigameId} onChange={(e) => setMinigameId(e.target.value)}>
          {MINIGAMES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className='poi-add-form-row poi-add-form-check'>
        <label>
          <input
            type='checkbox'
            checked={replayable}
            onChange={(e) => setReplayable(e.target.checked)}
          />
          Повторяемая
        </label>
      </div>
      <div className='poi-add-form-row poi-add-form-actions'>
        <button
          onClick={() => {
            if (name.trim()) onSubmit(name.trim(), minigameId, replayable);
          }}
          disabled={!name.trim()}
        >
          Добавить
        </button>
        <button onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-panel for editing an existing POI
// ---------------------------------------------------------------------------

interface EditPanelProps {
  poi: Poi;
  allPois: Poi[];
  onSave: (patch: Partial<Poi> & { rewardNameWin?: string; rewardNameLose?: string; rewardDescription?: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}

function EditPoiPanel({ poi, allPois, onSave, onDelete, onClose }: EditPanelProps) {
  const [name, setName] = useState(poi.name);
  const [minigameId, setMinigameId] = useState(poi.minigameId);
  const [replayable, setReplayable] = useState(poi.replayable);
  const [blockerIds, setBlockerIds] = useState<string[]>(poi.blockerIds);
  const [rewardNameWin, setRewardNameWin] = useState(poi.reward.nameWin);
  const [rewardNameLose, setRewardNameLose] = useState(poi.reward.nameLose);
  const [rewardDescription, setRewardDescription] = useState(poi.reward.description);

  // Keep fields in sync if a different POI is selected
  useEffect(() => {
    setName(poi.name);
    setMinigameId(poi.minigameId);
    setReplayable(poi.replayable);
    setBlockerIds(poi.blockerIds);
    setRewardNameWin(poi.reward.nameWin);
    setRewardNameLose(poi.reward.nameLose);
    setRewardDescription(poi.reward.description);
  }, [poi]);

  function toggleBlocker(id: string) {
    setBlockerIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );
  }

  function handleSave() {
    onSave({ name, minigameId, replayable, blockerIds, rewardNameWin, rewardNameLose, rewardDescription });
  }

  function handleDelete() {
    if (window.confirm(`Удалить POI «${poi.name}»?`)) {
      onDelete();
    }
  }

  const others = allPois.filter((p) => p.id !== poi.id);

  return (
    <div className='tile-panel poi-edit-panel'>
      <div className='poi-panel-header'>
        <span className='tile-panel-title'>POI: {poi.name}</span>
        <button className='poi-close-btn' onClick={onClose} title='Закрыть'>
          ✕
        </button>
      </div>

      <label className='poi-field-label'>Название</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />

      <label className='poi-field-label'>Мини-игра</label>
      <select
        className='poi-select'
        value={minigameId}
        onChange={(e) => setMinigameId(e.target.value)}
      >
        {MINIGAMES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      <label className='poi-field-label poi-check-label'>
        <input
          type='checkbox'
          checked={replayable}
          onChange={(e) => setReplayable(e.target.checked)}
        />
        Повторяемая
      </label>

      {others.length > 0 && (
        <>
          <label className='poi-field-label'>Блокирующие POI</label>
          <div className='poi-blockers'>
            {others.map((p) => (
              <label key={p.id} className='poi-blocker-row'>
                <input
                  type='checkbox'
                  checked={blockerIds.includes(p.id)}
                  onChange={() => toggleBlocker(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
        </>
      )}

      <label className='poi-field-label'>Награда — название при победе</label>
      <input value={rewardNameWin} onChange={(e) => setRewardNameWin(e.target.value)} />

      <label className='poi-field-label'>Награда — название при поражении</label>
      <input value={rewardNameLose} onChange={(e) => setRewardNameLose(e.target.value)} />

      <label className='poi-field-label'>Описание награды</label>
      <input value={rewardDescription} onChange={(e) => setRewardDescription(e.target.value)} />

      <div className='poi-panel-actions'>
        <button onClick={handleSave} disabled={!name.trim()}>
          Сохранить
        </button>
        <button className='poi-delete-btn' onClick={handleDelete}>
          Удалить POI
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

/** Pending placement: lngLat chosen by map click, waiting for form submit. */
interface PendingPlacement {
  lng: number;
  lat: number;
}

export function PoiSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [pending, setPending] = useState<PendingPlacement | null>(null);
  const [triggerRadius, setTriggerRadius] = useState<number>(50);
  const [radiusDraft, setRadiusDraft] = useState<string>('50');

  // Keep a stable ref to addMode so the map click handler (set up once) can read it.
  const addModeRef = useRef(false);
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Map from poi id → maplibregl.Marker
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // ---------------------------------------------------------------------------
  // Bootstrap: load settings + POIs
  // ---------------------------------------------------------------------------
  useEffect(() => {
    Promise.all([api.getSettings(), api.getPois()]).then(([s, ps]) => {
      setSettings(s);
      setPois(ps);
      setTriggerRadius(s.trigger_radius_m);
      setRadiusDraft(String(s.trigger_radius_m));
    }).catch(() => undefined);
  }, []);

  // ---------------------------------------------------------------------------
  // Map init (once)
  // ---------------------------------------------------------------------------
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
      // bbox outline source/layers
      map.addSource('bbox', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'bbox-fill', type: 'fill', source: 'bbox', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'bbox-line', type: 'line', source: 'bbox', paint: { 'line-color': '#2563eb', 'line-width': 2 } });

      // trigger-radius circles source/layers
      map.addSource('radii', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'radii-fill', type: 'fill', source: 'radii', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'radii-line', type: 'line', source: 'radii', paint: { 'line-color': '#d97706', 'line-width': 1 } });

      // Read stored settings/pois from closure-captured refs instead of state
      // to avoid stale closures — we'll do it via a custom event.
      map.fire('admin:ready');
    });

    map.on('click', (e) => {
      if (!addModeRef.current) return;
      setPending({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fit bbox when settings arrive
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !settings?.map_bbox) return;

    const [w, s, e, n] = settings.map_bbox;

    function applyBbox() {
      if (!map) return;
      map.fitBounds([w, s, e, n], { padding: 40, duration: 0 });
      (map.getSource('bbox') as maplibregl.GeoJSONSource | undefined)?.setData(
        bboxToPolygon([w, s, e, n]),
      );
    }

    if (map.isStyleLoaded()) {
      applyBbox();
    } else {
      map.once('load', applyBbox);
    }
  }, [settings?.map_bbox]);

  // ---------------------------------------------------------------------------
  // Redraw trigger-radius circles when pois or radius change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function redraw() {
      if (!map) return;
      (map.getSource('radii') as maplibregl.GeoJSONSource | undefined)?.setData(
        poisToCircles(pois, triggerRadius),
      );
    }

    if (map.isStyleLoaded()) {
      redraw();
    } else {
      map.once('load', redraw);
    }
  }, [pois, triggerRadius]);

  // ---------------------------------------------------------------------------
  // Sync POI markers
  // ---------------------------------------------------------------------------
  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = markersRef.current;
    const incoming = new Set(pois.map((p) => p.id));

    // Remove stale markers
    for (const [id, marker] of existing) {
      if (!incoming.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }

    // Add / update markers
    for (const poi of pois) {
      const current = existing.get(poi.id);
      if (current) {
        // Update position in case it changed server-side (e.g. after load)
        current.setLngLat([poi.lon, poi.lat]);
        // Update label text
        const el = current.getElement();
        const label = el.querySelector('.poi-marker-label');
        if (label) label.textContent = poi.name;
      } else {
        // Create DOM element
        const el = document.createElement('div');
        el.className = 'poi-marker';
        const dot = document.createElement('div');
        dot.className = 'poi-marker-dot';
        const label = document.createElement('div');
        label.className = 'poi-marker-label';
        label.textContent = poi.name;
        el.appendChild(dot);
        el.appendChild(label);

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([poi.lon, poi.lat])
          .addTo(map);

        // Click → select
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedPoiId(poi.id);
          setAddMode(false);
          addModeRef.current = false;
          setPending(null);
        });

        // Drag end → PUT lat/lon
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          api
            .updatePoi(poi.id, { lat: lngLat.lat, lon: lngLat.lng })
            .then((updated) => {
              setPois((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            })
            .catch(() => undefined);
        });

        existing.set(poi.id, marker);
      }
    }
  }, [pois]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      syncMarkers();
    } else {
      map.once('load', syncMarkers);
    }
  }, [syncMarkers]);

  // ---------------------------------------------------------------------------
  // Pending placement marker
  // ---------------------------------------------------------------------------
  useEffect(() => {
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = null;

    const map = mapRef.current;
    if (!map || !pending) return;

    const el = document.createElement('div');
    el.className = 'poi-marker poi-marker--pending';
    const dot = document.createElement('div');
    dot.className = 'poi-marker-dot';
    el.appendChild(dot);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([pending.lng, pending.lat])
      .addTo(map);
    pendingMarkerRef.current = marker;

    return () => {
      marker.remove();
      pendingMarkerRef.current = null;
    };
  }, [pending]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const selectedPoi = pois.find((p) => p.id === selectedPoiId) ?? null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  function toggleAddMode() {
    const next = !addMode;
    addModeRef.current = next;
    setAddMode(next);
    if (!next) setPending(null);
    setSelectedPoiId(null);
  }

  async function handleAddSubmit(name: string, minigameId: string, replayable: boolean) {
    if (!pending) return;
    try {
      const created = await api.createPoi({
        name,
        lat: pending.lat,
        lon: pending.lng,
        minigameId,
        replayable,
      });
      setPois((prev) => [...prev, created]);
      setPending(null);
      addModeRef.current = false;
      setAddMode(false);
      setSelectedPoiId(created.id);
    } catch {
      // ignore
    }
  }

  async function handleSave(
    id: string,
    patch: { name?: string; minigameId?: string; replayable?: boolean; blockerIds?: string[]; rewardNameWin?: string; rewardNameLose?: string; rewardDescription?: string },
  ) {
    try {
      const updated = await api.updatePoi(id, patch);
      setPois((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deletePoi(id);
      setPois((prev) => prev.filter((p) => p.id !== id));
      setSelectedPoiId(null);
    } catch {
      // ignore
    }
  }

  async function handleRadiusSave() {
    const val = parseInt(radiusDraft, 10);
    if (isNaN(val) || val <= 0) return;
    try {
      const updated = await api.updateSettings({ trigger_radius_m: val });
      setTriggerRadius(updated.trigger_radius_m);
      setRadiusDraft(String(updated.trigger_radius_m));
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className='map-section'>
      <div className='map-toolbar'>
        <button
          className={addMode ? 'active' : ''}
          onClick={toggleAddMode}
        >
          {addMode ? (pending ? 'Кликните карту…' : 'Кликните карту…') : 'Добавить POI'}
        </button>
        <span className='bbox-label'>Радиус триггера (м):</span>
        <input
          className='poi-radius-input'
          type='number'
          min={1}
          value={radiusDraft}
          onChange={(e) => setRadiusDraft(e.target.value)}
          onBlur={() => { void handleRadiusSave(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleRadiusSave(); }}
          style={{ width: 80 }}
        />
      </div>

      <div className='map-section-body'>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div ref={containerRef} className='map-container' />

          {/* Inline add-form floated over the map near pending marker */}
          {pending && (
            <div className='poi-add-form-overlay'>
              <AddPoiForm
                onSubmit={(name, minigameId, replayable) => {
                  void handleAddSubmit(name, minigameId, replayable);
                }}
                onCancel={() => {
                  setPending(null);
                }}
              />
            </div>
          )}
        </div>

        {selectedPoi && (
          <EditPoiPanel
            poi={selectedPoi}
            allPois={pois}
            onSave={(patch) => { void handleSave(selectedPoi.id, patch); }}
            onDelete={() => { void handleDelete(selectedPoi.id); }}
            onClose={() => setSelectedPoiId(null)}
          />
        )}
      </div>
    </div>
  );
}
