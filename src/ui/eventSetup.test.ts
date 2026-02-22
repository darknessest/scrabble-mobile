// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App, AppState } from '../app';
import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import type { UiElements } from './uiRenderer';
import type { AdditionalElements } from './domElements';
import type { SessionManager } from '../controllers/sessionManager';
import { makeMockControllers } from '../controllers/testFixtures';

vi.mock('./uiRenderer', () => ({
  renderNetworkStatus: vi.fn(),
  updateTimerSettingsUI: vi.fn()
}));

vi.mock('../utils/appUtils', () => ({
  copyToClipboard: vi.fn()
}));

import { setupEvents } from './eventSetup';

function makeFakeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    sessionId: 'test-session',
    language: 'en',
    board: Array.from({ length: 15 }, () =>
      Array.from({ length: 15 }, () => ({ tile: null, premium: null }))
    ),
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
    localPlayerId: 'host',
    remotePlayerId: 'client',
    sessionId: 'test-session',
    ...overrides
  };
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
  const el = document.createElement('select');
  for (const val of options) {
    const opt = document.createElement('option');
    opt.value = val;
    el.appendChild(opt);
  }
  return el;
}

function createSpan(): HTMLSpanElement {
  return document.createElement('span');
}

function createTextarea(): HTMLTextAreaElement {
  return document.createElement('textarea');
}

function createP(): HTMLParagraphElement {
  return document.createElement('p');
}

function createImg(): HTMLImageElement {
  return document.createElement('img');
}

function makeMockUiElements(): UiElements {
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
    versionEl: createP(),
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

function makeMockAdditional(): AdditionalElements {
  return {
    toastEl: createDiv(),
    copyOfferBtn: createButton(),
    offerText: createTextarea(),
    offerQr: createImg(),
    answerText: createTextarea(),
    scanAnswerBtn: createButton(),
    hostOfferInput: createTextarea(),
    scanOfferBtn: createButton(),
    clientAnswer: createTextarea(),
    copyClientAnswerBtn: createButton(),
    answerQr: createImg(),
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

function makeMockApp(metaOverride?: SessionMeta | null): App {
  const ctrls = makeMockControllers();
  const uiElements = makeMockUiElements();
  const additional = makeMockAdditional();

  return {
    state: {
      mode: 'host',
      meta: metaOverride !== undefined ? metaOverride : makeFakeHostMeta(),
      labels: { host: 'Player 1', client: 'Player 2' },
      settingsHidden: false,
      logsHidden: false,
      lastShownTurnEventToken: null
    } as AppState,
    controllers: ctrls,
    uiElements,
    additional,
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

function makeMockSession(): SessionManager {
  return {
    startSession: vi.fn().mockResolvedValue(undefined),
    resumeSnapshot: vi.fn().mockResolvedValue(undefined),
    restartForRematch: vi.fn().mockResolvedValue(undefined),
    requestRematch: vi.fn().mockResolvedValue(undefined)
  };
}

let app: App;
let session: SessionManager;

beforeEach(() => {
  vi.clearAllMocks();
  app = makeMockApp();
  session = makeMockSession();
  setupEvents(app, session);
});

describe('setupEvents', () => {
  describe('confirm move (host)', () => {
    it('calls submitMove when host has placements', async () => {
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue([
        { x: 7, y: 7, tile: { id: 't1', letter: 'A', value: 1, blank: false } }
      ]);

      app.uiElements.confirmMoveBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.gameController.submitMove).toHaveBeenCalled();
      });
    });

    it('logs message when no placements', async () => {
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue([]);

      app.uiElements.confirmMoveBtn.click();
      // Give the async handler a tick to run
      await Promise.resolve();

      expect(app.appendLog).toHaveBeenCalledWith('Place tiles before confirming.');
    });

    it('logs message when pre-game locked', async () => {
      vi.mocked(app.controllers.readyGate.isPreGameLocked).mockReturnValue(true);

      app.uiElements.confirmMoveBtn.click();
      await Promise.resolve();

      expect(app.appendLog).toHaveBeenCalledWith('Waiting for both players to be ready.');
    });
  });

  describe('confirm move (client)', () => {
    it('sends ACTION_MOVE to network when client', async () => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session'
      };

      const placements = [{ x: 7, y: 7, tile: { id: 't1', letter: 'A', value: 1, blank: false } }];
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue(placements);

      app.uiElements.confirmMoveBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.networkController.send).toHaveBeenCalledWith({
          type: 'ACTION_MOVE',
          placements,
          playerId: 'client'
        });
      });

      expect(app.controllers.gameController.clearPlacements).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
    });
  });

  describe('pass (host)', () => {
    it('calls submitPass when host', async () => {
      app.uiElements.passBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.gameController.submitPass).toHaveBeenCalled();
      });
    });

    it('logs message when pre-game locked', async () => {
      vi.mocked(app.controllers.readyGate.isPreGameLocked).mockReturnValue(true);

      app.uiElements.passBtn.click();
      await Promise.resolve();

      expect(app.appendLog).toHaveBeenCalledWith('Waiting for both players to be ready.');
    });
  });

  describe('pass (client)', () => {
    it('sends ACTION_PASS to network when client', async () => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session'
      };

      app.uiElements.passBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.networkController.send).toHaveBeenCalledWith({
          type: 'ACTION_PASS',
          playerId: 'client'
        });
      });
    });
  });

  describe('exchange (host)', () => {
    it('calls submitExchange when host has placements', async () => {
      const placements = [
        { x: 0, y: 0, tile: { id: 't1', letter: 'A', value: 1, blank: false } },
        { x: 1, y: 0, tile: { id: 't2', letter: 'B', value: 3, blank: false } }
      ];
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue(placements);

      app.uiElements.exchangeBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.gameController.submitExchange).toHaveBeenCalledWith(['t1', 't2']);
      });
    });

    it('uses selected tile when no placements', async () => {
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue([]);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t5');

      app.uiElements.exchangeBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.gameController.submitExchange).toHaveBeenCalledWith(['t5']);
      });
    });

    it('logs message when no tiles selected', async () => {
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue([]);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue(null);

      app.uiElements.exchangeBtn.click();
      await Promise.resolve();

      expect(app.appendLog).toHaveBeenCalledWith('Select a tile to exchange (tap a rack tile).');
    });

    it('logs message when pre-game locked', async () => {
      vi.mocked(app.controllers.readyGate.isPreGameLocked).mockReturnValue(true);

      app.uiElements.exchangeBtn.click();
      await Promise.resolve();

      expect(app.appendLog).toHaveBeenCalledWith('Waiting for both players to be ready.');
    });
  });

  describe('exchange (client)', () => {
    it('sends ACTION_EXCHANGE to network when client', async () => {
      app.state.meta = {
        mode: 'client',
        language: 'en',
        isHost: false,
        localPlayerId: 'client',
        remotePlayerId: 'host',
        sessionId: 'test-session'
      };
      const placements = [
        { x: 0, y: 0, tile: { id: 't1', letter: 'A', value: 1, blank: false } }
      ];
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue(placements);

      app.uiElements.exchangeBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.networkController.send).toHaveBeenCalledWith({
          type: 'ACTION_EXCHANGE',
          playerId: 'client',
          tileIds: ['t1']
        });
      });
    });
  });

  describe('board click', () => {
    function createBoardCell(x: number, y: number): HTMLDivElement {
      const cell = document.createElement('div');
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      return cell;
    }

    it('calls placeSelectedTileAt when tile is selected and cell is empty', () => {
      const gameState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(gameState);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(3, 4);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).toHaveBeenCalledWith(
        3, 4, expect.any(Function)
      );
    });

    it('calls removePlacementAt when no tile is selected', () => {
      const gameState = makeFakeGameState();
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(gameState);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue(null);

      const cell = createBoardCell(5, 6);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.removePlacementAt).toHaveBeenCalledWith(5, 6);
    });

    it('does nothing when cell already has a tile', () => {
      const gameState = makeFakeGameState();
      gameState.board[4][3] = { tile: { id: 'existing', letter: 'X', value: 8, blank: false }, premium: null } as unknown as typeof gameState.board[0][0];
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(gameState);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(3, 4);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });

    it('does nothing when game is over', () => {
      app.state.meta!.gameOver = { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} };
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(0, 0);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });

    it('does nothing when pre-game locked', () => {
      vi.mocked(app.controllers.readyGate.isPreGameLocked).mockReturnValue(true);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(0, 0);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });

    it('does nothing when not current player', () => {
      const gameState = makeFakeGameState({ currentPlayer: 'client' });
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(gameState);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(0, 0);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });

    it('does nothing when no game state', () => {
      vi.mocked(app.controllers.gameController.getState).mockReturnValue(null);
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(0, 0);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });

    it('does nothing when no meta', () => {
      app.state.meta = null;
      vi.mocked(app.controllers.gameController.getSelectedTileId).mockReturnValue('t1');

      const cell = createBoardCell(0, 0);
      app.uiElements.boardEl.appendChild(cell);

      cell.click();

      expect(app.controllers.gameController.placeSelectedTileAt).not.toHaveBeenCalled();
    });
  });

  describe('rack click', () => {
    it('sets selected tile when rack button is clicked', () => {
      const button = document.createElement('button');
      button.dataset.tile = 't3';
      app.uiElements.rackEl.appendChild(button);

      button.click();

      expect(app.controllers.gameController.setSelectedTileId).toHaveBeenCalledWith('t3');
      expect(app.renderAll).toHaveBeenCalled();
    });

    it('does nothing when pre-game locked', () => {
      vi.mocked(app.controllers.readyGate.isPreGameLocked).mockReturnValue(true);

      const button = document.createElement('button');
      button.dataset.tile = 't3';
      app.uiElements.rackEl.appendChild(button);

      button.click();

      expect(app.controllers.gameController.setSelectedTileId).not.toHaveBeenCalled();
    });
  });

  describe('clear placements', () => {
    it('calls clearPlacements on click', () => {
      app.uiElements.clearPlacementsBtn.click();

      expect(app.controllers.gameController.clearPlacements).toHaveBeenCalled();
    });
  });

  describe('mix rack', () => {
    it('calls shuffleRack and renderAll', () => {
      app.uiElements.mixRackBtn.click();

      expect(app.controllers.gameController.shuffleRack).toHaveBeenCalled();
      expect(app.renderAll).toHaveBeenCalled();
    });
  });

  describe('ready button', () => {
    it('calls markLocalReady', () => {
      app.uiElements.readyBtn.click();

      expect(app.markLocalReady).toHaveBeenCalled();
    });
  });

  describe('start and resume buttons', () => {
    it('start button calls session.startSession', () => {
      app.additional.startBtn.click();

      expect(session.startSession).toHaveBeenCalled();
    });

    it('resume button calls session.resumeSnapshot', () => {
      app.additional.resumeBtn.click();

      expect(session.resumeSnapshot).toHaveBeenCalled();
    });
  });

  describe('clear snapshot button', () => {
    it('calls storageController.clearSavedSnapshot', async () => {
      app.additional.clearSnapshotBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.storageController.clearSavedSnapshot).toHaveBeenCalled();
      });
    });
  });

  describe('request sync button', () => {
    it('sends REQUEST_SYNC message', () => {
      app.additional.requestSyncBtn.click();

      expect(app.controllers.networkController.send).toHaveBeenCalledWith({ type: 'REQUEST_SYNC' });
      expect(app.appendLog).toHaveBeenCalledWith('Requested sync from peer');
    });
  });

  describe('toggle buttons', () => {
    it('toggle setup toggles settingsHidden', () => {
      expect(app.state.settingsHidden).toBe(false);
      app.additional.toggleSetupBtn.click();
      expect(app.state.settingsHidden).toBe(true);
      expect(app.renderVisibilityInternal).toHaveBeenCalled();
    });

    it('toggle logs toggles logsHidden', () => {
      expect(app.state.logsHidden).toBe(false);
      app.additional.toggleLogsBtn.click();
      expect(app.state.logsHidden).toBe(true);
      expect(app.renderVisibilityInternal).toHaveBeenCalled();
    });
  });

  describe('language select change', () => {
    it('shows russian variant wrapper when ru selected', () => {
      app.uiElements.languageSelect.value = 'ru';
      app.uiElements.languageSelect.dispatchEvent(new Event('change'));

      expect(app.uiElements.russianVariantWrapper.style.display).toBe('flex');
    });

    it('hides russian variant wrapper when en selected', () => {
      app.uiElements.russianVariantWrapper.style.display = 'flex';
      app.uiElements.languageSelect.value = 'en';
      app.uiElements.languageSelect.dispatchEvent(new Event('change'));

      expect(app.uiElements.russianVariantWrapper.style.display).toBe('none');
    });
  });

  describe('min length input change', () => {
    it('sets min word length and sends sync when host', () => {
      app.uiElements.minLengthInput.value = '3';
      app.uiElements.minLengthInput.dispatchEvent(new Event('change'));

      expect(app.sendSync).toHaveBeenCalled();
    });
  });

  describe('view board / show results', () => {
    it('view board btn dismisses game over overlay', () => {
      app.uiElements.viewBoardBtn.click();

      expect(app.controllers.gameOverController.setGameOverOverlayDismissed).toHaveBeenCalledWith(true);
      expect(app.controllers.gameOverController.renderGameOverUi).toHaveBeenCalled();
    });

    it('show results btn shows game over overlay', () => {
      app.uiElements.showResultsBtn.click();

      expect(app.controllers.gameOverController.setGameOverOverlayDismissed).toHaveBeenCalledWith(false);
      expect(app.controllers.gameOverController.renderGameOverUi).toHaveBeenCalled();
    });
  });

  describe('rematch buttons', () => {
    it('overlay rematch button calls requestRematch', () => {
      app.uiElements.rematchBtnOverlay.click();

      expect(session.requestRematch).toHaveBeenCalled();
    });

    it('banner rematch button calls requestRematch', () => {
      app.uiElements.rematchBtnBanner.click();

      expect(session.requestRematch).toHaveBeenCalled();
    });
  });

  describe('confirm move calls finalizeGameEnd when game over', () => {
    it('calls finalizeGameEnd after successful host move when gameOver is set', async () => {
      vi.mocked(app.controllers.gameController.getPlacements).mockReturnValue([
        { x: 7, y: 7, tile: { id: 't1', letter: 'A', value: 1, blank: false } }
      ]);
      vi.mocked(app.controllers.gameController.submitMove).mockResolvedValue(true);
      // Set gameOver after submitMove is called
      app.state.meta!.gameOver = { reason: 'no_moves_bag_empty', at: Date.now(), moveNumber: 10, finalScores: {} };

      app.uiElements.confirmMoveBtn.click();
      await vi.waitFor(() => {
        expect(app.finalizeGameEnd).toHaveBeenCalled();
      });
    });
  });

  describe('solo mode works like host for actions', () => {
    it('calls submitPass in solo mode', async () => {
      app.state.meta = {
        mode: 'solo',
        language: 'en',
        isHost: true,
        localPlayerId: 'p1',
        sessionId: 'test-session'
      };

      app.uiElements.passBtn.click();
      await vi.waitFor(() => {
        expect(app.controllers.gameController.submitPass).toHaveBeenCalled();
      });
    });
  });
});
