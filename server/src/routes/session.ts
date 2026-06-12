import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../db/connection.js';
import { getAllSettings } from '../repos/settings.js';
import {
  findUserByName,
  findUserById,
  getGameState,
  upsertGameState,
  updateUserStats,
  resolveSync,
  deleteDebugUser,
  type UserRow,
  type ClientStatePayload,
} from '../repos/sync.js';

function userToDto(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    avatarEmoji: row.avatar_emoji,
    isDebug: row.is_debug !== 0,
  };
}

export async function sessionRoutes(app: FastifyInstance) {
  // POST /api/session — find or create user by name
  app.post<{
    Body: { name: string; avatarEmoji: string };
  }>(
    '/api/session',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'avatarEmoji'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 30 },
            avatarEmoji: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req) => {
      const db = getDb();
      const { name, avatarEmoji } = req.body;

      let user = findUserByName(db, name);

      if (!user) {
        const now = Date.now();
        const id = nanoid(10);
        const settings = getAllSettings(db);
        const isDebug = settings.debug_mode === true ? 1 : 0;

        db.prepare(
          `INSERT INTO users (id, name, avatar_emoji, is_debug, total_score, completed_all, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
        ).run(id, name, avatarEmoji, isDebug, now, now);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
      }

      const stateRow = getGameState(db, user.id);
      const state = stateRow ? (JSON.parse(stateRow.payload) as ClientStatePayload) : null;

      return {
        user: userToDto(user),
        state,
      };
    },
  );

  // POST /api/sync — sync client state with server
  app.post<{
    Body: { userId: string; state: ClientStatePayload };
  }>(
    '/api/sync',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'state'],
          properties: {
            userId: { type: 'string' },
            state: {
              type: 'object',
              required: ['updatedAt'],
              properties: {
                updatedAt: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { userId, state: incomingState } = req.body;

      const user = findUserById(db, userId);
      if (!user) return reply.code(404).send({ error: 'user not found' });

      const stateRow = getGameState(db, userId);
      const serverRow = stateRow
        ? {
            payload: JSON.parse(stateRow.payload) as ClientStatePayload,
            clientUpdatedAt: stateRow.client_updated_at,
          }
        : null;

      const { outcome, merged } = resolveSync(serverRow, {
        state: incomingState,
        updatedAt: incomingState.updatedAt,
      });

      // Persist if accepted/merged, or if server-newer but merge changed server payload
      const shouldPersist =
        outcome === 'accepted' ||
        outcome === 'merged' ||
        (outcome === 'server-newer' && serverRow !== null);

      if (shouldPersist) {
        // For server-newer we use the server's clientUpdatedAt (unchanged), otherwise incoming
        const clientUpdatedAt =
          outcome === 'server-newer' && serverRow !== null
            ? serverRow.clientUpdatedAt
            : incomingState.updatedAt;

        upsertGameState(db, userId, merged, clientUpdatedAt);
        updateUserStats(db, userId, merged);
      }

      return {
        outcome,
        state: merged,
        serverTime: Date.now(),
      };
    },
  );

  // DELETE /api/session/:userId — delete a debug user and all their data.
  // Public endpoint; returns 403 when the user is not a debug user (safety guard).
  app.delete<{ Params: { userId: string } }>('/api/session/:userId', async (req, reply) => {
    const db = getDb();
    const result = deleteDebugUser(db, req.params.userId);
    if (result === 'not_found') return reply.code(404).send({ error: 'user not found' });
    if (result === 'not_debug') return reply.code(403).send({ error: 'not a debug user' });
    return { ok: true };
  });

  // GET /api/state/:userId — get current stored state
  app.get<{ Params: { userId: string } }>('/api/state/:userId', async (req, reply) => {
    const db = getDb();
    const user = findUserById(db, req.params.userId);
    if (!user) return reply.code(404).send({ error: 'user not found' });

    const stateRow = getGameState(db, req.params.userId);
    const state = stateRow ? (JSON.parse(stateRow.payload) as ClientStatePayload) : null;
    return { state };
  });
}
