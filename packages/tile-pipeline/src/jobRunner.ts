import { overpassToLayers, type LayeredGeojson } from './layers.js';
import { buildIndexes, encodeTile } from './mvt.js';
import { renderTilesWithPool } from './raster/workerPool.js';
import { tilesForBbox, countTiles, type Bbox, type TileCoord } from './tileMath.js';

export type JobStage = 'download' | 'parse' | 'generate+upload';

export interface ResumeInfo {
  jobId: string;
  completedZooms: number[];
}

export interface RunVectorJobOptions {
  bbox: Bbox;
  minZoom: number;
  maxZoom: number;
  /** Override global fetch for testing. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** When present: resume an existing paused/failed job instead of creating a new one. */
  resume?: ResumeInfo;
}

export interface ProgressInfo {
  tilesDone: number;
  tilesTotal: number;
  zoom: number;
  /** Rolling estimated seconds remaining. Present after ≥2 batches have been uploaded. */
  etaSeconds?: number;
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
const RASTER_BATCH_SIZE = 25;

/** Encoded raster tile ready for upload. */
export interface EncodedTile {
  name: string;
  data: Uint8Array;
}

/** Override for encoding a single raster tile (keeps unit tests DOM-free). */
export type EncodeTileFn = (
  layers: LayeredGeojson,
  coord: TileCoord,
  size: number,
) => Promise<EncodedTile | null>;

export interface RunRasterJobOptions {
  bbox: Bbox;
  minZoom?: number;
  maxZoom?: number;
  /** Output tile size in px (default 512). */
  size?: number;
  /** Override global fetch for testing. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Override the per-tile encoder. Default uses the Web Worker pool. */
  encodeTile?: EncodeTileFn;
  /** When present: resume an existing paused/failed job instead of creating a new one. */
  resume?: ResumeInfo;
}

/** Rolling ETA tracker: tiles uploaded since stage start / elapsed seconds. */
function makeEtaTracker(tilesTotal: number) {
  const stageStart = Date.now();
  let batchCount = 0;
  let tilesUploadedSinceStart = 0;

  return function update(newlyUploaded: number): number | undefined {
    tilesUploadedSinceStart += newlyUploaded;
    batchCount += 1;
    if (batchCount < 2) return undefined;
    // Use at least 1ms to avoid division by zero in fast/mocked environments.
    const elapsedMs = Math.max(1, Date.now() - stageStart);
    if (tilesUploadedSinceStart <= 0) return undefined;
    const ratePerMs = tilesUploadedSinceStart / elapsedMs;
    const remaining = tilesTotal - tilesUploadedSinceStart;
    if (remaining <= 0) return 0;
    return Math.round(remaining / ratePerMs / 1000);
  };
}

export async function runVectorJob(
  opts: RunVectorJobOptions,
  callbacks: RunVectorJobCallbacks,
): Promise<void> {
  const { bbox, minZoom, maxZoom, signal } = opts;
  const fetchFn = opts.fetchImpl ?? fetch;
  const { onStage, onProgress, onError } = callbacks;

  const allZooms = Array.from({ length: maxZoom - minZoom + 1 }, (_, i) => minZoom + i);
  const tilesTotal = countTiles(bbox, allZooms);

  // Resume support
  const resumeCompletedZooms = opts.resume?.completedZooms ?? [];
  const skippedTiles = resumeCompletedZooms.length > 0
    ? countTiles(bbox, resumeCompletedZooms)
    : 0;

  let jobId: string | null = opts.resume?.jobId ?? null;

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

    // ── Create or resume job ─────────────────────────────────────────────
    if (!opts.resume) {
      const job = await apiFetch<JobDto>('/api/admin/tile-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'vector', bbox, minZoom, maxZoom, tilesTotal }),
      });
      jobId = job.id;
    }

    await patchJob({ status: 'running' });

    // ── Stage 3: Generate + upload ───────────────────────────────────────
    onStage('generate+upload');

    // Build geojson-vt indexes once for the full zoom range
    const indexes = buildIndexes(layers, maxZoom);

    let tilesDone = skippedTiles;
    const completedZooms: number[] = [...resumeCompletedZooms];

    const resumeSet = new Set(resumeCompletedZooms);
    const zooms = allZooms.filter((z) => !resumeSet.has(z));

    const updateEta = makeEtaTracker(tilesTotal - skippedTiles);

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
        const etaSeconds = updateEta(batchFiles.length);
        batchFiles = [];
        await patchJob({ tilesDone });
        const progressInfo: ProgressInfo = { tilesDone, tilesTotal, zoom: z };
        if (etaSeconds !== undefined) {
          progressInfo.etaSeconds = etaSeconds;
        }
        onProgress(progressInfo);
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

export async function runRasterJob(
  opts: RunRasterJobOptions,
  callbacks: RunVectorJobCallbacks,
): Promise<void> {
  const { bbox, signal } = opts;
  const minZoom = opts.minZoom ?? 11;
  const maxZoom = opts.maxZoom ?? 13;
  const size = opts.size ?? 512;
  const fetchFn = opts.fetchImpl ?? fetch;
  const { onStage, onProgress, onError } = callbacks;

  const allZooms = Array.from({ length: maxZoom - minZoom + 1 }, (_, i) => minZoom + i);
  const tilesTotal = countTiles(bbox, allZooms);

  // Resume support
  const resumeCompletedZooms = opts.resume?.completedZooms ?? [];
  const skippedTiles = resumeCompletedZooms.length > 0
    ? countTiles(bbox, resumeCompletedZooms)
    : 0;

  let jobId: string | null = opts.resume?.jobId ?? null;

  async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(url, { credentials: 'same-origin', ...init });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw new Error(body.error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  async function patchJob(
    patch: Partial<Pick<JobDto, 'status' | 'completedZooms' | 'tilesDone' | 'tilesTotal'>>,
  ): Promise<void> {
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

    // ── Create or resume job ─────────────────────────────────────────────
    if (!opts.resume) {
      const job = await apiFetch<JobDto>('/api/admin/tile-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'raster', bbox, minZoom, maxZoom, tilesTotal }),
      });
      jobId = job.id;
    }

    await patchJob({ status: 'running' });

    // ── Stage 3: Generate + upload ───────────────────────────────────────
    onStage('generate+upload');

    let tilesDone = skippedTiles;
    const completedZooms: number[] = [...resumeCompletedZooms];

    const resumeSet = new Set(resumeCompletedZooms);
    const zooms = allZooms.filter((z) => !resumeSet.has(z));

    const updateEta = makeEtaTracker(tilesTotal - skippedTiles);

    for (const z of zooms) {
      if (signal?.aborted) throw signal.reason as Error;

      const coords: TileCoord[] = tilesForBbox(bbox, z);
      let batchFiles: EncodedTile[] = [];

      async function flushBatch(): Promise<void> {
        if (batchFiles.length === 0) return;
        const form = new FormData();
        for (const f of batchFiles) {
          form.append('tiles', new File([f.data.buffer as ArrayBuffer], f.name, { type: 'image/webp' }));
        }
        await apiFetch<unknown>('/api/admin/tiles/batch', { method: 'POST', body: form });
        tilesDone += batchFiles.length;
        const etaSeconds = updateEta(batchFiles.length);
        batchFiles = [];
        await patchJob({ tilesDone });
        const progressInfo: ProgressInfo = { tilesDone, tilesTotal, zoom: z };
        if (etaSeconds !== undefined) {
          progressInfo.etaSeconds = etaSeconds;
        }
        onProgress(progressInfo);
      }

      const collect = async (encoded: EncodedTile | null): Promise<void> => {
        if (encoded) {
          batchFiles.push(encoded);
          if (batchFiles.length >= RASTER_BATCH_SIZE) await flushBatch();
        } else {
          tilesDone += 1;
        }
      };

      if (opts.encodeTile) {
        // DOM-free path: caller encodes each tile (used by tests / SSR).
        for (const coord of coords) {
          if (signal?.aborted) {
            await flushBatch().catch(() => undefined);
            throw signal.reason as Error;
          }
          const encoded = await opts.encodeTile(layers, coord, size);
          await collect(encoded);
        }
      } else {
        // Default path: render via the Web Worker pool, upload as tiles arrive.
        await renderTilesWithPool({
          layers,
          tiles: coords,
          size,
          ...(signal ? { signal } : {}),
          onTile: async ({ coord, buffer }) => {
            await collect({
              name: `raster/${coord.z}/${coord.x}/${coord.y}.webp`,
              data: new Uint8Array(buffer),
            });
          },
        });
      }

      // Flush remaining tiles for this zoom.
      await flushBatch();
      onProgress({ tilesDone, tilesTotal, zoom: z });

      completedZooms.push(z);
      await patchJob({ completedZooms: [...completedZooms] });
    }

    await patchJob({ status: 'done' });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const isAbort =
      (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
      signal?.aborted === true;

    if (jobId) {
      await patchJob({ status: isAbort ? 'paused' : 'failed' }).catch(() => undefined);
    }

    if (!isAbort) {
      onError(error);
    }
    throw error;
  }
}
