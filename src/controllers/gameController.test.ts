import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from './gameController';

// Mock the dictionary service
vi.mock('../dictionary/dictionaryService', () => ({
  hasWord: vi.fn().mockResolvedValue(true)
}));

let gc: GameController;
beforeEach(() => {
  gc = new GameController(() => {});
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
