import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from './gameController';
import type { Placement } from '../core/types';
import type { SessionMeta } from '../types';
import { appendLogEntry } from '../storage/indexedDb';
import { hasWord } from '../dictionary/dictionaryService';
import { computeStateHash } from '../utils/syncState';

vi.mock('../storage/indexedDb', () => ({
  appendLogEntry: vi.fn().mockResolvedValue({
    sessionId: 'mock-session',
    seq: 0,
    action: {},
    timestamp: 0,
    playerId: 'p1',
    type: 'PASS'
  }),
  getLogSince: vi.fn(),
  trimLog: vi.fn()
}));

// Mock the dictionary service
vi.mock('../dictionary/dictionaryService', () => ({
  hasWord: vi.fn().mockResolvedValue(true)
}));

let gc: GameController;
beforeEach(() => {
  gc = new GameController(() => {});
  vi.clearAllMocks();
});

describe('start', () => {
  it('initializes a new game state', () => {
    const state = gc.start('en', ['p1', 'p2']);
    expect(state).toBeTruthy();
    expect(state.players).toEqual(['p1', 'p2']);
    expect(state.currentPlayer).toBe('p1');
    expect(state.moveNumber).toBe(0);
    expect(gc.getState()).toBe(state);
  });

  it('resets placements and selection', () => {
    gc.start('en', ['p1']);
    gc.setSelectedTileId('t1');
    gc.start('en', ['p1', 'p2']);
    expect(gc.getPlacements()).toEqual([]);
    expect(gc.getSelectedTileId()).toBeNull();
  });
});

describe('resume', () => {
  it('restores from saved state', () => {
    const original = gc.start('en', ['p1', 'p2']);
    const gc2 = new GameController(vi.fn());
    gc2.resume(structuredClone(original));
    expect(gc2.getState()!.sessionId).toBe(original.sessionId);
    expect(gc2.getPlacements()).toEqual([]);
  });
});

describe('shuffleRack', () => {
  it('does not crash without meta', () => {
    gc.start('en', ['p1']);
    gc.shuffleRack();
    expect(gc.getRackOrder()).toEqual([]);
  });

  it('shuffles rack order when meta is set', () => {
    const state = gc.start('en', ['p1']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });
    gc.syncLocalRackOrder();
    const before = [...gc.getRackOrder()];
    // Shuffle many times to get a different order (probabilistic but reliable with 7 tiles)
    let different = false;
    for (let i = 0; i < 20; i++) {
      gc.shuffleRack();
      if (JSON.stringify(gc.getRackOrder()) !== JSON.stringify(before)) {
        different = true;
        break;
      }
    }
    // With 7! = 5040 permutations, 20 attempts virtually guarantees a different order
    expect(different).toBe(true);
  });
});

describe('submitMove / submitRemoteMove', () => {
  it('submits a successful local move and clears placements', async () => {
    const onRenderAll = vi.fn();
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const onSync = vi.fn();
    const onGameEnd = vi.fn();
    gc.setOnRenderAll(onRenderAll);
    gc.setOnPersist(onPersist);
    gc.setOnSync(onSync);
    gc.setOnGameEnd(onGameEnd);

    const state = gc.start('en', ['p1', 'p2']);
    const meta: SessionMeta = {
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    };
    gc.setMeta(meta);

    const placements: Placement[] = [{ x: 7, y: 7, tile: state.racks['p1'][0] }];
    (gc as unknown as { placements: Placement[] }).placements = placements;

    const placeMoveSpy = vi.spyOn(gc.getGame(), 'placeMove').mockResolvedValue({
      success: true,
      words: ['A'],
      scoreDelta: 2
    });

    const result = await gc.submitMove(() => vi.fn().mockResolvedValue(true));
    expect(result).toBe(true);
    expect(placeMoveSpy).toHaveBeenCalledWith('p1', placements, expect.any(Function), undefined, meta);
    expect(gc.getPlacements()).toEqual([]);
    expect(onRenderAll).toHaveBeenCalled();
    expect(onPersist).toHaveBeenCalled();
    expect(onSync).toHaveBeenCalled();
    expect(onGameEnd).toHaveBeenCalled();
    expect(appendLogEntry).toHaveBeenCalledWith({
      sessionId: state.sessionId,
      type: 'MOVE',
      playerId: 'p1',
      action: {
        placements: [
          {
            x: placements[0].x,
            y: placements[0].y,
            tile: expect.objectContaining(placements[0].tile)
          }
        ]
      }
    });
  });

  it('returns false and logs on failed local move (invalid word)', async () => {
    const appendLog = vi.fn();
    const localGc = new GameController(appendLog);
    const state = localGc.start('en', ['p1']);
    localGc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });
    (localGc as unknown as { placements: Placement[] }).placements = [{ x: 7, y: 7, tile: state.racks['p1'][0] }];
    vi.spyOn(localGc.getGame(), 'placeMove').mockResolvedValue({
      success: false,
      message: 'Invalid word: ZZ'
    });

    const result = await localGc.submitMove(() => vi.fn().mockResolvedValue(false));
    expect(result).toBe(false);
    expect(appendLog).toHaveBeenCalledWith('Invalid word: ZZ');
    expect(appendLogEntry).not.toHaveBeenCalled();
  });

  it('resets timer deadline after successful move', async () => {
    const state = gc.start('en', ['p1', 'p2']);
    const meta: SessionMeta = {
      mode: 'solo' as const,
      language: 'en' as const,
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() + 30_000
    };
    gc.setMeta(meta);
    (gc as unknown as { placements: Placement[] }).placements = [{ x: 7, y: 7, tile: state.racks['p1'][0] }];
    vi.spyOn(gc.getGame(), 'placeMove').mockResolvedValue({ success: true, words: ['A'], scoreDelta: 2 });

    const result = await gc.submitMove(() => vi.fn().mockResolvedValue(true));
    expect(result).toBe(true);
    expect(meta.turnDeadline).toBeNull();
  });

  it('handles gameEnded move result by writing meta.gameOver and resyncing', async () => {
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const onSync = vi.fn();
    const onGameEnd = vi.fn();
    gc.setOnPersist(onPersist);
    gc.setOnSync(onSync);
    gc.setOnGameEnd(onGameEnd);

    const state = gc.start('en', ['p1', 'p2']);
    const meta: SessionMeta = {
      mode: 'solo' as const,
      language: 'en' as const,
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    };
    gc.setMeta(meta);
    (gc as unknown as { placements: Placement[] }).placements = [{ x: 7, y: 7, tile: state.racks['p1'][0] }];
    vi.spyOn(gc.getGame(), 'placeMove').mockResolvedValue({
      success: true,
      words: ['A'],
      scoreDelta: 2,
      gameEnded: {
        reason: 'four_passes',
        finalScores: { p1: 10, p2: 8 }
      }
    });

    const result = await gc.submitMove(() => vi.fn().mockResolvedValue(true));
    expect(result).toBe(true);
    expect(meta.gameOver?.reason).toBe('four_passes');
    expect(meta.gameOver?.finalScores).toEqual({ p1: 10, p2: 8 });
    expect(onPersist).toHaveBeenCalledTimes(2);
    expect(onSync).toHaveBeenCalledTimes(2);
    expect(onGameEnd).toHaveBeenCalled();
  });

  it('submits remote move using provided remote playerId', async () => {
    const onSync = vi.fn();
    gc.setOnSync(onSync);
    const state = gc.start('en', ['host', 'client']);
    const meta: SessionMeta = {
      mode: 'host' as const,
      language: 'en' as const,
      isHost: true,
      localPlayerId: 'host',
      remotePlayerId: 'client',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() + 20_000
    };
    gc.setMeta(meta);

    const placements: Placement[] = [{ x: 7, y: 7, tile: state.racks['host'][0] }];
    const placeMoveSpy = vi.spyOn(gc.getGame(), 'placeMove').mockResolvedValue({
      success: true,
      words: ['A'],
      scoreDelta: 2
    });

    const result = await gc.submitRemoteMove(placements, 'client', () => vi.fn().mockResolvedValue(true));
    expect(result).toBe(true);
    expect(placeMoveSpy).toHaveBeenCalledWith('client', placements, expect.any(Function), undefined, meta);
    expect(meta.turnDeadline).toBeNull();
    expect(onSync).toHaveBeenCalled();
    expect(appendLogEntry).toHaveBeenCalledWith({
      sessionId: state.sessionId,
      type: 'MOVE',
      playerId: 'client',
      action: {
        placements: [
          {
            x: placements[0].x,
            y: placements[0].y,
            tile: expect.objectContaining(placements[0].tile)
          }
        ]
      }
    });
  });
});

describe('submitPass', () => {
  it('passes the turn when host', async () => {
    const onRenderAll = vi.fn();
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const onSync = vi.fn();
    const onGameEnd = vi.fn();
    gc.setOnRenderAll(onRenderAll);
    gc.setOnPersist(onPersist);
    gc.setOnSync(onSync);
    gc.setOnGameEnd(onGameEnd);

    const state = gc.start('en', ['p1', 'p2']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });

    const result = await gc.submitPass();
    expect(result).toBe(true);
    expect(gc.getState()!.currentPlayer).toBe('p2');
    expect(appendLogEntry).toHaveBeenCalledWith({
      sessionId: state.sessionId,
      type: 'PASS',
      playerId: 'p1',
      action: {}
    });
    expect(onRenderAll).toHaveBeenCalled();
    expect(onSync).toHaveBeenCalled();
    expect(onGameEnd).toHaveBeenCalled();
  });

  it('returns false when not host/solo', async () => {
    gc.start('en', ['host', 'client']);
    gc.setMeta({
      mode: 'client',
      language: 'en',
      isHost: false,
      localPlayerId: 'client',
      remotePlayerId: 'host',
      sessionId: gc.getState()!.sessionId
    });

    const result = await gc.submitPass();
    expect(result).toBe(false);
  });

  it('returns false without state', async () => {
    const result = await gc.submitPass();
    expect(result).toBe(false);
  });

  it('updates meta.stateHash when local pass changes state', async () => {
    const onSync = vi.fn();
    gc.setOnSync(onSync);
    const state = gc.start('en', ['p1', 'p2']);
    const beforeHash = computeStateHash(state);
    const meta: SessionMeta = {
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      stateHash: beforeHash
    };
    gc.setMeta(meta);

    await gc.submitPass();

    expect(meta.stateHash).not.toBe(beforeHash);
    expect(onSync).toHaveBeenCalled();
  });
});

describe('submitExchange', () => {
  it('exchanges tiles and advances turn', async () => {
    const state = gc.start('en', ['p1', 'p2']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });

    const rack = state.racks['p1'];
    const tileId = rack[0].id;
    const result = await gc.submitExchange([tileId]);
    expect(result).toBe(true);
    expect(gc.getState()!.currentPlayer).toBe('p2');
    expect(appendLogEntry).toHaveBeenCalledWith({
      sessionId: state.sessionId,
      type: 'EXCHANGE',
      playerId: 'p1',
      action: {
        tileIds: [tileId]
      }
    });
  });

  it('updates meta.stateHash on exchange', async () => {
    const onSync = vi.fn();
    gc.setOnSync(onSync);
    const state = gc.start('en', ['p1', 'p2']);
    const beforeHash = computeStateHash(state);
    const tileId = state.racks['p1'][0].id;
    const meta: SessionMeta = {
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      stateHash: beforeHash
    };
    gc.setMeta(meta);

    const result = await gc.submitExchange([tileId]);

    expect(result).toBe(true);
    expect(meta.stateHash).not.toBe(beforeHash);
    expect(onSync).toHaveBeenCalled();
  });
});

describe('state synchronization metadata', () => {
  it('updates stateHash on successful local move', async () => {
    const onSync = vi.fn();
    gc.setOnSync(onSync);
    const state = gc.start('en', ['p1', 'p2']);
    const beforeHash = computeStateHash(state);
    const meta: SessionMeta = {
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      stateHash: beforeHash
    };
    gc.setMeta(meta);

    (gc as unknown as { placements: Placement[] }).placements = [
      { x: 7, y: 7, tile: state.racks['p1'][0] }
    ];

    const result = await gc.submitMove(() => vi.fn().mockResolvedValue(true));

    expect(result).toBe(true);
    expect(meta.stateHash).not.toBe(beforeHash);
    expect(onSync).toHaveBeenCalled();
  });

  it('updates stateHash on successful remote move', async () => {
    const onSync = vi.fn();
    gc.setOnSync(onSync);
    const state = gc.start('en', ['client', 'host']);
    const beforeHash = computeStateHash(state);
    const meta: SessionMeta = {
      mode: 'host',
      language: 'en',
      isHost: true,
      localPlayerId: 'host',
      remotePlayerId: 'client',
      sessionId: state.sessionId,
      stateHash: beforeHash
    };
    gc.setMeta(meta);

    const placement: Placement = { x: 7, y: 7, tile: state.racks['client'][0] };
    const result = await gc.submitRemoteMove([placement], 'client', () => vi.fn().mockResolvedValue(true));

    expect(result).toBe(true);
    expect(meta.stateHash).not.toBe(beforeHash);
    expect(meta.vectorClock?.client).toBe(1);
    expect(onSync).toHaveBeenCalled();
  });
});

describe('clearPlacements', () => {
  it('clears all placements and selection', () => {
    gc.start('en', ['p1']);
    gc.setSelectedTileId('t1');
    gc.clearPlacements();
    expect(gc.getPlacements()).toEqual([]);
    expect(gc.getSelectedTileId()).toBeNull();
  });
});

describe('setRemoteDraft', () => {
  it('sets and gets remote draft', () => {
    expect(gc.getRemoteDraft()).toBeNull();
    const draft = { playerId: 'p2', placements: [], moveNumber: 1 };
    gc.setRemoteDraft(draft);
    expect(gc.getRemoteDraft()).toBe(draft);
  });

  it('clears remote draft', () => {
    gc.setRemoteDraft({ playerId: 'p2', placements: [], moveNumber: 1 });
    gc.setRemoteDraft(null);
    expect(gc.getRemoteDraft()).toBeNull();
  });
});

describe('validation', () => {
  it('starts idle', () => {
    expect(gc.getValidationStatus()).toBe('idle');
    expect(gc.getValidationMessage()).toBeNull();
  });

  it('emits checking then valid for a valid latest draft', async () => {
    const state = gc.start('en', ['p1']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });

    const transitions: string[] = [];
    gc.setOnValidationUpdate(() => {
      transitions.push(gc.getValidationStatus());
    });

    (gc as unknown as { placements: Placement[] }).placements = [
      { x: 7, y: 7, tile: state.racks.p1[0] },
      { x: 8, y: 7, tile: state.racks.p1[1] }
    ];

    await gc.updateValidation();

    expect(transitions).toEqual(['checking', 'valid']);
    expect(gc.getValidationStatus()).toBe('valid');
    expect(gc.getValidationMessage()).toBeNull();
  });

  it('clears stale invalid message after subsequent valid draft', async () => {
    const mockedHasWord = vi.mocked(hasWord);
    const state = gc.start('en', ['p1']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId
    });

    (gc as unknown as { placements: Placement[] }).placements = [
      { x: 7, y: 7, tile: state.racks.p1[0] },
      { x: 8, y: 7, tile: state.racks.p1[1] }
    ];

    mockedHasWord.mockResolvedValueOnce(false);
    await gc.updateValidation();
    expect(gc.getValidationStatus()).toBe('invalid');
    expect(gc.getValidationMessage()).toMatch(/Invalid word:/i);

    mockedHasWord.mockResolvedValueOnce(true);
    await gc.updateValidation();
    expect(gc.getValidationStatus()).toBe('valid');
    expect(gc.getValidationMessage()).toBeNull();
  });
});

describe('resetForRematch', () => {
  it('creates a new game with same players', () => {
    const state1 = gc.start('en', ['p1', 'p2']);
    const state2 = gc.resetForRematch('en', ['p1', 'p2']);
    expect(state2.sessionId).not.toBe(state1.sessionId);
    expect(state2.players).toEqual(['p1', 'p2']);
    expect(state2.moveNumber).toBe(0);
    expect(gc.getPlacements()).toEqual([]);
  });
});

describe('maybeAutoPassOnTimeout', () => {
  it('auto-passes when timer expired', async () => {
    const onSync = vi.fn();
    const onPersist = vi.fn().mockResolvedValue(undefined);
    const onRenderAll = vi.fn();
    const onGameEnd = vi.fn();
    gc.setOnSync(onSync);
    gc.setOnPersist(onPersist);
    gc.setOnRenderAll(onRenderAll);
    gc.setOnGameEnd(onGameEnd);

    const state = gc.start('en', ['p1', 'p2']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() - 1000 // expired 1s ago
    });

    await gc.maybeAutoPassOnTimeout();
    expect(gc.getState()!.currentPlayer).toBe('p2');
    expect(onSync).toHaveBeenCalled();
    expect(onRenderAll).toHaveBeenCalled();
  });

  it('does not pass when timer has not expired', async () => {
    const state = gc.start('en', ['p1', 'p2']);
    gc.setMeta({
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() + 60000 // 60s remaining
    });

    await gc.maybeAutoPassOnTimeout();
    expect(gc.getState()!.currentPlayer).toBe('p1'); // unchanged
  });

  it('skips when not host/solo', async () => {
    const state = gc.start('en', ['host', 'client']);
    gc.setMeta({
      mode: 'client',
      language: 'en',
      isHost: false,
      localPlayerId: 'client',
      remotePlayerId: 'host',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() - 1000
    });

    await gc.maybeAutoPassOnTimeout();
    expect(gc.getState()!.currentPlayer).toBe('host'); // unchanged
  });
});
