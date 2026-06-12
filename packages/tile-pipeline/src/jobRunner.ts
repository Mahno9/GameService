import { overpassToLayers } from './layers.js';
import { buildIndexes, encodeTile } from './mvt.js';
import { tilesForBbox, countTiles, type Bbox, type TileCoord } from './tileMath.js';

export type JobStage = 'download' | 'parse' | 'generate+upload';

export interface RunVectorJobOptions {
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  /** Override global fetch for testing. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ProgressInfo {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
}

export interface RunVectorJobCallbacks {
  onStage: (stage: JobStage) => void;
  onProgress: (info: ProgressInfo) => void;
  onError: (err: Error) => void;
}

export interface JobDto {
  id: string;
  kind: string;
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  status: string;
  completedZooms: number[];
  tilesDone: number;
  tilesTotal: number;
}

const BATCH_SIZE = 50;

export async function runVectorJob(
  opts: RunVectorJobOptions,
  callbacks: RunVectorJobCallbacks,
): Promise<void> {
  const { bbox, minZoom, maxZoom, signal } = opts;
  const fetchFn = opts.fetchImpl ?? fetch;
  const { onStage, onProgress, onError } = callbacks;

  const zooms = Array.from({ length: maxZoom - minZoom + 1 }, (_, i) => minZoom + i);
  const tilesTotal = countTiles(bbox, zooms);

  let jobId: string | null = null;

  async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(url, { credentials: 'same-origin', ...init });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(body.error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  async function patchJob(patch: Partial<Pick<JobDto, 'status' | 'completedZooms' | 'tilesDone' | 'tilesTotal'>>): Promise<void> {
    if (!jobId) return;
    await apiFetch(`/api/admin/tile-jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  try {
    // ── Stage 1: Download Overpass data ──────────────────────────────────
    onStage('download');
    if (signal?.aborted) throw signal.reason as Error;

    const overpassJson = await apiFetch<unknown>('/api/admin/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox }),
      ...(signal ? { signal } : {}),
    });

    // ── Stage 2: Parse layers ────────────────────────────────────────────
    onStage('parse');
    if (signal?.aborted) throw signal.reason as Error;
    const layers = overpassToLayers(overpassJson);

    // ── Create job ───────────────────────────────────────────────────────
    const job = await apiFetch<JobDto>('/api/admin/tile-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'vector', bbox, minZoom, maxZoom, tilesTotal }),
    });
    jobId = job.id;

    await patchJob({ status: 'running' });

    // ── Stage 3: Generate + upload ───────────────────────────────────────
    onStage('generate+upload');

    // Build geojson-vt indexes once for the full zoom range
    const indexes = buildIndexes(layers, maxZoom);

    let tilesDone = 0;
    const completedZooms: number[] = [];

    for (const z of zooms) {
      if (signal?.aborted) throw signal.reason as Error;

      const coords: TileCoord[] = tilesForBbox(bbox, z);
      let batchFiles: { name: string; data: Uint8Array }[] = [];

      async function flushBatch(): Promise<void> {
        if (batchFiles.length === 0) return;
        const form = new FormData();
        for (const f of batchFiles) {
          form.append('tiles', new File([f.data.buffer as ArrayBuffer], f.name, { type: 'application/octet-stream' }));
        }
        await apiFetch<unknown>('/api/admin/tiles/batch', { method: 'POST', body: form });
        tilesDone += batchFiles.length;
        batchFiles = [];
        await patchJob({ tilesDone });
        onProgress({ tilesDone, tilesTotal, zoom: z });
      }

      for (const coord of coords) {
        if (signal?.aborted) {
          await flushBatch().catch(() => undefined);
          throw signal.reason as Error;
        }

        const data = encodeTile(indexes, coord);
        if (data) {
          batchFiles.push({ name: `vector/${coord.z}/${coord.x}/${coord.y}.mvt`, data });
        } else {
          // Empty tile still counts toward progress
          tilesDone += 1;
        }

        if (batchFiles.length >= BATCH_SIZE) {
          await flushBatch();
        }
      }

      // Flush remaining tiles for this zoom
      await flushBatch();

      // Update progress for empty tiles not flushed via batch
      onProgress({ tilesDone, tilesTotal, zoom: z });

      completedZooms.push(z);
      await patchJob({ completedZooms: [...completedZooms] });
    }

    await patchJob({ status: 'done' });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const isAbort =
      (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
      (signal?.aborted === true);

    if (jobId) {
      await patchJob({ status: isAbort ? 'paused' : 'failed' }).catch(() => undefined);
    }

    if (!isAbort) {
      onError(error);
    }
    // Re-throw so caller can detect abort vs normal flow
    throw error;
  }
}
