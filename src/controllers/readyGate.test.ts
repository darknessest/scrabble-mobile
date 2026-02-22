// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState } from '../core/types';
import type { SessionMeta } from '../types';
import { ReadyGate } from './readyGate';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    sessionId: 'test-session',
    language: 'en',
    board: [],
    racks: { host: [], client: [] },
    scores: { host: 0, client: 0 },
    bag: [],
    players: ['host', 'client'],
    currentPlayer: 'host',
    moveNumber: 1,
    consecutivePasses: 0,
    moveHistory: [],
    history: [],
    ...overrides
  } as GameState;
}

  function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
    return {
      mode: 'host',
      language: 'en',
      isHost: true,
      localPlayerId: 'host',
      remotePlayerId: 'client',
      sessionId: 'test-session',
      gameStartAt: null,
      ...overrides
    };
  }

function makeGate(overrides: Partial<SessionMeta> = {}): ReadyGate {
  const overlay = document.createElement('div');
  const status = document.createElement('p');
  const button = document.createElement('button');
  const gate = new ReadyGate(overlay, status, button);
  gate.setMeta(makeMeta(overrides));
  return gate;
}

function withCurrentState(gate: ReadyGate, state: GameState): void {
  gate.setCurrentState(state);
}

describe('ReadyGate', () => {
  let gate: ReadyGate;

  beforeEach(() => {
    gate = makeGate();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isPreGameLocked', () => {
    it('locks when gameStartAt is set in the future and state is ready', () => {
      gate.setMeta(makeMeta({ gameStartAt: 10_000 }));
      expect(gate.isPreGameLocked()).toBe(false);

      withCurrentState(gate, makeState());
      gate.setMeta(makeMeta({ gameStartAt: Date.now() + 10_000 }));
      expect(gate.isPreGameLocked()).toBe(true);
    });

    it('is false for solo mode', () => {
      const solo = makeMeta({ mode: 'solo', localPlayerId: 'host', isHost: false, gameStartAt: Date.now() + 10_000 });
      gate = makeGate(solo);
      withCurrentState(gate, makeState());

      expect(gate.isPreGameLocked()).toBe(false);
    });

    it('auto-unlocks once start time is reached', () => {
      vi.useFakeTimers();
      const now = Date.now();
      gate.setMeta(makeMeta({ gameStartAt: now + 10_000 }));
      withCurrentState(gate, makeState());
      vi.setSystemTime(now);
      expect(gate.isPreGameLocked()).toBe(true);

      vi.setSystemTime(now + 10_001);
      expect(gate.isPreGameLocked()).toBe(false);
    });
  });

  describe('markLocalReady', () => {
    it('marks local player ready when enabled', () => {
      gate.setMeta(makeMeta({ readyState: {} }));
      gate.setCurrentState(makeState());
      gate.markLocalReady();

      expect((gate as unknown as { meta?: SessionMeta | null }).meta?.readyState).toEqual({ host: true });
    });

    it('does not mutate ready state for solo mode', () => {
      const solo = makeMeta({ mode: 'solo', isHost: false, readyState: {} });
      gate = makeGate(solo);
      withCurrentState(gate, makeState());

      gate.markLocalReady();
      expect((gate as unknown as { meta?: SessionMeta | null }).meta?.readyState).toEqual({});
    });
  });

  describe('maybeScheduleGameStartFromReady', () => {
    it('schedules start time for host when all players ready', async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      gate.setMeta(makeMeta({
        gameStartAt: null,
        readyState: { host: true, client: true },
      }));
      gate.setCurrentState(makeState());
      await gate.maybeScheduleGameStartFromReady();

      expect((gate as unknown as { meta?: SessionMeta | null }).meta?.gameStartAt).toBe(now + 3_000);
    });

    it('does not schedule start when not host', async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      gate = makeGate({ isHost: false, gameStartAt: undefined, readyState: { host: true, client: true } });
      gate.setCurrentState(makeState());
      await gate.maybeScheduleGameStartFromReady();

      expect((gate as unknown as { meta?: SessionMeta | null }).meta?.gameStartAt).toBeUndefined();
    });
  });

  it('auto-unlocks via ticker after the grace countdown', async () => {
    vi.useFakeTimers();
    const onUnlock = vi.fn();
    const now = 1_000;
    vi.setSystemTime(now);
    gate.setMeta(makeMeta({ gameStartAt: now + 1_200 }));
    gate.setOnUnlock(onUnlock);
    withCurrentState(gate, makeState());

    gate.renderReadyOverlay();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onUnlock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });
});
