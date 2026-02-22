import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, AppState } from '../app';
import type { SessionMeta, SnapshotPayload } from '../types';
import type { GameState } from '../core/types';
import type { Controllers } from './controllerWiring';
import type { UiElements } from '../ui/uiRenderer';
import type { AdditionalElements } from '../ui/domElements';
import { makeMockControllers } from './testFixtures';

vi.mock('./controllerBus', () => ({
  propagateMeta: vi.fn()
}));

import { propagateMeta } from './controllerBus';
import { createSessionManager } from './sessionManager';

const mockedPropagateMeta = vi.mocked(propagateMeta);

function makeFakeGameState(overrides: Partial<GameState> = {}): GameState {
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
  } as unknown as GameState;
}

function makeMockUiElements(): UiElements {
  return {
    languageSelect: { value: 'en' },
    russianVariantWrapper: { style: { display: '' } },
    russianVariantSelect: { value: 'full' },
    minLengthInput: { value: '2' },
    timerEnabledToggle: { checked: false },
    timerInput: { value: '5' },
    meInput: { value: 'Alice' },
    peerInput: { value: 'Bob' },
    boardEl: {},
    rackEl: {},
    rackOwnerEl: {},
    turnIndicator: {},
    timerDisplay: {},
    wordCheckStatus: {},
    wordLengthStatus: {},
    endgameScanStatus: {},
    scoresEl: {},
    logEl: {},
    bagCountEl: {},
    moveHistoryEl: {},
    settingsSection: {},
    confirmMoveBtn: {},
    passBtn: {},
    exchangeBtn: {},
    clearPlacementsBtn: {},
    mixRackBtn: {},
    timerMinutesWrapper: {},
    modeTabs: {},
    hostCard: {},
    clientCard: {},
    languageWrapper: {},
    timerWrapper: {},
    offlineStatus: {},
    dictStatus: {},
    p2pStatus: {},
    versionEl: null,
    readyOverlay: {},
    readyStatusEl: {},
    readyBtn: {},
    gameOverOverlay: {},
    gameOverReasonEl: {},
    gameOverScoresEl: {},
    gameOverStatsEl: {},
    rematchStatusEl: {},
    rematchBtnOverlay: {},
    viewBoardBtn: {},
    gameOverBanner: {},
    gameOverBannerScoresEl: {},
    rematchBannerStatusEl: {},
    rematchBtnBanner: {},
    showResultsBtn: {},
    disconnectOverlay: {},
    disconnectMessage: {}
  } as unknown as UiElements;
}

function makeMockApp(modeOverride?: 'solo' | 'host' | 'client', controllers?: Controllers): App {
  const ctrls = controllers ?? makeMockControllers();
  return {
    state: {
      mode: modeOverride ?? 'solo',
      meta: null,
      labels: {},
      settingsHidden: false,
      logsHidden: false,
      lastShownTurnEventToken: null
    } as AppState,
    controllers: ctrls,
    uiElements: makeMockUiElements(),
    additional: {} as AdditionalElements,
    appendLog: vi.fn(),
    showToast: vi.fn(),
    renderAll: vi.fn(),
    sendSync: vi.fn(),
    checkAndHandleGameEnd: vi.fn(),
    markLocalReady: vi.fn(),
    maybeShowTimeoutToastFromMeta: vi.fn(),
    applyModeUIInternal: vi.fn(),
    applyTimerInputFromMetaInternal: vi.fn(),
    applyMinLengthInputFromMetaInternal: vi.fn(),
    renderVisibilityInternal: vi.fn(),
    finalizeGameEnd: vi.fn().mockResolvedValue(undefined)
  };
}

let app: App;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSessionManager', () => {
  describe('startSession (solo)', () => {
    it('creates game, sets meta with mode=solo, persists snapshot', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.gameController.start).toHaveBeenCalledWith('en', ['p1']);
      expect(app.state.meta).toBeTruthy();
      expect(app.state.meta!.mode).toBe('solo');
      expect(app.state.meta!.isHost).toBe(true);
      expect(app.state.meta!.localPlayerId).toBe('p1');
      expect(app.state.meta!.remotePlayerId).toBeUndefined();
      expect(app.controllers.storageController.persistSnapshot).toHaveBeenCalled();
    });

    it('sets labels from input fields', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.labels['p1']).toBe('Alice');
    });

    it('calls propagateMeta, resetTurnTimer, renderAll, updateValidation', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(mockedPropagateMeta).toHaveBeenCalled();
      expect(app.controllers.timerController.resetTurnTimer).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
      expect(app.controllers.gameController.updateValidation).toHaveBeenCalled();
    });

    it('calls networkController.setMode with solo', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.networkController.setMode).toHaveBeenCalledWith('solo');
    });

    it('does not build host offer for solo mode', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.networkController.buildHostOffer).not.toHaveBeenCalled();
    });

    it('ensures language dictionary', async () => {
      app = makeMockApp('solo');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.dictionaryController.ensureLanguage).toHaveBeenCalledWith('en');
    });

    it('sets timer deadline when timer is enabled in solo mode', async () => {
      app = makeMockApp('solo');
      (app.uiElements.timerEnabledToggle as unknown as { checked: boolean }).checked = true;
      (app.uiElements.timerInput as unknown as { value: string }).value = '3';
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.meta!.timerEnabled).toBe(true);
      expect(app.state.meta!.timerDurationSec).toBe(180);
      expect(app.state.meta!.turnDeadline).toBeGreaterThan(0);
    });

    it('sets minWordLength from input', async () => {
      app = makeMockApp('solo');
      (app.uiElements.minLengthInput as unknown as { value: string }).value = '3';
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.meta!.minWordLength).toBe(3);
    });
  });

  describe('startSession (host)', () => {
    it('creates game with host/client players and builds host offer', async () => {
      app = makeMockApp('host');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.gameController.start).toHaveBeenCalledWith('en', ['host', 'client']);
      expect(app.state.meta!.mode).toBe('host');
      expect(app.state.meta!.isHost).toBe(true);
      expect(app.state.meta!.localPlayerId).toBe('host');
      expect(app.state.meta!.remotePlayerId).toBe('client');
      expect(app.controllers.networkController.buildHostOffer).toHaveBeenCalled();
    });

    it('sets readyState for both players', async () => {
      app = makeMockApp('host');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.meta!.readyState).toEqual({ host: false, client: false });
    });

    it('sets gameStartAt to null', async () => {
      app = makeMockApp('host');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.meta!.gameStartAt).toBeNull();
    });

    it('does not set turnDeadline even if timer enabled (host waits for ready)', async () => {
      app = makeMockApp('host');
      (app.uiElements.timerEnabledToggle as unknown as { checked: boolean }).checked = true;
      (app.uiElements.timerInput as unknown as { value: string }).value = '5';
      const session = createSessionManager(app);

      await session.startSession();

      // shouldStartTimerNow is false for host mode
      expect(app.state.meta!.turnDeadline).toBeNull();
    });

    it('sets labels for both players', async () => {
      app = makeMockApp('host');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.state.labels['host']).toBe('Alice');
      expect(app.state.labels['client']).toBe('Bob');
    });
  });

  describe('startSession (client)', () => {
    it('only logs a message about joining', async () => {
      app = makeMockApp('client');
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.appendLog).toHaveBeenCalledWith(
        expect.stringContaining('Join mode')
      );
      expect(app.controllers.gameController.start).not.toHaveBeenCalled();
    });
  });

  describe('resumeSnapshot', () => {
    it('loads snapshot, resumes game, sets meta, calls propagateMeta', async () => {
      app = makeMockApp('solo');
      const fakeState = makeFakeGameState();
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session'
      };
      const fakeSnapshot: SnapshotPayload = {
        state: fakeState,
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.dictionaryController.ensureLanguage).toHaveBeenCalledWith('en');
      expect(app.state.meta).toBe(fakeMeta);
      expect(app.state.labels).toBe(fakeSnapshot.labels);
      expect(app.controllers.gameController.resume).toHaveBeenCalledWith(fakeState);
      expect(mockedPropagateMeta).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
    });

    it('does nothing when no pending snapshot', async () => {
      app = makeMockApp('solo');
      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(null);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.gameController.resume).not.toHaveBeenCalled();
    });

    it('starts timer ticker when timer is enabled with deadline', async () => {
      app = makeMockApp('solo');
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        timerEnabled: true,
        turnDeadline: Date.now() + 60000
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.timerController.startTimerTicker).toHaveBeenCalled();
    });

    it('stops timer ticker when timer is not enabled', async () => {
      app = makeMockApp('solo');
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        timerEnabled: false
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.timerController.stopTimerTicker).toHaveBeenCalled();
    });

    it('triggers reconnect for P2P sessions', async () => {
      app = makeMockApp('host');
      const fakeMeta: SessionMeta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session'
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { host: 'Alice', client: 'Bob' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.networkController.triggerReconnect).toHaveBeenCalled();
    });

    it('does not trigger reconnect for solo sessions', async () => {
      app = makeMockApp('solo');
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session'
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.controllers.networkController.triggerReconnect).not.toHaveBeenCalled();
    });

    it('sets language select and russian variant wrapper', async () => {
      app = makeMockApp('solo');
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'ru',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        russianDictionaryVariant: 'strict'
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.uiElements.languageSelect.value).toBe('ru');
      expect(app.uiElements.russianVariantWrapper.style.display).toBe('flex');
      expect(app.uiElements.russianVariantSelect.value).toBe('strict');
      expect(app.controllers.dictionaryController.downloadRuStrict).toHaveBeenCalled();
    });

    it('calls applyModeUIInternal and friends', async () => {
      app = makeMockApp('solo');
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: {
          mode: 'solo',
          language: 'en',
          isHost: true,
          localPlayerId: 'p1',
          sessionId: 'test-session'
        },
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.applyModeUIInternal).toHaveBeenCalled();
      expect(app.applyTimerInputFromMetaInternal).toHaveBeenCalled();
      expect(app.applyMinLengthInputFromMetaInternal).toHaveBeenCalled();
    });

    it('calls maybeShowTimeoutToastFromMeta and maybeShowGameOverToastFromMeta', async () => {
      app = makeMockApp('solo');
      const fakeMeta: SessionMeta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session'
      };
      const fakeSnapshot: SnapshotPayload = {
        state: makeFakeGameState(),
        meta: fakeMeta,
        labels: { p1: 'Alice' }
      };

      vi.mocked(app.controllers.storageController.getPendingSnapshot).mockReturnValue(fakeSnapshot);
      const session = createSessionManager(app);

      await session.resumeSnapshot();

      expect(app.maybeShowTimeoutToastFromMeta).toHaveBeenCalledWith(fakeMeta);
      expect(app.controllers.gameOverController.maybeShowGameOverToastFromMeta).toHaveBeenCalledWith(fakeMeta);
    });
  });

  describe('requestRematch (solo)', () => {
    it('calls restartForRematch directly', async () => {
      app = makeMockApp('solo');
      const fakeState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: { p1: 50 } }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      // restartForRematch resets the game
      expect(app.controllers.gameController.resetForRematch).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
    });

    it('does nothing when game is not over', async () => {
      app = makeMockApp('solo');
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session'
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.gameController.resetForRematch).not.toHaveBeenCalled();
    });

    it('does nothing when meta is null', async () => {
      app = makeMockApp('solo');
      app.state.meta = null;

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.gameController.resetForRematch).not.toHaveBeenCalled();
    });

    it('does nothing when no game state', async () => {
      app = makeMockApp('solo');
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(null);
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: { p1: 50 } }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.gameController.resetForRematch).not.toHaveBeenCalled();
    });
  });

  describe('requestRematch (host)', () => {
    it('applies rematch request, sends sync when not all confirmed', async () => {
      app = makeMockApp('host');
      const fakeState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      vi.mocked(app.controllers.gameOverController.allPlayersRequestedRematch).mockReturnValue(false);
      app.state.meta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.gameOverController.applyRematchRequest).toHaveBeenCalledWith('host', expect.any(Number));
      expect(app.renderAll).toHaveBeenCalled();
      expect(app.sendSync).toHaveBeenCalled();
      expect(app.controllers.storageController.persistSnapshot).toHaveBeenCalled();
    });

    it('calls restartForRematch when all players confirmed', async () => {
      app = makeMockApp('host');
      const fakeState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      vi.mocked(app.controllers.gameOverController.allPlayersRequestedRematch).mockReturnValue(true);
      app.state.meta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.gameController.resetForRematch).toHaveBeenCalled();
    });
  });

  describe('requestRematch (client)', () => {
    it('sends ACTION_REMATCH_REQUEST to host via network', async () => {
      app = makeMockApp('client');
      const fakeState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      vi.mocked(app.controllers.networkController.getConnection).mockReturnValue({} as unknown as ReturnType<typeof app.controllers.networkController.getConnection>);
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.networkController.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ACTION_REMATCH_REQUEST',
          playerId: 'client'
        })
      );
    });

    it('shows toast when not connected', async () => {
      app = makeMockApp('client');
      const fakeState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      vi.mocked(app.controllers.networkController.getConnection).mockReturnValue(null);
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.requestRematch();

      expect(app.controllers.toastManager.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Not connected'),
        'danger'
      );
      expect(app.controllers.networkController.send).not.toHaveBeenCalled();
    });
  });

  describe('restartForRematch', () => {
    it('resets game state and clears gameOver', async () => {
      app = makeMockApp('solo');
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: { p1: 50 } }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.controllers.gameController.resetForRematch).toHaveBeenCalledWith('en', expect.any(Array));
      expect(app.state.meta!.gameOver).toBeUndefined();
      expect(app.state.meta!.lastTurnEvent).toBeUndefined();
      expect(app.state.meta!.rematch).toBeUndefined();
    });

    it('does nothing when meta is null', async () => {
      app = makeMockApp('solo');
      app.state.meta = null;

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.controllers.gameController.resetForRematch).not.toHaveBeenCalled();
    });

    it('calls propagateMeta and persists snapshot', async () => {
      app = makeMockApp('solo');
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(mockedPropagateMeta).toHaveBeenCalled();
      expect(app.controllers.storageController.persistSnapshot).toHaveBeenCalled();
    });

    it('sends sync for non-solo mode', async () => {
      app = makeMockApp('host');
      app.state.meta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.sendSync).toHaveBeenCalled();
    });

    it('does not send sync for solo mode', async () => {
      app = makeMockApp('solo');
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.sendSync).not.toHaveBeenCalled();
    });

    it('resets endgame scan state', async () => {
      app = makeMockApp('solo');
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.controllers.endgameScanController.resetState).toHaveBeenCalled();
    });

    it('sets readyState when ready gate is enabled for 2-player game', async () => {
      app = makeMockApp('host');
      vi.mocked(app.controllers.readyGate.isReadyGateEnabled).mockReturnValue(true);
      const fakeState = makeFakeGameState({ players: ['host', 'client'] });
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(fakeState);
      app.state.meta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session',
        gameOver: { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} }
      };

      const session = createSessionManager(app);
      await session.restartForRematch();

      expect(app.state.meta!.readyState).toEqual({ host: true, client: true });
      expect(app.state.meta!.gameStartAt).toBeGreaterThan(0);
    });
  });

  describe('startSession with Russian language', () => {
    it('downloads ru strict when variant is strict', async () => {
      app = makeMockApp('solo');
      (app.uiElements.languageSelect as unknown as { value: string }).value = 'ru';
      (app.uiElements.russianVariantSelect as unknown as { value: string }).value = 'strict';
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.dictionaryController.ensureLanguage).toHaveBeenCalledWith('ru');
      expect(app.controllers.dictionaryController.downloadRuStrict).toHaveBeenCalled();
    });

    it('does not download ru strict when variant is full', async () => {
      app = makeMockApp('solo');
      (app.uiElements.languageSelect as unknown as { value: string }).value = 'ru';
      (app.uiElements.russianVariantSelect as unknown as { value: string }).value = 'full';
      const session = createSessionManager(app);

      await session.startSession();

      expect(app.controllers.dictionaryController.downloadRuStrict).not.toHaveBeenCalled();
    });
  });
});
