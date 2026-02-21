import { describe, it, expect } from 'vitest';
import type { GameState, Tile } from '../core/types';
import type { SessionMeta } from '../types';
import { buildSyncStateForPeer } from './syncState';

function makeTile(id: string, letter: string, value: number): Tile {
  return { id, letter, value };
}

function makeGameState(): GameState {
  return {
    sessionId: 's1',
    language: 'en',
    board: [],
    racks: {
      host: [makeTile('h1', 'A', 1), makeTile('h2', 'E', 1)],
      client: [makeTile('c1', 'Z', 10)]
    },
    scores: { host: 0, client: 0 },
    bag: [],
    players: ['host', 'client'],
    currentPlayer: 'host',
    moveNumber: 1,
    history: []
  };
}

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    mode: 'host',
    language: 'en',
    isHost: true,
    localPlayerId: 'host',
    remotePlayerId: 'client',
    sessionId: 's1',
    ...overrides
  };
}

describe('buildSyncStateForPeer', () => {
  it('strips host rack and keeps only remote player rack when host syncs to client', () => {
    const state = makeGameState();
    const synced = buildSyncStateForPeer(state, makeMeta());

    expect(synced.racks.client).toEqual(state.racks.client);
    expect(synced.racks.host).toEqual([]);
  });

  it('does not mutate original game state racks', () => {
    const state = makeGameState();
    const synced = buildSyncStateForPeer(state, makeMeta());

    expect(state.racks.host).toHaveLength(2);
    expect(synced).not.toBe(state);
    expect(synced.racks).not.toBe(state.racks);
  });

  it('returns original state when meta is not host', () => {
    const state = makeGameState();
    const synced = buildSyncStateForPeer(state, makeMeta({ isHost: false, mode: 'client' }));

    expect(synced).toBe(state);
  });

  it('returns original state when remotePlayerId is missing', () => {
    const state = makeGameState();
    const synced = buildSyncStateForPeer(state, makeMeta({ remotePlayerId: undefined }));

    expect(synced).toBe(state);
  });
});
