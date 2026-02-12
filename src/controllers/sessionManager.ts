import type { Language } from '../core/types';
import type { App } from '../app';
import { propagateMeta } from './controllerBus';

export interface SessionManager {
  startSession(): Promise<void>;
  resumeSnapshot(): Promise<void>;
  restartForRematch(): Promise<void>;
  requestRematch(): Promise<void>;
}

export function createSessionManager(app: App): SessionManager {
  const {
    gameController, networkController, timerController,
    readyGate, storageController, gameOverController,
    endgameScanController, dictionaryController, toastManager
  } = app.controllers;

  function propagateAll(): void {
    const { meta, labels } = app.state;
    propagateMeta(app.controllers, meta, gameController.getState(), labels);
  }

  async function startSession(): Promise<void> {
    const { mode } = app.state;
    if (mode === 'client') {
      app.appendLog('Join mode: scan/paste host offer to generate your answer, then wait for sync.');
      return;
    }

    const language = app.uiElements.languageSelect.value as Language;
    app.uiElements.languageSelect.value = language;
    const russianVariant = language === 'ru'
      ? (app.uiElements.russianVariantSelect.value as 'full' | 'strict')
      : undefined;
    const me = app.uiElements.meInput.value || 'Player 1';
    const peer = app.uiElements.peerInput.value || 'Player 2';
    const localId = mode === 'solo' ? 'p1' : 'host';
    const remoteId = mode === 'solo' ? undefined : 'client';
    const players = [localId];
    if (remoteId) players.push(remoteId);

    const minWordLength = Math.max(1, Math.floor(Number(app.uiElements.minLengthInput.value) || 2));
    dictionaryController.setMinWordLength(minWordLength);

    const timerDurationSec = Math.min(Math.max(Number(app.uiElements.timerInput.value) || 0, 1), 10) * 60;
    const timerEnabled = app.uiElements.timerEnabledToggle.checked && timerDurationSec > 0;
    const shouldStartTimerNow = mode === 'solo';

    await dictionaryController.ensureLanguage(language);
    if (language === 'ru' && russianVariant === 'strict') {
      await dictionaryController.downloadRuStrict();
    }

    const state = gameController.start(language, players);
    app.state.meta = {
      mode,
      language,
      isHost: mode === 'host' || mode === 'solo',
      localPlayerId: localId,
      russianDictionaryVariant: russianVariant,
      remotePlayerId: remoteId,
      sessionId: state.sessionId,
      minWordLength,
      timerEnabled,
      timerDurationSec,
      turnDeadline: timerEnabled && shouldStartTimerNow ? Date.now() + timerDurationSec * 1000 : null,
      readyState: mode === 'host' && remoteId ? { [localId]: false, [remoteId]: false } : undefined,
      gameStartAt: mode === 'host' && remoteId ? null : undefined
    };
    app.state.labels = { [localId]: me };
    if (remoteId) {
      app.state.labels[remoteId] = peer;
    }

    networkController.setMode(mode);
    propagateAll();
    timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
    app.renderAll();
    gameController.updateValidation();
    app.appendLog(`Started ${mode} game as ${me}`);

    await storageController.persistSnapshot(state, app.state.meta, app.state.labels);

    if (mode === 'host') {
      await networkController.buildHostOffer(
        app.uiElements.languageSelect,
        dictionaryController.ensureLanguage.bind(dictionaryController)
      );
    }
  }

  async function resumeSnapshot(): Promise<void> {
    const pendingSnapshot = storageController.getPendingSnapshot();
    if (!pendingSnapshot) return;
    await dictionaryController.ensureLanguage(pendingSnapshot.meta.language);
    if (pendingSnapshot.meta.language === 'ru' && pendingSnapshot.meta.russianDictionaryVariant === 'strict') {
      await dictionaryController.downloadRuStrict();
    }

    app.state.meta = pendingSnapshot.meta;
    app.state.labels = pendingSnapshot.labels;
    app.uiElements.languageSelect.value = pendingSnapshot.meta.language;
    if (pendingSnapshot.meta.language === 'ru') {
      app.uiElements.russianVariantWrapper.style.display = 'flex';
      app.uiElements.russianVariantSelect.value = pendingSnapshot.meta.russianDictionaryVariant || 'full';
    } else {
      app.uiElements.russianVariantWrapper.style.display = 'none';
    }
    app.state.mode = pendingSnapshot.meta.mode;
    app.applyModeUIInternal();
    app.applyTimerInputFromMetaInternal();
    app.applyMinLengthInputFromMetaInternal();

    const meta = app.state.meta;
    if (meta.timerEnabled && meta.turnDeadline) {
      timerController.startTimerTicker();
    } else {
      timerController.stopTimerTicker();
    }

    gameController.resume(pendingSnapshot.state);
    networkController.setMode(app.state.mode);
    propagateAll();

    gameController.updateValidation();
    app.renderAll();
    app.maybeShowTimeoutToastFromMeta(meta);
    gameOverController.maybeShowGameOverToastFromMeta(meta);
    app.appendLog('Resumed saved game.');

    if (app.state.mode !== 'solo') {
      app.appendLog('Resumed P2P session. Connection needed.');
      void networkController.triggerReconnect(app.state.settingsHidden, app.renderVisibilityInternal);
    }
  }

  async function restartForRematch(): Promise<void> {
    const meta = app.state.meta;
    if (!meta) return;

    const language = meta.language;
    const state = gameController.getState();
    const players = state?.players ?? [meta.localPlayerId, meta.remotePlayerId].filter(Boolean) as string[];
    const newState = gameController.resetForRematch(language, players);

    meta.sessionId = newState.sessionId;
    meta.gameOver = undefined;
    meta.lastTurnEvent = undefined;
    meta.rematch = undefined;

    if (readyGate.isReadyGateEnabled() && players.length === 2) {
      meta.readyState = { [players[0]]: true, [players[1]]: true };
      meta.gameStartAt = Date.now();
    }

    propagateAll();
    endgameScanController.resetState();

    const minWordLength = meta.minWordLength ?? Math.max(1, Math.floor(Number(app.uiElements.minLengthInput.value) || 2));
    dictionaryController.setMinWordLength(minWordLength);

    meta.turnDeadline = null;
    timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
    app.renderAll();
    gameController.updateValidation();

    await storageController.persistSnapshot(newState, meta, app.state.labels);
    if (meta.mode !== 'solo') {
      app.sendSync();
    }
    app.appendLog('Rematch started.');
  }

  async function requestRematch(): Promise<void> {
    const meta = app.state.meta;
    if (!meta || !gameController.getState()) return;
    if (!meta.gameOver) return;

    if (meta.mode === 'solo') {
      await restartForRematch();
      return;
    }

    gameOverController.applyRematchRequest(meta.localPlayerId, Date.now());
    app.renderAll();

    if (meta.isHost) {
      if (gameOverController.allPlayersRequestedRematch()) {
        await restartForRematch();
        return;
      }
      await storageController.persistSnapshot(
        gameController.getState(),
        meta,
        app.state.labels
      );
      app.sendSync();
      return;
    }

    if (!networkController.getConnection()) {
      toastManager.showToast('Not connected — cannot request rematch.', 'danger');
      return;
    }

    networkController.send({
      type: 'ACTION_REMATCH_REQUEST',
      playerId: meta.localPlayerId,
      at: Date.now()
    });
    void storageController.persistSnapshot(
      gameController.getState(),
      meta,
      app.state.labels
    );
    app.appendLog('Rematch request sent to host.');
  }

  return { startSession, resumeSnapshot, restartForRematch, requestRematch };
}
