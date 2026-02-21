// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import { EndgameScanController } from './endgameScan';

class MockWorker {
  static instances: MockWorker[] = [];
  readonly postMessage = vi.fn();
  private listeners: Array<(ev: MessageEvent) => void> = [];

  constructor(_url: URL, _opts?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    if (type === 'message') this.listeners.push(listener);
  }

  emitMessage(data: unknown) {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent);
    }
  }
}

function makeState(): GameState {
  return {
    sessionId: 's1',
    language: 'en',
    board: Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => ({ tile: null }))),
    bag: [],
    racks: { host: [], client: [] },
    scores: { host: 0, client: 0 },
    currentPlayer: 'host',
    players: ['host', 'client'],
    moveNumber: 1,
    history: []
  };
}

function makeHostMeta(): SessionMeta {
  return {
    mode: 'host',
    language: 'en',
    isHost: true,
    localPlayerId: 'host',
    remotePlayerId: 'client',
    sessionId: 's1'
  };
}

describe('EndgameScanController', () => {
  let statusEl: HTMLSpanElement;
  let appendLog: ReturnType<typeof vi.fn<(msg: string) => void>>;
  let controller: EndgameScanController;

  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
    vi.stubGlobal('crypto', { randomUUID: () => 'req-1' });
    statusEl = document.createElement('span');
    appendLog = vi.fn<(msg: string) => void>();
    controller = new EndgameScanController(statusEl, appendLog);
    controller.setMeta(makeHostMeta());
    controller.setCurrentState(makeState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts ENDGAME_SCAN_REQUEST to worker when bag is empty in host flow', () => {
    controller.requestEndgameScanIfNeeded();

    expect(MockWorker.instances).toHaveLength(1);
    const worker = MockWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ENDGAME_SCAN_REQUEST',
        requestId: 'req-1'
      })
    );
  });

  it('does not post duplicate requests for the same endgame token while in flight', () => {
    controller.requestEndgameScanIfNeeded();
    controller.requestEndgameScanIfNeeded();

    const worker = MockWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('fires onGameEnd callback when worker reports allStuck=true', () => {
    const onGameEnd = vi.fn();
    controller.setOnGameEnd(onGameEnd);
    controller.requestEndgameScanIfNeeded();
    const worker = MockWorker.instances[0];
    const request = worker.postMessage.mock.calls[0][0] as { requestId: string };

    worker.emitMessage({
      type: 'ENDGAME_SCAN_RESPONSE',
      requestId: request.requestId,
      allStuck: true
    });

    expect(onGameEnd).toHaveBeenCalledTimes(1);
  });
});
