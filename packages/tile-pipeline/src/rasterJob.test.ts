import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runRasterJob } from './jobRunner.js';
import type { JobStage, ProgressInfo, ResumeInfo } from './jobRunner.js';
import overpassSample from './fixtures/overpass-sample.json';

const SAMPLE_BBOX: [number, number, number, number] = [37.614, 55.752, 37.62, 55.757];

interface CallRecord {
  method: string;
  url: string;
  body?: unknown;
  fileNames?: string[];
}

function makeMockFetch(calls: CallRecord[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    let responseBody: unknown = {};

    if (method === 'POST' && url === '/api/admin/overpass') {
      calls.push({ method, url });
      responseBody = overpassSample;
    } else if (method === 'POST' && url === '/api/admin/tile-jobs') {
      const body = JSON.parse(init?.body as string) as unknown;
      calls.push({ method, url, body });
      responseBody = {
        id: 'r1',
        kind: 'raster',
        bbox: SAMPLE_BBOX,
        minZoom: 11,
        maxZoom: 12,
        status: 'pending',
        completedZooms: [],
        tilesDone: 0,
        tilesTotal: 0,
      };
    } else if (method === 'PATCH' && url.startsWith('/api/admin/tile-jobs/')) {
      const body = JSON.parse(init?.body as string) as unknown;
      calls.push({ method, url, body });
      responseBody = body;
    } else if (method === 'POST' && url === '/api/admin/tiles/batch') {
      const form = init?.body as FormData;
      const allTiles = form.getAll('tiles');
      const names = allTiles.map((f) => (f instanceof File ? f.name : ''));
      calls.push({ method, url, fileNames: names });
      responseBody = { saved: allTiles.length };
    } else {
      calls.push({ method, url });
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('runRasterJob', () => {
  let calls: CallRecord[];

  beforeEach(() => {
    calls = [];
  });

  it('uploads raster/z/x/y.webp filenames in batches ≤25 with encodeTile override; final status done', async () => {
    const mockFetch = makeMockFetch(calls);
    const stages: JobStage[] = [];

    // Tiny fake WebP bytes (RIFF/WEBP header).
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x57, 0x45]);

    await runRasterJob(
      {
        bbox: SAMPLE_BBOX,
        minZoom: 11,
        maxZoom: 12,
        fetchImpl: mockFetch,
        encodeTile: async (_layers, coord) => ({
          name: `raster/${coord.z}/${coord.x}/${coord.y}.webp`,
          data: fakeWebp,
        }),
      },
      {
        onStage: (s) => stages.push(s),
        onProgress: () => undefined,
        onError: () => undefined,
      },
    );

    expect(stages).toContain('download');
    expect(stages).toContain('parse');
    expect(stages).toContain('generate+upload');

    // Job created with kind 'raster'.
    const createCall = calls.find((c) => c.url === '/api/admin/tile-jobs');
    expect((createCall?.body as { kind: string }).kind).toBe('raster');

    const batchCalls = calls.filter((c) => c.url === '/api/admin/tiles/batch');
    expect(batchCalls.length).toBeGreaterThan(0);
    for (const batch of batchCalls) {
      expect(batch.fileNames!.length).toBeLessThanOrEqual(25);
    }

    const allFileNames = batchCalls.flatMap((c) => c.fileNames ?? []);
    expect(allFileNames.length).toBeGreaterThan(0);
    const rasterPattern = /^raster\/\d+\/\d+\/\d+\.webp$/;
    for (const name of allFileNames) {
      expect(name).toMatch(rasterPattern);
    }

    // completedZooms patched once per zoom (11 and 12).
    const completedZoomPatches = calls.filter(
      (c) =>
        c.method === 'PATCH' &&
        typeof c.body === 'object' &&
        c.body !== null &&
        'completedZooms' in (c.body as object),
    );
    expect(completedZoomPatches).toHaveLength(2);

    const statusPatches = calls.filter(
      (c) =>
        c.method === 'PATCH' &&
        typeof c.body === 'object' &&
        c.body !== null &&
        'status' in (c.body as object),
    );
    const lastStatusPatch = statusPatches[statusPatches.length - 1];
    expect((lastStatusPatch?.body as { status: string }).status).toBe('done');
  });

  it('resume: skips POST create, first PATCH is status running, zooms 11 not generated, final status done', async () => {
    const resume: ResumeInfo = { jobId: 'r1', completedZooms: [11] };
    const mockFetch = makeMockFetch(calls);
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x57, 0x45]);

    await runRasterJob(
      {
        bbox: SAMPLE_BBOX,
        minZoom: 11,
        maxZoom: 12,
        fetchImpl: mockFetch,
        resume,
        encodeTile: async (_layers, coord) => ({
          name: `raster/${coord.z}/${coord.x}/${coord.y}.webp`,
          data: fakeWebp,
        }),
      },
      {
        onStage: () => undefined,
        onProgress: () => undefined,
        onError: () => undefined,
      },
    );

    // No POST to /api/admin/tile-jobs
    const createCalls = calls.filter((c) => c.method === 'POST' && c.url === '/api/admin/tile-jobs');
    expect(createCalls).toHaveLength(0);

    // First PATCH must set status: 'running'
    const allPatches = calls.filter((c) => c.method === 'PATCH' && c.url.startsWith('/api/admin/tile-jobs/'));
    expect(allPatches.length).toBeGreaterThan(0);
    const firstPatch = allPatches[0];
    expect((firstPatch?.body as { status?: string }).status).toBe('running');

    // No uploaded filenames for zoom 11
    const batchCalls = calls.filter((c) => c.url === '/api/admin/tiles/batch');
    const allFileNames = batchCalls.flatMap((c) => c.fileNames ?? []);
    const zoom11 = allFileNames.filter((n) => /\/11\//.test(n));
    expect(zoom11).toHaveLength(0);

    // Final PATCH status: 'done'
    const statusPatches = allPatches.filter(
      (c) => typeof c.body === 'object' && c.body !== null && 'status' in (c.body as object),
    );
    const lastStatusPatch = statusPatches[statusPatches.length - 1];
    expect((lastStatusPatch?.body as { status: string }).status).toBe('done');
  });

  it('ETA: onProgress eventually carries a finite numeric etaSeconds', async () => {
    const mockFetch = makeMockFetch(calls);
    const fakeWebp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x57, 0x45]);
    const progresses: ProgressInfo[] = [];

    await runRasterJob(
      {
        bbox: SAMPLE_BBOX,
        minZoom: 11,
        maxZoom: 13,
        fetchImpl: mockFetch,
        encodeTile: async (_layers, coord) => ({
          name: `raster/${coord.z}/${coord.x}/${coord.y}.webp`,
          data: fakeWebp,
        }),
      },
      {
        onStage: () => undefined,
        onProgress: (p) => progresses.push(p),
        onError: () => undefined,
      },
    );

    const withEta = progresses.filter(
      (p) => typeof p.etaSeconds === 'number' && isFinite(p.etaSeconds),
    );
    expect(withEta.length).toBeGreaterThan(0);
  });
});
