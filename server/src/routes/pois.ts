import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import {
  listPois,
  getPoi,
  getPoiConfig,
  createPoi,
  updatePoi,
  deletePoi,
} from '../repos/pois.js';

export async function poisRoutes(app: FastifyInstance) {
  // ---- Public routes ----

  // GET /api/pois — list all POIs (no config_json)
  app.get('/api/pois', async () => {
    const pois = listPois(getDb());
    return pois.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      minigameId: p.minigameId,
      blockerIds: p.blockerIds,
      replayable: p.replayable,
      reward: p.reward,
    }));
  });

  // GET /api/pois/:id/config — minigameId + parsed config_json
  app.get<{ Params: { id: string } }>('/api/pois/:id/config', async (req, reply) => {
    const cfg = getPoiConfig(getDb(), req.params.id);
    if (!cfg) return reply.code(404).send({ error: 'POI not found' });
    return cfg;
  });

  // ---- Admin routes ----

  // POST /api/admin/pois
  app.post<{
    Body: {
      name: string;
      lat: number;
      lon: number;
      minigameId: string;
      replayable?: boolean;
      blockerIds?: string[];
      config?: Record<string, unknown>;
      rewardImageAsset?: string;
      rewardNameWin?: string;
      rewardNameLose?: string;
      rewardDescription?: string;
      sortOrder?: number;
    };
  }>(
    '/api/admin/pois',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'lat', 'lon', 'minigameId'],
          properties: {
            name: { type: 'string', minLength: 1 },
            lat: { type: 'number' },
            lon: { type: 'number' },
            minigameId: { type: 'string', minLength: 1 },
            replayable: { type: 'boolean' },
            blockerIds: { type: 'array', items: { type: 'string' } },
            config: { type: 'object' },
            rewardImageAsset: { type: 'string' },
            rewardNameWin: { type: 'string' },
            rewardNameLose: { type: 'string' },
            rewardDescription: { type: 'string' },
            sortOrder: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const body = req.body;
        const input: Parameters<typeof createPoi>[1] = {
          name: body.name,
          lat: body.lat,
          lon: body.lon,
          minigameId: body.minigameId,
        };
        if (body.replayable !== undefined) input.replayable = body.replayable;
        if (body.blockerIds !== undefined) input.blockerIds = body.blockerIds;
        if (body.config !== undefined) input.configJson = body.config;
        if (body.rewardImageAsset !== undefined) input.rewardImageAsset = body.rewardImageAsset;
        if (body.rewardNameWin !== undefined) input.rewardNameWin = body.rewardNameWin;
        if (body.rewardNameLose !== undefined) input.rewardNameLose = body.rewardNameLose;
        if (body.rewardDescription !== undefined) input.rewardDescription = body.rewardDescription;
        if (body.sortOrder !== undefined) input.sortOrder = body.sortOrder;

        const poi = createPoi(getDb(), input);
        return reply.code(201).send(poi);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // PUT /api/admin/pois/:id
  app.put<{
    Params: { id: string };
    Body: {
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
      sortOrder?: number;
    };
  }>(
    '/api/admin/pois/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1 },
            lat: { type: 'number' },
            lon: { type: 'number' },
            minigameId: { type: 'string', minLength: 1 },
            replayable: { type: 'boolean' },
            blockerIds: { type: 'array', items: { type: 'string' } },
            config: { type: 'object' },
            rewardImageAsset: { type: ['string', 'null'] },
            rewardNameWin: { type: 'string' },
            rewardNameLose: { type: 'string' },
            rewardDescription: { type: 'string' },
            sortOrder: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        // Build update input, only including fields that were explicitly provided
        const body = req.body;
        const input: Parameters<typeof updatePoi>[2] = {};

        if ('name' in body) input.name = body.name;
        if ('lat' in body) input.lat = body.lat;
        if ('lon' in body) input.lon = body.lon;
        if ('minigameId' in body) input.minigameId = body.minigameId;
        if ('replayable' in body) input.replayable = body.replayable;
        if ('blockerIds' in body) input.blockerIds = body.blockerIds;
        if ('config' in body) input.configJson = body.config;
        if ('rewardImageAsset' in body) input.rewardImageAsset = body.rewardImageAsset ?? null;
        if ('rewardNameWin' in body) input.rewardNameWin = body.rewardNameWin;
        if ('rewardNameLose' in body) input.rewardNameLose = body.rewardNameLose;
        if ('rewardDescription' in body) input.rewardDescription = body.rewardDescription;
        if ('sortOrder' in body) input.sortOrder = body.sortOrder;

        const poi = updatePoi(getDb(), req.params.id, input);
        if (!poi) return reply.code(404).send({ error: 'POI not found' });
        return poi;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // DELETE /api/admin/pois/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/pois/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const deleted = deletePoi(getDb(), req.params.id);
      if (!deleted) return reply.code(404).send({ error: 'POI not found' });
      return { ok: true };
    },
  );
}
