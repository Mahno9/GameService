import { describe, expect, it } from 'vitest';
import { resolveSync, type ClientStatePayload, type ServerRow } from './sync.js';

function makePayload(
  updatedAt: number,
  poiResults: Record<
    string,
    {
      bestScore: number;
      won: boolean;
      attempts: number;
      firstCompletedAt: number;
      rewardGranted: boolean;
    }
  > = {},
): ClientStatePayload {
  return {
    version: 1,
    updatedAt,
    profile: { userId: 'u1', name: 'Test', avatarEmoji: '🦊' },
    poiResults,
    prefs: {},
  };
}

function makeServerRow(payload: ClientStatePayload): ServerRow {
  return { payload, clientUpdatedAt: payload.updatedAt };
}

describe('resolveSync', () => {
  it('first sync: no server row → accepted', () => {
    const incoming = makePayload(1000, {
      poi1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 1000, rewardGranted: true },
    });
    const result = resolveSync(null, { state: incoming, updatedAt: incoming.updatedAt });
    expect(result.outcome).toBe('accepted');
    expect(result.merged).toEqual(incoming);
  });

  it('newer incoming wins → accepted when no server poiResults to merge', () => {
    const serverPayload = makePayload(500, {});
    const incoming = makePayload(1000, {
      poi1: { bestScore: 50, won: false, attempts: 2, firstCompletedAt: 800, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('accepted');
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(50);
  });

  it('stale incoming → server-newer', () => {
    const serverPayload = makePayload(2000, {
      poi1: { bestScore: 200, won: true, attempts: 3, firstCompletedAt: 500, rewardGranted: true },
    });
    const incoming = makePayload(1000, {
      poi1: { bestScore: 100, won: false, attempts: 1, firstCompletedAt: 500, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('server-newer');
    // Server's bestScore is higher and should be kept
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(200);
  });

  it('max-merge keeps higher bestScore from incoming when incoming is newer', () => {
    const serverPayload = makePayload(500, {
      poi1: { bestScore: 300, won: true, attempts: 5, firstCompletedAt: 400, rewardGranted: true },
    });
    const incoming = makePayload(1000, {
      poi1: { bestScore: 150, won: false, attempts: 2, firstCompletedAt: 600, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    // Incoming is newer, but server has higher bestScore → merged keeps 300
    expect(result.outcome).toBe('merged');
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(300);
    // attempts = max(5, 2) = 5
    expect(result.merged.poiResults['poi1']?.attempts).toBe(5);
    // rewardGranted = true OR false = true
    expect(result.merged.poiResults['poi1']?.rewardGranted).toBe(true);
    // Server's won is kept (server has higher bestScore)
    expect(result.merged.poiResults['poi1']?.won).toBe(true);
  });

  it('max-merge keeps higher bestScore from server when stale incoming has better score', () => {
    const serverPayload = makePayload(2000, {
      poi1: { bestScore: 50, won: false, attempts: 1, firstCompletedAt: 1900, rewardGranted: false },
    });
    const incoming = makePayload(500, {
      poi1: { bestScore: 999, won: true, attempts: 10, firstCompletedAt: 400, rewardGranted: true },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    // Server is newer but stale incoming has better score → merged keeps 999
    expect(result.outcome).toBe('server-newer');
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(999);
    expect(result.merged.poiResults['poi1']?.attempts).toBe(10);
    expect(result.merged.poiResults['poi1']?.rewardGranted).toBe(true);
    expect(result.merged.poiResults['poi1']?.won).toBe(true);
  });

  it('rewardGranted OR-merge: false incoming + true server = true', () => {
    const serverPayload = makePayload(500, {
      poi1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 400, rewardGranted: true },
    });
    const incoming = makePayload(1000, {
      poi1: { bestScore: 200, won: true, attempts: 2, firstCompletedAt: 600, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.poiResults['poi1']?.rewardGranted).toBe(true);
  });

  it('rewardGranted OR-merge: true incoming + false server = true', () => {
    const serverPayload = makePayload(500, {
      poi1: { bestScore: 100, won: false, attempts: 1, firstCompletedAt: 400, rewardGranted: false },
    });
    const incoming = makePayload(1000, {
      poi1: { bestScore: 100, won: false, attempts: 1, firstCompletedAt: 400, rewardGranted: true },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.poiResults['poi1']?.rewardGranted).toBe(true);
  });

  it('attempts max-merge', () => {
    const serverPayload = makePayload(2000, {
      poi1: { bestScore: 100, won: true, attempts: 7, firstCompletedAt: 300, rewardGranted: true },
    });
    const incoming = makePayload(500, {
      poi1: { bestScore: 100, won: true, attempts: 3, firstCompletedAt: 300, rewardGranted: true },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.poiResults['poi1']?.attempts).toBe(7);
  });

  it('new poi in incoming is merged into server-newer result', () => {
    const serverPayload = makePayload(2000, {
      poi1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 300, rewardGranted: true },
    });
    const incoming = makePayload(500, {
      poi2: { bestScore: 50, won: false, attempts: 1, firstCompletedAt: 400, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('server-newer');
    // poi2 from incoming should appear in merged (since it's a new entry)
    expect(result.merged.poiResults['poi2']).toBeDefined();
    expect(result.merged.poiResults['poi2']?.bestScore).toBe(50);
    // poi1 from server should still be there
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(100);
  });

  it('accepted when incoming is newer with no server-side overrides needed', () => {
    const serverPayload = makePayload(500, {
      poi1: { bestScore: 10, won: false, attempts: 1, firstCompletedAt: 400, rewardGranted: false },
    });
    const incoming = makePayload(1000, {
      poi1: { bestScore: 200, won: true, attempts: 5, firstCompletedAt: 300, rewardGranted: true },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    // Incoming's bestScore > server's, so no server override needed → 'accepted'
    expect(result.outcome).toBe('accepted');
    expect(result.merged.poiResults['poi1']?.bestScore).toBe(200);
  });
});
