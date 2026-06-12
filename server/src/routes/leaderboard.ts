import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import {
  getMergedLeaderboard,
  listEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  listRealUsers,
  deleteRealUser,
} from '../repos/leaderboard.js';

export async function leaderboardRoutes(app: FastifyInstance) {
  // ---- Public route ----

  // GET /api/leaderboard?userId=X
  // Merged list of fictional entries + real non-debug users with total_score > 0
  // (debug user excluded unless they are the requesting user).
  // Always includes the requesting user's own row if they exist.
  app.get<{ Querystring: { userId?: string } }>(
    '/api/leaderboard',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { userId: { type: 'string' } },
        },
      },
    },
    async (req) => {
      return getMergedLeaderboard(getDb(), req.query.userId);
    },
  );

  // ---- Admin routes — fictional entries ----

  // GET /api/admin/leaderboard — list fictional entries
  app.get('/api/admin/leaderboard', { preHandler: app.requireAdmin }, async () => {
    return listEntries(getDb());
  });

  // POST /api/admin/leaderboard — create fictional entry
  app.post<{
    Body: { name: string; avatarEmoji: string; score: number; sortHint?: number };
  }>(
    '/api/admin/leaderboard',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'avatarEmoji', 'score'],
          properties: {
            name: { type: 'string', minLength: 1 },
            avatarEmoji: { type: 'string', minLength: 1 },
            score: { type: 'integer', minimum: 0 },
            sortHint: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const input: Parameters<typeof createEntry>[1] = {
        name: body.name,
        avatarEmoji: body.avatarEmoji,
        score: body.score,
      };
      if (body.sortHint !== undefined) input.sortHint = body.sortHint;
      const entry = createEntry(getDb(), input);
      return reply.code(201).send(entry);
    },
  );

  // PUT /api/admin/leaderboard/:id — update fictional entry (partial)
  app.put<{
    Params: { id: string };
    Body: { name?: string; avatarEmoji?: string; score?: number; sortHint?: number };
  }>(
    '/api/admin/leaderboard/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1 },
            avatarEmoji: { type: 'string', minLength: 1 },
            score: { type: 'integer', minimum: 0 },
            sortHint: { type: 'integer' },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const input: Parameters<typeof updateEntry>[2] = {};
      if ('name' in body) input.name = body.name;
      if ('avatarEmoji' in body) input.avatarEmoji = body.avatarEmoji;
      if ('score' in body) input.score = body.score;
      if ('sortHint' in body) input.sortHint = body.sortHint;

      const entry = updateEntry(getDb(), req.params.id, input);
      if (!entry) return reply.code(404).send({ error: 'entry not found' });
      return entry;
    },
  );

  // DELETE /api/admin/leaderboard/:id — delete fictional entry
  app.delete<{ Params: { id: string } }>(
    '/api/admin/leaderboard/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const deleted = deleteEntry(getDb(), req.params.id);
      if (!deleted) return reply.code(404).send({ error: 'entry not found' });
      return { ok: true };
    },
  );

  // ---- Admin routes — real users ----

  // GET /api/admin/leaderboard/real — list real users
  app.get('/api/admin/leaderboard/real', { preHandler: app.requireAdmin }, async () => {
    return listRealUsers(getDb());
  });

  // DELETE /api/admin/leaderboard/real/:userId — delete real user row (cascades game_states)
  app.delete<{ Params: { userId: string } }>(
    '/api/admin/leaderboard/real/:userId',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const deleted = deleteRealUser(getDb(), req.params.userId);
      if (!deleted) return reply.code(404).send({ error: 'user not found' });
      return { ok: true };
    },
  );
}
