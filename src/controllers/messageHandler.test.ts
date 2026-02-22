import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, AppState } from '../app';
import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import type { Controllers } from './controllerWiring';
import type { UiElements } from '../ui/uiRenderer';
import type { AdditionalElements } from '../ui/domElements';
import { makeMockControllers } from './testFixtures';

vi.mock('./controllerBus', () => ({
  propagateMeta: vi.fn()
}));

import { propagateMeta } from './controllerBus';
import { createMessageHandler } from './messageHandler';

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

  function makeFakeHostMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
    return {
      mode: 'host',
      language: 'en',
      isHost: true,
      gameStartAt: Date.now(),
      localPlayerId: 'host',
      remotePlayerId: 'client',
      sessionId: 'test-session',
      ...overrides
    };
  }

function makeMockUiElements(): UiElements {
  return {
    languageSelect: { value: 'en' },
    russianVariantWrapper: { style: { display: '' } },
    russianVariantSelect: { value: 'full' },
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
    minLengthInput: { value: '2' },
    timerEnabledToggle: { checked: false },
    timerMinutesWrapper: {},
    timerInput: { value: '5' },
    meInput: { value: 'Player 1' },
    peerInput: { value: 'Player 2' },
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

function makeMockApp(
  metaOverride?: SessionMeta | null,
  controllers?: Controllers
): App {
  const ctrls = controllers ?? makeMockControllers();
  const app: App = {
    state: {
      mode: 'host',
      meta: metaOverride !== undefined ? metaOverride : makeFakeHostMeta(),
      labels: { host: 'Player 1', client: 'Player 2' },
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
  return app;
}

let app: App;
let handleMessage: (data: unknown) => Promise<void>;
let restartForRematch: (() => Promise<void>) & { mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.clearAllMocks();
  app = makeMockApp();
  const fn = vi.fn().mockResolvedValue(undefined);
  restartForRematch = fn as unknown as typeof restartForRematch;
  handleMessage = createMessageHandler(app, restartForRematch);
});

  describe('createMessageHandler', () => {
  describe('invalid messages', () => {
    it('ignores null', async () => {
      await handleMessage(null);
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores non-object', async () => {
      await handleMessage('hello');
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores object without type', async () => {
      await handleMessage({ foo: 'bar' });
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores object with unknown type', async () => {
      await handleMessage({ type: 'UNKNOWN_TYPE' });
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores undefined', async () => {
      await handleMessage(undefined);
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores number', async () => {
      await handleMessage(42);
      expect(app.renderAll).not.toHaveBeenCalled();
    });

    it('ignores ACTION_MOVE missing placements', async () => {
      await handleMessage({ type: 'ACTION_MOVE', playerId: 'client' });
      expect(app.controllers.gameController.submitRemoteMove).not.toHaveBeenCalled();
    });

    it('ignores ACTION_MOVE missing playerId', async () => {
      await handleMessage({ type: 'ACTION_MOVE', placements: [] });
      expect(app.controllers.gameController.submitRemoteMove).not.toHaveBeenCalled();
    });

    it('ignores ACTION_EXCHANGE missing tileIds', async () => {
      await handleMessage({ type: 'ACTION_EXCHANGE', playerId: 'client' });
      expect(app.controllers.gameController.submitExchange).not.toHaveBeenCalled();
    });

    it('ignores SYNC_STATE missing state', async () => {
      await handleMessage({ type: 'SYNC_STATE', meta: {} });
      expect(app.controllers.gameController.resume).not.toHaveBeenCalled();
    });

    it('ignores SYNC_STATE missing meta', async () => {
      await handleMessage({ type: 'SYNC_STATE', state: {} });
      expect(app.controllers.gameController.resume).not.toHaveBeenCalled();
    });
  });

  describe('SYNC_STATE', () => {
    it('constructs client meta from host meta with swapped player IDs', async () => {
      const incomingState = makeFakeGameState();
      const incomingMeta: SessionMeta = {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 'test-session'
      };
      const incomingLabels = { host: 'Host Player', client: 'Client Player' };

      await handleMessage({
        type: 'SYNC_STATE',
        state: incomingState,
        meta: incomingMeta,
        labels: incomingLabels
      });

      const newMeta = app.state.meta!;
      expect(newMeta.mode).toBe('client');
      expect(newMeta.isHost).toBe(false);
      expect(newMeta.localPlayerId).toBe('client');
      expect(newMeta.remotePlayerId).toBe('host');
    });

    it('resumes game state and calls propagateMeta', async () => {
      const incomingState = makeFakeGameState();
      const incomingMeta = makeFakeHostMeta();
      const incomingLabels = { host: 'P1', client: 'P2' };

      await handleMessage({
        type: 'SYNC_STATE',
        state: incomingState,
        meta: incomingMeta,
        labels: incomingLabels
      });

      expect(app.controllers.gameController.resume).toHaveBeenCalledWith(incomingState);
      expect(mockedPropagateMeta).toHaveBeenCalledWith(
        app.controllers,
        app.state.meta,
        incomingState,
        incomingLabels
      );
    });

    it('sets labels on app state', async () => {
      const incomingLabels = { host: 'Alice', client: 'Bob' };
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: makeFakeHostMeta(),
        labels: incomingLabels
      });

      expect(app.state.labels).toBe(incomingLabels);
    });

    it('updates language select and mode UI', async () => {
      const incomingMeta = makeFakeHostMeta({ language: 'ru', russianDictionaryVariant: 'strict' });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.uiElements.languageSelect.value).toBe('ru');
      expect(app.uiElements.russianVariantWrapper.style.display).toBe('flex');
      expect(app.uiElements.russianVariantSelect.value).toBe('strict');
      expect(app.applyModeUIInternal).toHaveBeenCalled();
    });

    it('hides russian variant wrapper for non-ru language', async () => {
      const incomingMeta = makeFakeHostMeta({ language: 'en' });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.uiElements.russianVariantWrapper.style.display).toBe('none');
    });

    it('starts timer ticker when timer is enabled with deadline', async () => {
      const deadline = Date.now() + 60000;
      const incomingMeta = makeFakeHostMeta({
        timerEnabled: true,
        turnDeadline: deadline
      });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.controllers.timerController.startTimerTicker).toHaveBeenCalled();
    });

    it('stops timer ticker when timer is not enabled', async () => {
      const incomingMeta = makeFakeHostMeta({ timerEnabled: false });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.controllers.timerController.stopTimerTicker).toHaveBeenCalled();
    });

    it('persists snapshot and calls renderAll', async () => {
      const incomingState = makeFakeGameState();
      const incomingLabels = { host: 'P1' };
      await handleMessage({
        type: 'SYNC_STATE',
        state: incomingState,
        meta: makeFakeHostMeta(),
        labels: incomingLabels
      });

      expect(app.controllers.storageController.persistSnapshot).toHaveBeenCalledWith(
        incomingState,
        app.state.meta,
        incomingLabels
      );
      expect(app.renderAll).toHaveBeenCalled();
      expect(app.controllers.gameController.updateValidation).toHaveBeenCalled();
    });

    it('ensures language dictionary is loaded', async () => {
      const incomingMeta = makeFakeHostMeta({ language: 'ru', russianDictionaryVariant: 'strict' });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.controllers.dictionaryController.ensureLanguage).toHaveBeenCalledWith('ru');
      expect(app.controllers.dictionaryController.downloadRuStrict).toHaveBeenCalled();
    });

    it('does not download ru strict for non-strict variant', async () => {
      const incomingMeta = makeFakeHostMeta({ language: 'ru', russianDictionaryVariant: 'full' });
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.controllers.dictionaryController.downloadRuStrict).not.toHaveBeenCalled();
    });

    it('calls maybeShowTimeoutToastFromMeta and maybeShowGameOverToastFromMeta', async () => {
      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: makeFakeHostMeta(),
        labels: {}
      });

      expect(app.maybeShowTimeoutToastFromMeta).toHaveBeenCalledWith(app.state.meta);
      expect(app.controllers.gameOverController.maybeShowGameOverToastFromMeta).toHaveBeenCalledWith(app.state.meta);
    });

    it('handles non-host incoming meta by copying as-is with isHost false', async () => {
      const incomingMeta: SessionMeta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session'
      };

      await handleMessage({
        type: 'SYNC_STATE',
        state: makeFakeGameState(),
        meta: incomingMeta,
        labels: {}
      });

      expect(app.state.meta!.isHost).toBe(false);
    });
  });

  describe('ACTION_MOVE (host)', () => {
    it('calls submitRemoteMove with placements and remotePlayerId', async () => {
      const placements = [{ x: 7, y: 7, tile: { id: 't1', letter: 'A', value: 1, blank: false } }];
      await handleMessage({
        type: 'ACTION_MOVE',
        placements,
        playerId: 'client'
      });

      expect(app.controllers.gameController.setRemoteDraft).toHaveBeenCalledWith(null);
      expect(app.controllers.gameController.submitRemoteMove).toHaveBeenCalledWith(
        placements,
        'client',
        expect.any(Function)
      );
    });

    it('ignores spoofed playerId and uses remotePlayerId from meta', async () => {
      app.state.meta = makeFakeHostMeta({ remotePlayerId: 'real-client' });
      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'spoofed-host-id'
      });

      expect(app.controllers.gameController.submitRemoteMove).toHaveBeenCalledWith(
        [],
        'real-client',
        expect.any(Function)
      );
    });

    it('calls checkAndHandleGameEnd when move succeeds and game is not over', async () => {
      vi.mocked(app.controllers.gameController.submitRemoteMove).mockResolvedValue(true);

      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'client'
      });

      expect(app.checkAndHandleGameEnd).toHaveBeenCalled();
    });

    it('calls finalizeGameEnd when move succeeds and game is over', async () => {
      app.state.meta!.gameOver = { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} };
      vi.mocked(app.controllers.gameController.submitRemoteMove).mockResolvedValue(true);

      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'client'
      });

      expect(app.finalizeGameEnd).toHaveBeenCalled();
    });

    it('does not call checkAndHandleGameEnd when move fails', async () => {
      vi.mocked(app.controllers.gameController.submitRemoteMove).mockResolvedValue(false);

      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'client'
      });

      expect(app.checkAndHandleGameEnd).not.toHaveBeenCalled();
    });

    it('ensures language before processing move', async () => {
      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'client'
      });

      expect(app.controllers.dictionaryController.ensureLanguage).toHaveBeenCalledWith('en');
    });
  });

  describe('ACTION_PASS (host)', () => {
    it('calls submitPass with remotePlayerId', async () => {
      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'client'
      });

      expect(app.controllers.gameController.setRemoteDraft).toHaveBeenCalledWith(null);
      expect(app.controllers.gameController.submitPass).toHaveBeenCalledWith('client');
    });

    it('ignores spoofed playerId and uses remotePlayerId from meta', async () => {
      app.state.meta = makeFakeHostMeta({ remotePlayerId: 'real-client' });
      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'spoofed-host-id'
      });

      expect(app.controllers.gameController.submitPass).toHaveBeenCalledWith('real-client');
    });

    it('calls checkAndHandleGameEnd on success when game is not over', async () => {
      vi.mocked(app.controllers.gameController.submitPass).mockResolvedValue(true);

      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'client'
      });

      expect(app.checkAndHandleGameEnd).toHaveBeenCalled();
    });

    it('calls finalizeGameEnd on success when game is over', async () => {
      app.state.meta!.gameOver = { reason: 'four_passes', at: Date.now(), moveNumber: 10, finalScores: {} };
      vi.mocked(app.controllers.gameController.submitPass).mockResolvedValue(true);

      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'client'
      });

      expect(app.finalizeGameEnd).toHaveBeenCalled();
    });
  });

  describe('ACTION_EXCHANGE (host)', () => {
    it('calls submitExchange with tileIds and remotePlayerId', async () => {
      const tileIds = ['t1', 't2'];
      await handleMessage({
        type: 'ACTION_EXCHANGE',
        tileIds,
        playerId: 'client'
      });

      expect(app.controllers.gameController.setRemoteDraft).toHaveBeenCalledWith(null);
      expect(app.controllers.gameController.submitExchange).toHaveBeenCalledWith(tileIds, 'client');
    });

    it('ignores spoofed playerId and uses remotePlayerId from meta', async () => {
      app.state.meta = makeFakeHostMeta({ remotePlayerId: 'real-client' });
      await handleMessage({
        type: 'ACTION_EXCHANGE',
        tileIds: ['t1'],
        playerId: 'spoofed-host-id'
      });

      expect(app.controllers.gameController.submitExchange).toHaveBeenCalledWith(['t1'], 'real-client');
    });

    it('calls checkAndHandleGameEnd on success', async () => {
      vi.mocked(app.controllers.gameController.submitExchange).mockResolvedValue(true);

      await handleMessage({
        type: 'ACTION_EXCHANGE',
        tileIds: ['t1'],
        playerId: 'client'
      });

      expect(app.checkAndHandleGameEnd).toHaveBeenCalled();
    });
  });

  describe('host action identity guard', () => {
    it('ignores action messages when remotePlayerId is missing', async () => {
      app.state.meta = makeFakeHostMeta({ remotePlayerId: '' });

      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'client'
      });

      expect(app.controllers.gameController.submitPass).not.toHaveBeenCalled();
      expect(app.appendLog).toHaveBeenCalledWith('Missing remote player id; ignoring action.');
    });
  });

  describe('non-host ignores actions', () => {
    beforeEach(() => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session'
      };
    });

    it('ignores ACTION_MOVE when not host', async () => {
      await handleMessage({
        type: 'ACTION_MOVE',
        placements: [],
        playerId: 'host'
      });

      expect(app.controllers.gameController.submitRemoteMove).not.toHaveBeenCalled();
      expect(app.appendLog).toHaveBeenCalledWith('Received action but not host; ignoring.');
    });

    it('ignores ACTION_PASS when not host', async () => {
      await handleMessage({
        type: 'ACTION_PASS',
        playerId: 'host'
      });

      expect(app.controllers.gameController.submitPass).not.toHaveBeenCalled();
    });

    it('ignores ACTION_EXCHANGE when not host', async () => {
      await handleMessage({
        type: 'ACTION_EXCHANGE',
        tileIds: ['t1'],
        playerId: 'host'
      });

      expect(app.controllers.gameController.submitExchange).not.toHaveBeenCalled();
    });

    it('ignores ACTION_REMATCH_REQUEST when not host', async () => {
      await handleMessage({
        type: 'ACTION_REMATCH_REQUEST',
        playerId: 'host',
        at: Date.now()
      });

      expect(app.controllers.gameOverController.applyRematchRequest).not.toHaveBeenCalled();
    });
  });

    describe('PLAYER_READY', () => {
      beforeEach(() => {
        vi.mocked(app.controllers.readyGate.isReadyGateEnabled).mockReturnValue(true);
      });

      it('calls maybeScheduleGameStartFromReady and sends sync', async () => {
        app.state.meta = makeFakeHostMeta({ readyState: {} });

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'client',
        ready: true
      });

      expect(app.state.meta!.readyState!['client']).toBe(true);
      expect(app.controllers.readyGate.maybeScheduleGameStartFromReady).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
      expect(app.sendSync).toHaveBeenCalled();
    });

    it('initializes readyState if undefined', async () => {
      app.state.meta = makeFakeHostMeta();
      delete app.state.meta.readyState;

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'client',
        ready: true
      });

      expect(app.state.meta!.readyState).toBeDefined();
      expect(app.state.meta!.readyState!['client']).toBe(true);
    });

    it('ignores if not host', async () => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        sessionId: 'test-session'
      };

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'host',
        ready: true
      });

      expect(app.controllers.readyGate.maybeScheduleGameStartFromReady).not.toHaveBeenCalled();
    });

    it('ignores if no game state', async () => {
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(null);

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'client',
        ready: true
      });

      expect(app.controllers.readyGate.maybeScheduleGameStartFromReady).not.toHaveBeenCalled();
    });

    it('ignores if ready gate is not enabled', async () => {
      vi.mocked(app.controllers.readyGate.isReadyGateEnabled).mockReturnValue(false);

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'client',
        ready: true
      });

      expect(app.controllers.readyGate.maybeScheduleGameStartFromReady).not.toHaveBeenCalled();
    });

    it('persists snapshot after updating readyState', async () => {
      app.state.meta = makeFakeHostMeta({ readyState: {} });

      await handleMessage({
        type: 'PLAYER_READY',
        playerId: 'client',
        ready: true
      });

      expect(app.controllers.storageController.persistSnapshot).toHaveBeenCalled();
    });
  });

  describe('REQUEST_SYNC', () => {
    it('calls sendSync when host has game state', async () => {
      await handleMessage({ type: 'REQUEST_SYNC' });

      expect(app.sendSync).toHaveBeenCalled();
    });

    it('does not call sendSync when not host', async () => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        sessionId: 'test-session'
      };

      await handleMessage({ type: 'REQUEST_SYNC' });

      expect(app.sendSync).not.toHaveBeenCalled();
    });

    it('does not call sendSync when no game state', async () => {
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(null);

      await handleMessage({ type: 'REQUEST_SYNC' });

      expect(app.sendSync).not.toHaveBeenCalled();
    });
  });

  describe('DRAFT_PLACEMENTS', () => {
    it('calls setRemoteDraft with draft data', async () => {
      const placements = [{ x: 3, y: 3, tile: { id: 't1', letter: 'B', value: 3, blank: false } }];
      await handleMessage({
        type: 'DRAFT_PLACEMENTS',
        playerId: 'client',
        placements,
        moveNumber: 5
      });

      expect(app.controllers.gameController.setRemoteDraft).toHaveBeenCalledWith({
        playerId: 'client',
        placements,
        moveNumber: 5
      });
      expect(app.renderAll).toHaveBeenCalled();
    });

    it('ignores when no game state', async () => {
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(null);

      await handleMessage({
        type: 'DRAFT_PLACEMENTS',
        playerId: 'client',
        placements: [],
        moveNumber: 1
      });

      expect(app.controllers.gameController.setRemoteDraft).not.toHaveBeenCalled();
    });
  });

  describe('ACTION_REMATCH_REQUEST', () => {
    it('applies rematch request and sends sync when not all confirmed', async () => {
      app.state.meta!.gameOver = { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} };
      vi.mocked(app.controllers.gameOverController.allPlayersRequestedRematch).mockReturnValue(false);

      await handleMessage({
        type: 'ACTION_REMATCH_REQUEST',
        playerId: 'client',
        at: 12345
      });

      expect(app.controllers.gameOverController.applyRematchRequest).toHaveBeenCalledWith('client', 12345);
      expect(app.renderAll).toHaveBeenCalled();
      expect(app.sendSync).toHaveBeenCalled();
    });

    it('calls restartForRematch when all players confirmed', async () => {
      app.state.meta!.gameOver = { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} };
      vi.mocked(app.controllers.gameOverController.allPlayersRequestedRematch).mockReturnValue(true);

      await handleMessage({
        type: 'ACTION_REMATCH_REQUEST',
        playerId: 'client',
        at: 12345
      });

      expect(restartForRematch).toHaveBeenCalled();
    });

    it('ignores when game is not over', async () => {
      delete app.state.meta!.gameOver;

      await handleMessage({
        type: 'ACTION_REMATCH_REQUEST',
        playerId: 'client',
        at: 12345
      });

      expect(app.controllers.gameOverController.applyRematchRequest).not.toHaveBeenCalled();
    });
  });
});
