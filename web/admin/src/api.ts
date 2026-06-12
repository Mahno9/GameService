export type Bbox = [west: number, south: number, east: number, north: number];

export interface Settings {
  trigger_radius_m: number;
  sync_interval_s: number;
  debug_mode: boolean;
  gps_timeout_min: number;
  joystick_speed_mps: number;
  zoom_threshold: number;
  map_bbox: Bbox | null;
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
  replayable: boolean;
  blockerIds: string[];
  reward: PoiReward;
}

export interface CreatePoiBody {
  name: string;
  lat: number;
  lon: number;
  minigameId: string;
  replayable?: boolean;
  blockerIds?: string[];
  rewardNameWin?: string;
  rewardNameLose?: string;
  rewardDescription?: string;
}

export interface UpdatePoiBody {
  name?: string;
  lat?: number;
  lon?: number;
  minigameId?: string;
  replayable?: boolean;
  blockerIds?: string[];
  rewardNameWin?: string;
  rewardNameLose?: string;
  rewardDescription?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const merged: RequestInit = { credentials: 'same-origin', ...init };
  if (init?.body) {
    merged.headers = { 'Content-Type': 'application/json', ...init.headers };
  }
  const res = await fetch(url, merged);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TileJob {
  id: string;
  kind: string;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  status: string;
  completedZooms: number[];
  tilesDone: number;
  tilesTotal: number;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  login: (login: string, password: string) =>
    request<{ ok: true }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),
  me: () => request<{ ok: true }>('/api/admin/me'),
  getSettings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  getTileJobs: () => request<TileJob[]>('/api/admin/tile-jobs'),
  getPois: () => request<Poi[]>('/api/pois'),
  createPoi: (body: CreatePoiBody) =>
    request<Poi>('/api/admin/pois', { method: 'POST', body: JSON.stringify(body) }),
  updatePoi: (id: string, body: UpdatePoiBody) =>
    request<Poi>(`/api/admin/pois/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePoi: (id: string) =>
    request<{ ok: true }>(`/api/admin/pois/${id}`, { method: 'DELETE' }),
};
