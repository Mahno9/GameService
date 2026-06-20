export type Bbox = [west: number, south: number, east: number, north: number];

export interface Settings {
  trigger_radius_m: number;
  sync_interval_s: number;
  debug_mode: boolean;
  gps_timeout_min: number;
  joystick_speed_mps: number;
  zoom_threshold: number;
  map_bbox: Bbox | null;
  ui_click_sound_url: { url: string; weight: number }[] | string | null;
  debug_start: { lat: number; lon: number } | null;
}

export interface Asset {
  id: string;
  url: string;
  kind: 'image' | 'audio' | 'gif';
  originalName: string;
  sizeBytes: number;
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
  config?: Record<string, unknown>;
  rewardImageAsset?: string | null;
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

export interface LeaderboardEntry {
  id: string;
  name: string;
  avatarEmoji: string;
  score: number;
  sortHint: number;
}

export interface CreateLeaderboardEntryBody {
  name: string;
  avatarEmoji: string;
  score: number;
}

export interface UpdateLeaderboardEntryBody {
  name?: string;
  avatarEmoji?: string;
  score?: number;
}

export interface Minigame {
  id: string;
  title: string;
  entryUrl: string;
  schemaUrl: string;
  defaultConfig?: Record<string, unknown>;
}

/** @deprecated Use Asset instead */
export type UploadedAsset = Asset;

export interface PoiConfig {
  minigameId: string;
  config: Record<string, unknown>;
}

export interface RealUser {
  id: string;
  name: string;
  avatarEmoji: string;
  totalScore: number;
  isDebug: boolean;
  completedAll: boolean;
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
  getMinigames: () => request<Minigame[]>('/api/minigames'),
  updateMinigameDefaults: (id: string, config: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/minigames/${id}/defaults`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  getPoiConfig: (id: string) => request<PoiConfig>(`/api/pois/${id}/config`),
  getAssets: () => request<Asset[]>('/api/admin/assets'),
  deleteAsset: (id: string) =>
    request<{ ok: true }>(`/api/admin/assets/${id}`, { method: 'DELETE' }),
  uploadAsset: async (file: File): Promise<Asset> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/admin/assets', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
    }
    const data = (await res.json()) as { accepted: Asset[]; rejected: string[] };
    const first = data.accepted[0];
    if (!first) {
      throw new ApiError(415, `Файл отклонён: ${data.rejected.join(', ') || 'неподдерживаемый формат'}`);
    }
    return first;
  },
  createPoi: (body: CreatePoiBody) =>
    request<Poi>('/api/admin/pois', { method: 'POST', body: JSON.stringify(body) }),
  updatePoi: (id: string, body: UpdatePoiBody) =>
    request<Poi>(`/api/admin/pois/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePoi: (id: string) =>
    request<{ ok: true }>(`/api/admin/pois/${id}`, { method: 'DELETE' }),
  getLeaderboard: () => request<LeaderboardEntry[]>('/api/admin/leaderboard'),
  createLeaderboardEntry: (body: CreateLeaderboardEntryBody) =>
    request<LeaderboardEntry>('/api/admin/leaderboard', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateLeaderboardEntry: (id: string, body: UpdateLeaderboardEntryBody) =>
    request<LeaderboardEntry>(`/api/admin/leaderboard/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteLeaderboardEntry: (id: string) =>
    request<{ ok: true }>(`/api/admin/leaderboard/${id}`, { method: 'DELETE' }),
  getRealUsers: () => request<RealUser[]>('/api/admin/leaderboard/real'),
  deleteRealUser: (userId: string) =>
    request<{ ok: true }>(`/api/admin/leaderboard/real/${userId}`, { method: 'DELETE' }),
};
