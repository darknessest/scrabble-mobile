import type { App } from '../app';
import type { SessionManager } from '../controllers/sessionManager';
import { copyToClipboard } from '../utils/appUtils';
import { renderNetworkStatus, updateTimerSettingsUI } from './uiRenderer';

export function setupEvents(app: App, session: SessionManager): void {
  const { uiElements, additional, controllers, state } = app;
  const {
    gameController, networkController, storageController,
    dictionaryController, readyGate, gameOverController,
    qrScanner, blankTileSelector
  } = controllers;

  const showError = (message: string): void => {
    app.appendLog(message);
    app.showToast(message, 'danger');
  };

  window.addEventListener('online', () => {
    renderNetworkStatus(uiElements.offlineStatus);
    void dictionaryController.refreshDictStatus();
  });
  window.addEventListener('offline', () => {
    renderNetworkStatus(uiElements.offlineStatus);
    void dictionaryController.refreshDictStatus();
  });
  app.appendLog('Tips: both devices on same Wi-Fi, no VPN; host creates offer, client returns answer; host applies answer.');

  additional.forceReloadBtn.addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      app.appendLog('Service workers unregistered');
    }
    window.location.reload();
  });

  uiElements.modeTabs.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!target) return;
    state.mode = target.dataset.mode as typeof state.mode;
    app.applyModeUIInternal();
  });

  uiElements.languageSelect.addEventListener('change', () => {
    const language = uiElements.languageSelect.value;
    if (state.meta) {
      state.meta.language = language as typeof state.meta.language;
    }
    uiElements.russianVariantWrapper.style.display = language === 'ru' ? 'flex' : 'none';
  });

  uiElements.russianVariantSelect.addEventListener('change', () => {
    if (state.meta) {
      state.meta.russianDictionaryVariant = uiElements.russianVariantSelect.value as 'full' | 'strict';
    }
  });

  additional.startBtn.addEventListener('click', () => void session.startSession());
  additional.resumeBtn.addEventListener('click', () => void session.resumeSnapshot());
  additional.clearSnapshotBtn.addEventListener('click', async () => {
    await storageController.clearSavedSnapshot();
  });

  uiElements.confirmMoveBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      showError('Waiting for both players to be ready.');
      return;
    }
    if (gameController.getPlacements().length === 0) {
      showError('Place tiles before confirming.');
      return;
    }

    const meta = state.meta;
    if (meta?.isHost || meta?.mode === 'solo') {
      await dictionaryController.ensureLanguage(meta.language);
      const success = await gameController.submitMove(gameController.buildWordChecker.bind(gameController));
      if (success) {
        if (meta.gameOver) {
          await app.finalizeGameEnd();
        } else {
          app.checkAndHandleGameEnd();
        }
      }
    } else {
      networkController.send({
        type: 'ACTION_MOVE',
        placements: gameController.getPlacements(),
        playerId: meta!.localPlayerId
      });
      gameController.clearPlacements();
      app.renderAll();
      app.appendLog('Move sent to host');
    }
  });

  uiElements.clearPlacementsBtn.addEventListener('click', () => {
    gameController.clearPlacements();
  });

  uiElements.mixRackBtn.addEventListener('click', () => {
    gameController.shuffleRack();
    app.renderAll();
  });

  uiElements.passBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      showError('Waiting for both players to be ready.');
      return;
    }

    const meta = state.meta;
    if (meta?.isHost || meta?.mode === 'solo') {
      const success = await gameController.submitPass();
      if (success) {
        if (meta.gameOver) {
          await app.finalizeGameEnd();
        } else {
          app.checkAndHandleGameEnd();
        }
      }
    } else {
      networkController.send({
        type: 'ACTION_PASS',
        playerId: meta!.localPlayerId
      });
      app.appendLog('Pass sent to host');
    }
  });

  uiElements.exchangeBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      app.appendLog('Waiting for both players to be ready.');
      return;
    }

    const tileIds =
      gameController.getPlacements().length > 0
        ? gameController.getPlacements().map((p) => p.tile.id)
        : gameController.getSelectedTileId()
          ? [gameController.getSelectedTileId()!]
          : [];
    if (tileIds.length === 0) {
      showError('Select a tile to exchange (tap a rack tile).');
      return;
    }

    const meta = state.meta;
    if (meta?.isHost || meta?.mode === 'solo') {
      const success = await gameController.submitExchange(tileIds);
      if (success) {
        app.checkAndHandleGameEnd();
      }
    } else {
      networkController.send({
        type: 'ACTION_EXCHANGE',
        playerId: meta!.localPlayerId,
        tileIds
      });
      app.appendLog('Exchange sent to host');
    }
  });

  additional.copyOfferBtn.addEventListener('click', () =>
    copyToClipboard(additional.offerText.value, app.appendLog)
  );
  additional.copyClientAnswerBtn.addEventListener('click', () =>
    copyToClipboard(additional.clientAnswer.value, app.appendLog)
  );
  additional.scanOfferBtn.addEventListener('click', () =>
    qrScanner.scanInto(additional.hostOfferInput, async () => {
      await networkController.buildClientAnswer();
    })
  );
  additional.scanAnswerBtn.addEventListener('click', () =>
    qrScanner.scanInto(additional.answerText, async () => {
      await networkController.applyHostAnswer();
    })
  );

  networkController.setupAutoBuildClientAnswer(async () => {
    await networkController.buildClientAnswer();
  });
  networkController.setupAutoApplyHostAnswer(async () => {
    await networkController.applyHostAnswer();
  });

  additional.refreshDictsBtn.addEventListener('click', async () => {
    additional.dictEnIcon.textContent = '\u23F3';
    additional.dictRuIcon.textContent = '\u23F3';
    additional.dictRuStrictIcon.textContent = '\u23F3';
    uiElements.dictStatus.textContent = 'Dictionaries: checking...';
    try {
      await dictionaryController.refreshDictStatus();
    } catch (err) {
      additional.dictEnIcon.textContent = '\u274C';
      additional.dictRuIcon.textContent = '\u274C';
      additional.dictRuStrictIcon.textContent = '\u274C';
      uiElements.dictStatus.textContent = 'Dictionaries: check failed';
      uiElements.dictStatus.classList.add('danger');
      app.appendLog(`Dictionary status check failed: ${String(err)}`);
    }
  });
  additional.downloadEnBtn.addEventListener('click', () => dictionaryController.downloadLanguage('en'));
  additional.downloadRuBtn.addEventListener('click', () => dictionaryController.downloadLanguage('ru'));
  additional.downloadRuStrictBtn.addEventListener('click', async () => {
    await dictionaryController.downloadRuStrict();
  });
  additional.requestSyncBtn.addEventListener('click', () => {
    networkController.send({ type: 'REQUEST_SYNC' });
    app.appendLog('Requested sync from peer');
  });
  additional.toggleSetupBtn.addEventListener('click', () => {
    state.settingsHidden = !state.settingsHidden;
    app.renderVisibilityInternal();
  });
  additional.toggleLogsBtn.addEventListener('click', () => {
    state.logsHidden = !state.logsHidden;
    app.renderVisibilityInternal();
  });
  uiElements.minLengthInput.addEventListener('change', () => {
    const val = Number(uiElements.minLengthInput.value) || 2;
    app.appendLog(`Min word length set to ${val}`);
    if (state.meta && state.meta.isHost) {
      state.meta.minWordLength = val;
      app.sendSync();
    }
  });
  uiElements.timerEnabledToggle.addEventListener('change', () => {
    updateTimerSettingsUI(
      uiElements.timerEnabledToggle,
      uiElements.timerInput,
      uiElements.timerMinutesWrapper,
      state.mode === 'client'
    );
    const meta = state.meta;
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerEnabled = uiElements.timerEnabledToggle.checked;
    meta.timerDurationSec = Math.min(Math.max(Number(uiElements.timerInput.value) || 0, 1), 10) * 60;
    controllers.timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
    app.renderAll();
    void storageController.persistSnapshot(gameController.getState(), meta, state.labels);
    app.sendSync();
  });
  uiElements.timerInput.addEventListener('change', () => {
    updateTimerSettingsUI(
      uiElements.timerEnabledToggle,
      uiElements.timerInput,
      uiElements.timerMinutesWrapper,
      state.mode === 'client'
    );
    const meta = state.meta;
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerDurationSec = Math.min(Math.max(Number(uiElements.timerInput.value) || 0, 1), 10) * 60;
    if (meta.timerEnabled) {
      controllers.timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
      app.renderAll();
      void storageController.persistSnapshot(gameController.getState(), meta, state.labels);
      app.sendSync();
    }
  });

  uiElements.boardEl.addEventListener('keydown', (ev: KeyboardEvent) => {
    const cell = (ev.target as HTMLElement).closest<HTMLElement>('[data-x][data-y]');
    if (!cell) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const BOARD_LAST = 14;
    let nx = x, ny = y;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); nx = Math.max(0, x - 1); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); nx = Math.min(BOARD_LAST, x + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); ny = Math.max(0, y - 1); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); ny = Math.min(BOARD_LAST, y + 1); }
    else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return;
    } else return;
    const target = uiElements.boardEl.querySelector<HTMLElement>(`[data-x="${nx}"][data-y="${ny}"]`);
    target?.focus();
  });

  uiElements.boardEl.addEventListener('click', (ev: MouseEvent) => {
    const cell = (ev.target as HTMLElement).closest<HTMLDivElement>('[data-x][data-y]');
    const gameState = gameController.getState();
    const meta = state.meta;
    if (!cell || !gameState || !meta) return;
    if (readyGate.isPreGameLocked()) return;
    if (meta.gameOver) return;
    if (gameState.currentPlayer !== meta.localPlayerId) {
      const opponentName = state.labels[gameState.currentPlayer] ?? gameState.currentPlayer;
      showError(`It is ${opponentName}'s turn`);
      return;
    }
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (gameState.board[y][x].tile) return;

    if (gameController.getSelectedTileId()) {
      gameController.placeSelectedTileAt(x, y, async (tile) => {
        return blankTileSelector.selectBlankLetter(tile, meta?.language ?? 'en');
      });
    } else {
      gameController.removePlacementAt(x, y);
    }
  });

  uiElements.rackEl.addEventListener('click', (ev: MouseEvent) => {
    if (readyGate.isPreGameLocked()) return;
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-tile]');
    if (!button) return;
    gameController.setSelectedTileId(button.dataset.tile ?? null);
    app.renderAll();
  });

  uiElements.readyBtn.addEventListener('click', () => {
    app.markLocalReady();
  });

  uiElements.viewBoardBtn.addEventListener('click', () => {
    gameOverController.setGameOverOverlayDismissed(true);
    gameOverController.renderGameOverUi();
  });
  uiElements.showResultsBtn.addEventListener('click', () => {
    gameOverController.setGameOverOverlayDismissed(false);
    gameOverController.renderGameOverUi();
  });
  uiElements.rematchBtnOverlay.addEventListener('click', () => void session.requestRematch());
  uiElements.rematchBtnBanner.addEventListener('click', () => void session.requestRematch());
}
