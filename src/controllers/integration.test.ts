// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, AppState } from '../app';
import type { SessionMeta } from '../types';
import type { Controllers } from './controllerWiring';
import type { Placement } from '../core/types';
import type { UiElements } from '../ui/uiRenderer';
import type { AdditionalElements } from '../ui/domElements';
import { GameController } from './gameController';
import { TimerController } from './timerController';
import { createSessionManager } from './sessionManager';
import { createMessageHandler } from './messageHandler';
import { buildSyncStateForPeer } from '../utils/syncState';

vi.mock('../dictionary/dictionaryService', () => ({
  hasWord: vi.fn().mockResolvedValue(true)
}));

function createSpan(): HTMLSpanElement {
  return document.createElement('span');
}

function createP(): HTMLParagraphElement {
  return document.createElement('p');
}

function createButton(): HTMLButtonElement {
  return document.createElement('button');
}

function createDiv(): HTMLDivElement {
  return document.createElement('div');
}

function createInput(type = 'text'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  return input;
}

function createSelect(options: string[] = []): HTMLSelectElement {
  const select = document.createElement('select');
  for (const option of options) {
    const item = document.createElement('option');
    item.value = option;
    select.appendChild(item);
  }
  return select;
}

function createUiElements(): UiElements {
  return {
    boardEl: createDiv(),
    rackEl: createDiv(),
    rackOwnerEl: createSpan(),
    turnIndicator: createSpan(),
    timerDisplay: createSpan(),
    wordCheckStatus: createSpan(),
    wordLengthStatus: createSpan(),
    endgameScanStatus: createSpan(),
    scoresEl: createDiv(),
    logEl: createDiv(),
    bagCountEl: createSpan(),
    moveHistoryEl: createDiv(),
    settingsSection: createDiv(),
    confirmMoveBtn: createButton(),
    passBtn: createButton(),
    exchangeBtn: createButton(),
    clearPlacementsBtn: createButton(),
    mixRackBtn: createButton(),
    languageSelect: createSelect(['en', 'ru']),
    russianVariantSelect: createSelect(['full', 'strict']),
    russianVariantWrapper: createDiv(),
    minLengthInput: createInput('number'),
    timerEnabledToggle: createInput('checkbox'),
    timerMinutesWrapper: createDiv(),
    timerInput: createInput('number'),
    meInput: createInput(),
    peerInput: createInput(),
    modeTabs: createDiv(),
    hostCard: createDiv(),
    clientCard: createDiv(),
    languageWrapper: createDiv(),
    timerWrapper: createDiv(),
    offlineStatus: createSpan(),
    dictStatus: createSpan(),
    p2pStatus: createSpan(),
    versionEl: null,
    readyOverlay: createDiv(),
    readyStatusEl: createP(),
    readyBtn: createButton(),
    gameOverOverlay: createDiv(),
    gameOverReasonEl: createP(),
    gameOverScoresEl: createDiv(),
    gameOverStatsEl: createDiv(),
    rematchStatusEl: createP(),
    rematchBtnOverlay: createButton(),
    viewBoardBtn: createButton(),
    gameOverBanner: createDiv(),
    gameOverBannerScoresEl: createSpan(),
    rematchBannerStatusEl: createSpan(),
    rematchBtnBanner: createButton(),
    showResultsBtn: createButton(),
    disconnectOverlay: createDiv(),
    disconnectMessage: createP()
  };
}

function createAdditionalElements(): AdditionalElements {
  return {
    toastEl: createDiv(),
    copyOfferBtn: createButton(),
    offerText: createDiv() as unknown as HTMLTextAreaElement,
    offerQr: document.createElement('img'),
    answerText: createDiv() as unknown as HTMLTextAreaElement,
    scanAnswerBtn: createButton(),
    hostOfferInput: createDiv() as unknown as HTMLTextAreaElement,
    scanOfferBtn: createButton(),
    clientAnswer: createDiv() as unknown as HTMLTextAreaElement,
    copyClientAnswerBtn: createButton(),
    answerQr: document.createElement('img'),
    refreshDictsBtn: createButton(),
    downloadEnBtn: createButton(),
    downloadRuBtn: createButton(),
    downloadRuStrictBtn: createButton(),
    dictEnIcon: createSpan(),
    dictRuIcon: createSpan(),
    dictRuStrictIcon: createSpan(),
    requestSyncBtn: createButton(),
    toggleSetupBtn: createButton(),
    toggleLogsBtn: createButton(),
    startBtn: createButton(),
    resumeBtn: createButton(),
    clearSnapshotBtn: createButton(),
    resumeNote: createP(),
    forceReloadBtn: createButton()
  };
}

function makeControllers(gameController: GameController): Controllers {
  return {
    gameController,
    networkController: {
      setMode: vi.fn(),
      setMeta: vi.fn(),
      setCurrentState: vi.fn(),
      setLabels: vi.fn(),
      send: vi.fn(),
      getConnection: vi.fn().mockReturnValue(null),
      setOnMessage: vi.fn(),
      setOnOpen: vi.fn(),
      setOnClose: vi.fn(),
      setOnError: vi.fn(),
      setOnConnectionStateChange: vi.fn(),
      buildHostOffer: vi.fn().mockResolvedValue(undefined),
      buildClientAnswer: vi.fn(),
      applyHostAnswer: vi.fn(),
      setupAutoBuildClientAnswer: vi.fn(),
      setupAutoApplyHostAnswer: vi.fn(),
      triggerReconnect: vi.fn().mockResolvedValue(undefined)
    },
    timerController: new TimerController(createSpan()),
    readyGate: {
      isReadyGateEnabled: vi.fn().mockReturnValue(false),
      maybeScheduleGameStartFromReady: vi.fn(),
      isPreGameLocked: vi.fn().mockReturnValue(false),
      setMeta: vi.fn(),
      setCurrentState: vi.fn(),
      setLabels: vi.fn(),
      setOnUnlock: vi.fn()
    },
    storageController: {
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      checkSavedSnapshot: vi.fn(),
      clearSavedSnapshot: vi.fn(),
      getPendingSnapshot: vi.fn().mockReturnValue(null)
    },
    gameOverController: {
      maybeShowGameOverToastFromMeta: vi.fn(),
      applyRematchRequest: vi.fn(),
      allPlayersRequestedRematch: vi.fn().mockReturnValue(false),
      setMeta: vi.fn(),
      setCurrentState: vi.fn(),
      setLabels: vi.fn(),
      setGameOverOverlayDismissed: vi.fn(),
      renderGameOverUi: vi.fn()
    },
    dictionaryController: {
      ensureLanguage: vi.fn().mockResolvedValue(undefined),
      downloadRuStrict: vi.fn().mockResolvedValue(undefined),
      refreshDictStatus: vi.fn(),
      downloadLanguage: vi.fn().mockResolvedValue(undefined)
    },
    endgameScanController: {
      resetState: vi.fn(),
      setMeta: vi.fn(),
      setCurrentState: vi.fn(),
      setOnGameEnd: vi.fn()
    },
    toastManager: {
      showToast: vi.fn()
    },
    qrScanner: {
      scanInto: vi.fn()
    },
    blankTileSelector: {
      selectBlankLetter: vi.fn()
    }
  } as unknown as Controllers;
}

function makeApp(mode: 'solo' | 'host' | 'client' = 'host'): {
  app: App;
  controllers: Controllers;
  gameController: GameController;
} {
  const gameController = new GameController(vi.fn());
  const uiElements = createUiElements();
  const additional = createAdditionalElements();
  const controllers = makeControllers(gameController);

  const app: App = {
    state: {
      mode,
      meta: null,
      labels: {},
      settingsHidden: false,
      logsHidden: false,
      lastShownTurnEventToken: null
    } as AppState,
    controllers,
    uiElements,
    additional,
    appendLog: vi.fn(),
    renderAll: vi.fn(),
    sendSync: vi.fn(),
    checkAndHandleGameEnd: vi.fn(),
    markLocalReady: vi.fn(),
    maybeShowTimeoutToastFromMeta: vi.fn(),
    applyModeUIInternal: vi.fn(),
    applyTimerInputFromMetaInternal: vi.fn(),
    applyMinLengthInputFromMetaInternal: vi.fn(),
    renderVisibilityInternal: vi.fn(),
    finalizeGameEnd: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn()
  };

  uiElements.languageSelect.value = 'en';
  uiElements.minLengthInput.value = '2';
  uiElements.timerEnabledToggle.checked = false;
  uiElements.timerInput.value = '5';
  uiElements.meInput.value = 'Player 1';
  uiElements.peerInput.value = 'Player 2';

  return { app, controllers, gameController };
}

describe('Integration coverage for gameplay message and timer flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flows from startSession through move, passes, game end, and rematch', async () => {
    const { app, gameController } = makeApp('host');
    const session = createSessionManager(app);

    await session.startSession();
    const stateAfterStart = gameController.getState();
    expect(stateAfterStart).toBeTruthy();

    (gameController as unknown as { placements: Placement[] }).placements = [
      { x: 7, y: 7, tile: stateAfterStart!.racks.host[0] },
      { x: 7, y: 8, tile: stateAfterStart!.racks.host[1] }
    ];
    const moveResult = await gameController.submitMove(gameController.buildWordChecker.bind(gameController));
    expect(moveResult).toBe(true);

    expect(gameController.submitPass('client')).toBe(true);
    expect(gameController.submitPass('host')).toBe(true);
    expect(gameController.submitPass('client')).toBe(true);
    expect(gameController.submitPass('host')).toBe(true);

    expect(app.state.meta!.gameOver?.reason).toBe('four_passes');

    const sessionIdBeforeRematch = gameController.getState()!.sessionId;
    vi.mocked(app.controllers.gameOverController.allPlayersRequestedRematch).mockReturnValue(true);

    await session.requestRematch();

    expect(app.state.meta!.gameOver).toBeUndefined();
    expect(gameController.getState()!.sessionId).not.toBe(sessionIdBeforeRematch);
    expect(app.sendSync).toHaveBeenCalled();
  });

  it('round-trips SYNC_STATE from host then ACTION_MOVE from client and host applies remote move', async () => {
    const hostContext = makeApp('host');
    const clientContext = makeApp('client');

    const hostSession = createSessionManager(hostContext.app);
    const clientSession = createSessionManager(clientContext.app);

    const hostMessageHandler = createMessageHandler(hostContext.app, hostSession.restartForRematch);
    const clientMessageHandler = createMessageHandler(clientContext.app, clientSession.restartForRematch);

    hostContext.controllers.networkController.send = vi.fn(async (message) => {
      await clientMessageHandler(message as never);
    });
    clientContext.controllers.networkController.send = vi.fn(async (message) => {
      await hostMessageHandler(message as never);
    });

    await hostSession.startSession();

    const hostState = hostContext.gameController.getState()!;
    await hostContext.controllers.networkController.send({
      type: 'SYNC_STATE',
      state: buildSyncStateForPeer(hostState, hostContext.app.state.meta!),
      meta: hostContext.app.state.meta!,
      labels: hostContext.app.state.labels
    } as never);

    await vi.waitFor(() => {
      expect(clientContext.app.state.meta).toEqual(expect.objectContaining({
        mode: 'client',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host'
      }));
    });

    const syncedHostState = hostContext.gameController.getState()!;
    (hostContext.gameController as unknown as { placements: Placement[] }).placements = [
      { x: 7, y: 7, tile: syncedHostState.racks.host[0] },
      { x: 7, y: 8, tile: syncedHostState.racks.host[1] }
    ];
    await hostContext.gameController.submitMove(hostContext.gameController.buildWordChecker.bind(hostContext.gameController));

    const stateAfterHostMove = hostContext.gameController.getState()!;
    await hostContext.controllers.networkController.send({
      type: 'SYNC_STATE',
      state: buildSyncStateForPeer(stateAfterHostMove, hostContext.app.state.meta!),
      meta: hostContext.app.state.meta!,
      labels: hostContext.app.state.labels
    } as never);

    await vi.waitFor(() => {
      expect(clientContext.gameController.getState()!.currentPlayer).toBe('client');
    });

    const clientState = clientContext.gameController.getState()!;
    const remoteMove: Placement[] = [
      { x: 7, y: 6, tile: clientState.racks.client[0] }
    ];
    const remoteMoveSpy = vi.spyOn(hostContext.gameController, 'submitRemoteMove');

    await clientContext.controllers.networkController.send({
      type: 'ACTION_MOVE',
      playerId: 'client',
      placements: remoteMove
    } as never);

    await vi.waitFor(() => {
      expect(remoteMoveSpy).toHaveBeenCalledWith(
        remoteMove,
        'client',
        expect.any(Function)
      );
    });

    expect(hostContext.gameController.getState()!.currentPlayer).toBe('host');
  });

  it('fires auto-pass when timer expires through timer->auto-pass callback chain', async () => {
    const { app, gameController } = makeApp('host');

    const state = gameController.start('en', ['host', 'client']);
    const turnMeta: SessionMeta = {
      mode: 'host',
      language: 'en',
      isHost: true,
      localPlayerId: 'host',
      remotePlayerId: 'client',
      sessionId: state.sessionId,
      timerEnabled: true,
      timerDurationSec: 300,
      turnDeadline: Date.now() - 10
    };

    app.state.meta = turnMeta;
    app.controllers.gameController.setMeta(turnMeta);
    app.controllers.timerController.setMeta(turnMeta);

    const persistSpy = vi.fn().mockResolvedValue(undefined);
    const syncSpy = vi.fn();
    app.controllers.gameController.setOnPersist(persistSpy);
    app.controllers.gameController.setOnSync(syncSpy);

    app.controllers.timerController.setOnTimeout(() => {
      void app.controllers.gameController.maybeAutoPassOnTimeout();
    });

    expect(gameController.getState()!.currentPlayer).toBe('host');

    app.controllers.timerController.startTimerTicker();

    await vi.waitFor(() => {
      expect(gameController.getState()!.currentPlayer).toBe('client');
    });

    expect(app.state.meta!.turnDeadline).toBeNull();
    expect(app.state.meta!.lastTurnEvent?.type).toBe('timeout');
    expect(persistSpy).toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalled();

    app.controllers.timerController.stopTimerForGameOver();
  });
});
