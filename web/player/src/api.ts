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

export interface MapMeta {
  bbox: Bbox;
  vectorZooms: number[];
  rasterZooms: number[];
  zoomThreshold: number;
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
};
