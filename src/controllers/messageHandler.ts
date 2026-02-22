import type { App } from '../app';
import type { ActionMessage, LogEntry, SessionMeta } from '../types';
import { propagateMeta } from './controllerBus';
import { isDuplicateOrStaleSequence, normalizeSequence } from '../utils/messageSequence';
import { computeStateHash, verifyStateHash } from '../utils/syncState';
import { getLogSince } from '../storage/indexedDb';

function isActionMessage(data: unknown): data is ActionMessage {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
    const validTypes = [
      'ACTION_MOVE', 'ACTION_PASS', 'ACTION_EXCHANGE',
      'ACTION_REMATCH_REQUEST', 'DRAFT_PLACEMENTS', 'PLAYER_READY',
      'REQUEST_SYNC', 'SYNC_STATE', 'LOG_DELTA',
      'MSG_ACK', 'MSG_NACK'
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
  if (obj.type === 'LOG_DELTA' && !isValidLogDeltaPayload(obj.payload)) return false;
  return true;
}

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xFFFFFFFF;
}

function isValidSequenceOrMinusOne(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1;
}

function isValidLogOperation(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.seq !== 'number' || !Number.isInteger(entry.seq) || entry.seq < 0) return false;
  if (typeof entry.playerId !== 'string' || entry.playerId.length === 0) return false;
  if (entry.type !== 'MOVE' && entry.type !== 'PASS' && entry.type !== 'EXCHANGE') return false;

  if (entry.type === 'MOVE') {
    const action = entry.action as Record<string, unknown> | undefined;
    if (!action || !Array.isArray(action.placements)) return false;
  } else if (entry.type === 'EXCHANGE') {
    const action = entry.action as Record<string, unknown> | undefined;
    if (!action || !Array.isArray(action.tileIds)) return false;
  }

  return true;
}

function isValidLogDeltaPayload(value: unknown): value is { sinceSeq: number; operations: LogEntry[] } {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (!isValidSequenceOrMinusOne(payload.sinceSeq)) return false;
  if (!Array.isArray(payload.operations)) return false;
  if (!payload.operations.every(isValidLogOperation)) return false;
  return true;
}

function isContiguousLogSequence(sinceSeq: number, operations: LogEntry[]): boolean {
  if (operations.length === 0) return true;
  if (operations[0].seq !== sinceSeq + 1) return false;

  for (let index = 1; index < operations.length; index += 1) {
    const previous = operations[index - 1].seq;
    const current = operations[index].seq;
    if (current !== previous + 1) return false;
  }

  return true;
}

function logSeqList(operations: LogEntry[]): number[] {
  return operations.map((operation) => operation.seq);
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

    if (msg.type !== 'MSG_ACK' && msg.type !== 'MSG_NACK' && isValidSequence(msg.seq)) {
      app.controllers.networkController.send({ type: 'MSG_ACK', ack: msg.seq });
    }

    const localMeta = app.state.meta;
    if (msg.type !== 'MSG_ACK' && msg.type !== 'MSG_NACK' && shouldIgnoreDuplicateMessage(msg, localMeta)) {
      app.appendLog(`Ignoring duplicate or stale message: type=${msg.type}`);
      return;
    }

    if (msg.type === 'MSG_ACK') {
      if (isValidSequence(msg.ack)) {
        app.controllers.networkController.handleAck(msg.ack);
      }
      return;
    }

    if (msg.type === 'MSG_NACK') {
      if (isValidSequence(msg.ack)) {
        app.appendLog(`Received NACK for seq=${msg.ack}`);
      }
      return;
    }

    if (msg.type === 'LOG_DELTA') {
      const payload = msg.payload;
      const deltaMeta = app.state.meta;
      if (!deltaMeta || !deltaMeta.sessionId) return;
      const { localPlayerId, mode, isHost } = deltaMeta;
      if (mode === 'solo' || isHost || !localPlayerId) {
        app.appendLog(`Ignoring LOG_DELTA on invalid role: mode=${mode}, isHost=${isHost}.`);
        return;
      }

      const gameState = gameController.getState();
      if (!gameState) return;

      const localOperations = await getLogSince(gameState.sessionId, -1);
      const localTailSeq = localOperations.length > 0 ? localOperations[localOperations.length - 1].seq : -1;
      if (localTailSeq !== payload.sinceSeq) {
        app.appendLog(`LOG_DELTA gap detected: local=${localTailSeq}, remote=${payload.sinceSeq}`);
        if (app.state.meta) {
          app.state.meta.diverged = true;
        }
        app.controllers.networkController.requestSync();
        return;
      }

      if (!isContiguousLogSequence(payload.sinceSeq, payload.operations)) {
        app.appendLog(`Ignoring LOG_DELTA due to non-contiguous seq: ${logSeqList(payload.operations).join(',')}`);
        deltaMeta.diverged = true;
        app.controllers.networkController.requestSync();
        return;
      }

      for (const operation of payload.operations) {
        let success = false;
        if (operation.type === 'MOVE') {
          success = await gameController.submitRemoteMove(
            operation.action.placements ?? [],
            operation.playerId,
            gameController.buildWordChecker.bind(gameController)
          );
        } else if (operation.type === 'PASS') {
          success = await gameController.applyRemotePass(operation.playerId);
        } else {
          success = await gameController.applyRemoteExchange(operation.action.tileIds ?? [], operation.playerId);
        }

        if (!success) {
          app.appendLog(`Applying LOG_DELTA failed at seq=${operation.seq}.`);
          deltaMeta.diverged = true;
          app.controllers.networkController.requestSync();
          return;
        }

        if (deltaMeta.gameOver) {
          await app.finalizeGameEnd();
        } else {
          app.checkAndHandleGameEnd();
        }
      }

      deltaMeta.diverged = false;
      const syncedState = gameController.getState() ?? gameState;
      deltaMeta.stateHash = computeStateHash(syncedState);
      app.appendLog(`Applied LOG_DELTA with ${payload.operations.length} operation(s).`);
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

      const remoteHash = incoming.stateHash;
      const localHash = computeStateHash(msg.state);
      if (!verifyStateHash(msg.state, remoteHash)) {
        newMeta.diverged = true;
        app.state.meta = newMeta;
        app.state.labels = msg.labels;
        app.appendLog(`State hash mismatch for session ${incoming.sessionId}; remote=${remoteHash ?? 'missing'}, local=${localHash}`);
        if (!newMeta.isHost) {
          app.controllers.networkController.requestSync();
        }
        return;
      }

      newMeta.diverged = false;
      newMeta.stateHash = localHash;
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

    if (app.state.meta?.diverged && msg.type !== 'REQUEST_SYNC') {
      app.appendLog(`Ignoring ${msg.type} while state is diverged.`);
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
      if (meta?.isHost && gameController.getState()) app.sendSync(msg.sinceSeq);
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
