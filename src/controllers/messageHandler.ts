import type { App } from '../app';
import type { ActionMessage, SessionMeta } from '../types';
import { propagateMeta } from './controllerBus';
import { isDuplicateOrStaleSequence, normalizeSequence } from '../utils/messageSequence';
import { computeStateHash } from '../utils/syncState';

function isActionMessage(data: unknown): data is ActionMessage {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
  const validTypes = [
    'ACTION_MOVE', 'ACTION_PASS', 'ACTION_EXCHANGE',
    'ACTION_REMATCH_REQUEST', 'DRAFT_PLACEMENTS', 'PLAYER_READY',
    'REQUEST_SYNC', 'SYNC_STATE'
  ];
  if (!validTypes.includes(obj.type)) return false;
  // Validate playerId exists for messages that require it
  if (['ACTION_MOVE', 'ACTION_PASS', 'ACTION_EXCHANGE', 'ACTION_REMATCH_REQUEST', 'DRAFT_PLACEMENTS', 'PLAYER_READY'].includes(obj.type)) {
    if (typeof obj.playerId !== 'string') return false;
  }
  // Validate specific fields for specific message types
  if (obj.type === 'ACTION_MOVE' && !Array.isArray(obj.placements)) return false;
  if (obj.type === 'ACTION_EXCHANGE' && !Array.isArray(obj.tileIds)) return false;
  if (obj.type === 'SYNC_STATE' && (typeof obj.state !== 'object' || typeof obj.meta !== 'object')) return false;
  return true;
}

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xFFFFFFFF;
}

function ensureMessageSequenceState(meta: SessionMeta | null): NonNullable<SessionMeta['messageSequence']> | null {
  if (!meta) return null;

  if (!meta.messageSequence) {
    meta.messageSequence = {
      lastSentByPeer: {},
      lastReceivedByPeer: {}
    };
  }
  return meta.messageSequence;
}

function getIncomingPeerId(msg: ActionMessage, meta: SessionMeta | null): string | null {
  if ('playerId' in msg && typeof msg.playerId === 'string') {
    return msg.playerId;
  }
  return meta?.remotePlayerId ?? null;
}

function shouldIgnoreDuplicateMessage(msg: ActionMessage, meta: SessionMeta | null): boolean {
  if (!isValidSequence(msg.seq)) return false;

  const peerId = getIncomingPeerId(msg, meta);
  if (!peerId) return false;

  const sequenceState = ensureMessageSequenceState(meta);
  if (!sequenceState) return false;
  const normalizedSeq = normalizeSequence(msg.seq);
  const lastReceived = sequenceState.lastReceivedByPeer[peerId] ?? 0;
  if (isDuplicateOrStaleSequence(normalizedSeq, lastReceived)) {
    return true;
  }

  sequenceState.lastReceivedByPeer[peerId] = normalizedSeq;
  return false;
}

export function createMessageHandler(
  app: App,
  restartForRematch: () => Promise<void>
): (data: unknown) => Promise<void> {
  const {
    gameController, timerController,
    readyGate, storageController, gameOverController,
    dictionaryController
  } = app.controllers;

  return async function handleMessage(data: unknown): Promise<void> {
    if (!isActionMessage(data)) {
      console.warn('[P2P] Ignoring invalid message:', data);
      return;
    }
    const msg = data;

    const localMeta = app.state.meta;
    if (shouldIgnoreDuplicateMessage(msg, localMeta)) {
      app.appendLog(`Ignoring duplicate or stale message: type=${msg.type}`);
      return;
    }

    if (msg.type === 'SYNC_STATE') {
      const incoming = msg.meta;
      let newMeta: SessionMeta;
        if (incoming.mode === 'host') {
          newMeta = {
            ...incoming,
            mode: 'client',
            isHost: false,
            localPlayerId: incoming.remotePlayerId ?? incoming.localPlayerId,
            remotePlayerId: incoming.localPlayerId
          };
        } else {
          newMeta = { ...incoming, isHost: false };
        }
        if (!newMeta.vectorClock) {
          newMeta.vectorClock = {};
        }
        newMeta.stateHash = computeStateHash(msg.state);
        app.state.meta = newMeta;
      app.state.labels = msg.labels;

      await dictionaryController.ensureLanguage(newMeta.language);
      if (newMeta.language === 'ru' && newMeta.russianDictionaryVariant === 'strict') {
        await dictionaryController.downloadRuStrict();
      }

      gameController.resume(msg.state);
      propagateMeta(app.controllers, newMeta, msg.state, msg.labels);

      app.uiElements.languageSelect.value = newMeta.language;
      if (newMeta.language === 'ru') {
        app.uiElements.russianVariantWrapper.style.display = 'flex';
        app.uiElements.russianVariantSelect.value = newMeta.russianDictionaryVariant || 'full';
      } else {
        app.uiElements.russianVariantWrapper.style.display = 'none';
      }
      app.state.mode = newMeta.mode;
      app.applyModeUIInternal();
      app.applyTimerInputFromMetaInternal();
      app.applyMinLengthInputFromMetaInternal();
      if (newMeta.timerEnabled && newMeta.turnDeadline) {
        timerController.startTimerTicker();
      } else {
        timerController.stopTimerTicker();
      }
      gameController.updateValidation();
      app.renderAll();
      await storageController.persistSnapshot(msg.state, newMeta, msg.labels);
      app.appendLog('Synced state from peer.');
      app.maybeShowTimeoutToastFromMeta(newMeta);
      gameOverController.maybeShowGameOverToastFromMeta(newMeta);
      return;
    }

    if (msg.type === 'PLAYER_READY') {
      const meta = app.state.meta;
      if (!meta?.isHost || !gameController.getState()) return;
      if (!readyGate.isReadyGateEnabled()) return;
      if (!meta.readyState) meta.readyState = {};
      meta.readyState[msg.playerId] = Boolean(msg.ready);
      await readyGate.maybeScheduleGameStartFromReady();
      app.renderAll();
      await storageController.persistSnapshot(
        gameController.getState(),
        meta,
        app.state.labels
      );
      app.sendSync();
      return;
    }

    if (msg.type === 'DRAFT_PLACEMENTS') {
      if (!gameController.getState()) return;
      gameController.setRemoteDraft({
        playerId: msg.playerId,
        placements: msg.placements,
        moveNumber: msg.moveNumber
      });
      app.renderAll();
      return;
    }

    if (msg.type === 'REQUEST_SYNC') {
      const meta = app.state.meta;
      if (meta?.isHost && gameController.getState()) app.sendSync();
      return;
    }

    const meta = app.state.meta;
    if (!meta?.isHost) {
      app.appendLog('Received action but not host; ignoring.');
      return;
    }

    if (msg.type === 'ACTION_REMATCH_REQUEST') {
      if (!meta.gameOver) return;
      gameOverController.applyRematchRequest(msg.playerId, msg.at);
      app.renderAll();
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

    await dictionaryController.ensureLanguage(meta.language);

    const actorPlayerId = meta.remotePlayerId;
    if (!actorPlayerId) {
      app.appendLog('Missing remote player id; ignoring action.');
      return;
    }

    async function handleActionResult(success: boolean): Promise<void> {
      if (!success) return;
      if (meta!.gameOver) {
        await app.finalizeGameEnd();
      } else {
        app.checkAndHandleGameEnd();
      }
    }

    if (msg.type === 'ACTION_MOVE') {
      gameController.setRemoteDraft(null);
      const success = await gameController.submitRemoteMove(
        msg.placements,
        actorPlayerId,
        gameController.buildWordChecker.bind(gameController)
      );
      await handleActionResult(success);
    } else if (msg.type === 'ACTION_PASS') {
      gameController.setRemoteDraft(null);
      const success = await gameController.submitPass(actorPlayerId);
      await handleActionResult(success);
    } else if (msg.type === 'ACTION_EXCHANGE') {
      gameController.setRemoteDraft(null);
      const success = await gameController.submitExchange(msg.tileIds, actorPlayerId);
      if (success) {
        app.checkAndHandleGameEnd();
      }
    }
  };
}
