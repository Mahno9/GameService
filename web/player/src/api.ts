export type Bbox = [west: number, south: number, east: number, north: number];

export interface Settings {
  trigger_radius_m: number;
  sync_interval_s: number;
  debug_mode: boolean;
  gps_timeout_min: number;
  joystick_speed_mps: number;
  zoom_threshold: number;
  map_bbox: Bbox | null;
  ui_click_sound_url: string | null;
}

export interface MapMeta {
  bbox: Bbox;
  vectorZooms: number[];
  rasterZooms: number[];
  zoomThreshold: number;
}

export interface PoiReward {
  imageAsset: string | null;
  nameWin: string;
  nameLose: string;
  description: string;
}

export interface Poi {
  id: string;
  name: string;
  lat: number;
  lon: number;
  minigameId: string;
  blockerIds: string[];
  replayable: boolean;
  reward: PoiReward;
}

export interface PoiConfig {
  minigameId: string;
  config: Record<string, unknown>;
}

export interface Minigame {
  id: string;
  title: string;
  entryUrl: string;
  schemaUrl: string;
}

export interface SessionUser {
  id: string;
  name: string;
  avatarEmoji: string;
  isDebug: boolean;
}

export interface SessionResponse {
  user: SessionUser;
  // Server state payload is an opaque ClientState-shaped object (or null).
  state: ServerState | null;
}

/** Minimal shape the player relies on; the server round-trips the rest. */
export interface ServerState {
  updatedAt: number;
  [key: string]: unknown;
}

export interface LeaderboardRow {
  name: string;
  avatarEmoji: string;
  score: number;
  isPlayer: boolean;
  isReal: boolean;
}

export type SyncOutcome = 'accepted' | 'merged' | 'server-newer';

export interface SyncResponse {
  outcome: SyncOutcome;
  state: ServerState;
  serverTime: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSettings: () => request<Settings>('/api/settings'),
  getMapMeta: () => request<MapMeta>('/api/map/meta'),
  getMapStyle: () => request<unknown>('/api/map/style.json'),
  getPois: () => request<Poi[]>('/api/pois'),
  getPoiConfig: (id: string) => request<PoiConfig>(`/api/pois/${id}/config`),
  getMinigames: () => request<Minigame[]>('/api/minigames'),
  postSession: (body: { name: string; avatarEmoji: string }) =>
    request<SessionResponse>('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  postSync: (body: { userId: string; state: unknown }) =>
    request<SyncResponse>('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getLeaderboard: (userId: string) =>
    request<LeaderboardRow[]>(`/api/leaderboard?userId=${encodeURIComponent(userId)}`),
};
