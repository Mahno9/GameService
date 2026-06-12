/**
 * Programmatic MVP end-to-end check (no browser):
 * login → overpass → MVT generation (tile-pipeline) → batch upload →
 * style.json → tile fetch → POI create/list → session → sync.
 * Run: npx tsx scripts/e2e-mvp.ts (server must be running on BASE)
 */
import {
  overpassToLayers,
  generateMvtTiles,
  type Bbox,
} from '../packages/tile-pipeline/src/index.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:8123';
const BBOX: Bbox = [37.617, 55.755, 37.623, 55.758];

let cookie = '';

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  return res;
}

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

// 1. login
const login = await api('/api/admin/login', {
  method: 'POST',
  body: JSON.stringify({ login: 'admin', password: 'admin' }),
});
cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
check('admin login', login.ok && cookie.length > 0);

// 2. save bbox
const settings = await api('/api/admin/settings', {
  method: 'PUT',
  body: JSON.stringify({ map_bbox: BBOX }),
});
check('save map_bbox', settings.ok);

// 3. overpass (disk-cached from earlier runs or live)
const op = await api('/api/admin/overpass', {
  method: 'POST',
  body: JSON.stringify({ bbox: BBOX }),
});
check('overpass proxy', op.ok, `cache=${op.headers.get('x-osm-cache')}`);
const osm = await op.json();

// 4. generate MVT tiles
const layers = overpassToLayers(osm);
const tiles = [...generateMvtTiles(layers, BBOX, { minZoom: 14, maxZoom: 17 })];
check('MVT generation', tiles.length > 0, `${tiles.length} non-empty tiles`);

// 5. upload in batches
let uploaded = 0;
for (let i = 0; i < tiles.length; i += 50) {
  const form = new FormData();
  for (const t of tiles.slice(i, i + 50)) {
    form.append(
      'tiles',
      new File([t.data.buffer as ArrayBuffer], `vector/${t.z}/${t.x}/${t.y}.mvt`),
    );
  }
  const res = await api('/api/admin/tiles/batch', { method: 'POST', body: form });
  if (res.ok) uploaded += ((await res.json()) as { saved: number }).saved;
}
check('tile batch upload', uploaded === tiles.length, `${uploaded}/${tiles.length}`);

// 6. style.json + meta
const style = await api('/api/map/style.json');
const styleJson = (await style.json()) as { version: number; layers: { type: string }[] };
check(
  'style.json',
  style.ok && styleJson.version === 8 && styleJson.layers.some((l) => l.type === 'fill-extrusion'),
);

// 7. fetch one uploaded tile as static
const t0 = tiles[0]!;
const tileRes = await api(`/tiles/vector/${t0.z}/${t0.x}/${t0.y}.mvt`);
check(
  'tile static fetch',
  tileRes.ok &&
    /protobuf|vector-tile/.test(tileRes.headers.get('content-type') ?? '') &&
    (tileRes.headers.get('cache-control') ?? '').includes('max-age=31536000'),
  `cache-control=${tileRes.headers.get('cache-control')}`,
);

// 8. POI create + list + config
const poiRes = await api('/api/admin/pois', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Тестовая точка',
    lat: (BBOX[1] + BBOX[3]) / 2,
    lon: (BBOX[0] + BBOX[2]) / 2,
    minigameId: 'sliding-puzzle',
    config: { gridSize: 3, rounds: [] },
  }),
});
const poi = (await poiRes.json()) as { id: string };
check('POI create', poiRes.ok && !!poi.id);
const poisList = (await (await api('/api/pois')).json()) as unknown[];
check('POI public list', poisList.length === 1);
const poiCfg = (await (await api(`/api/pois/${poi.id}/config`)).json()) as {
  config: { gridSize: number };
};
check('POI lazy config', poiCfg.config.gridSize === 3);

// 9. minigames listing
const games = (await (await api('/api/minigames')).json()) as { id: string }[];
check('minigames listing', games.some((g) => g.id === 'sliding-puzzle'));

// 10. session + sync round-trip
const sess = (await (
  await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ name: 'E2E', avatarEmoji: '🤖' }),
  })
).json()) as { user: { id: string } };
const state = {
  version: 1,
  updatedAt: Date.now(),
  profile: { userId: sess.user.id, name: 'E2E', avatarEmoji: '🤖' },
  poiResults: {
    [poi.id]: {
      bestScore: 42,
      won: true,
      attempts: 1,
      firstCompletedAt: Date.now(),
      rewardGranted: false,
    },
  },
  prefs: { lang: 'ru', muted: false },
};
const sync = (await (
  await api('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ userId: sess.user.id, state }),
  })
).json()) as { outcome: string };
check('sync accepted', sync.outcome === 'accepted');
const restored = (await (await api(`/api/state/${sess.user.id}`)).json()) as {
  state: { poiResults: Record<string, { bestScore: number }> };
};
check('state restore', restored.state.poiResults[poi.id]?.bestScore === 42);

console.log('\nE2E MVP check finished.');
