import './style.css';
import type { SessionMeta } from './types';
import type { App, AppState } from './app';
import { getUiElements, getAdditionalElements } from './ui/domElements';
import { createControllers, wireCallbacks } from './controllers/controllerWiring';
import { createSessionManager } from './controllers/sessionManager';
import { createMessageHandler } from './controllers/messageHandler';
import { setupEvents } from './ui/eventSetup';
import {
  renderBoard,
  renderRack,
  renderScores,
  renderStats,
  applyModeUI,
  renderModeControls,
  applyTimerInputFromMeta,
  applyMinLengthInputFromMeta,
  renderVisibility,
  renderNetworkStatus,
  renderVersion
} from './ui/uiRenderer';
import { appendLog as appendLogUtil, formatGameOverReason } from './utils/appUtils';

declare const __APP_VERSION__: string;
const BASE_PATH = import.meta.env.BASE_URL ?? '/';

// --- DOM elements ---
const uiElements = getUiElements();
const additional = getAdditionalElements();

function appendLog(msg: string): void {
  appendLogUtil(uiElements.logEl, msg);
}

// --- Controllers ---
const controllers = createControllers(uiElements, additional, appendLog);
const {
  gameController, timerController, readyGate,
  storageController, gameOverController,
  endgameScanController, dictionaryController, toastManager
} = controllers;

// --- Mutable app state ---
const state: AppState = {
  mode: 'solo',
  meta: null,
  labels: {},
  settingsHidden: false,
  logsHidden: false,
  lastShownTurnEventToken: null
};

// --- Core helpers ---

function updateValidationUI(): void {
  const validationStatus = gameController.getValidationStatus();
  const placements = gameController.getPlacements();
  const gameState = gameController.getState();

  if (!gameState || !state.meta || placements.length === 0) {
    uiElements.wordCheckStatus.style.display = 'none';
    uiElements.wordLengthStatus.style.display = 'none';
    return;
  }

  uiElements.wordCheckStatus.className = 'pill';
  if (validationStatus === 'checking') {
    uiElements.wordCheckStatus.textContent = 'Checking...';
    uiElements.wordCheckStatus.style.display = '';
    uiElements.wordLengthStatus.style.display = 'none';
  } else if (validationStatus === 'valid') {
    uiElements.wordCheckStatus.style.display = '';
    uiElements.wordLengthStatus.style.display = 'none';
  } else if (validationStatus === 'invalid') {
    const validationMessage = gameController.getValidationMessage();
    uiElements.wordCheckStatus.textContent = validationMessage ?? 'Invalid';
    uiElements.wordCheckStatus.classList.add('danger');
    uiElements.wordCheckStatus.style.display = '';

    const minWordLength = Math.max(
      1,
      Math.floor(state.meta.minWordLength ?? (Number(uiElements.minLengthInput.value) || 2))
    );
    const wordMatch = validationMessage?.match(/^Invalid word:\s*(.+)$/i);
    const isTooShort = wordMatch != null && wordMatch[1].trim().length < minWordLength;
    if (isTooShort) {
      uiElements.wordLengthStatus.className = 'pill danger';
      uiElements.wordLengthStatus.textContent = `Too short (min ${minWordLength})`;
      uiElements.wordLengthStatus.style.display = '';
    } else {
      uiElements.wordLengthStatus.style.display = 'none';
    }
  }
}

function applyActionButtonsState(): void {
  const gameState = gameController.getState();
  const isOver = Boolean(state.meta?.gameOver);
  const locked = readyGate.isPreGameLocked();
  const placementsCount = gameController.getPlacements().length;
  uiElements.confirmMoveBtn.disabled = !gameState || isOver || locked || placementsCount === 0;
  uiElements.passBtn.disabled = !gameState || isOver || locked;
  uiElements.exchangeBtn.disabled = !gameState || isOver || locked;
  uiElements.clearPlacementsBtn.disabled = placementsCount === 0;
  uiElements.mixRackBtn.disabled = !gameState || isOver || locked;
}

let renderScheduled = false;

function doRender(): void {
  renderScheduled = false;
  const gameState = gameController.getState();
  const placements = gameController.getPlacements();
  const selectedTileId = gameController.getSelectedTileId();
  const remoteDraft = gameController.getRemoteDraft();
  const validationStatus = gameController.getValidationStatus();
  gameController.syncLocalRackOrder();
  renderBoard(uiElements.boardEl, uiElements.turnIndicator, gameState, state.meta, placements, validationStatus, remoteDraft, state.labels);
  renderRack(uiElements.rackEl, uiElements.rackOwnerEl, gameState, state.meta, placements, selectedTileId, gameController.getRackOrder(), gameController.syncLocalRackOrder.bind(gameController), state.labels);
  renderScores(uiElements.scoresEl, gameState, state.labels);
  renderStats(uiElements.bagCountEl, uiElements.moveHistoryEl, gameState, state.labels);
  timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
  endgameScanController.renderEndgameScanStatus();
  gameOverController.renderGameOverUi();
  readyGate.renderReadyOverlay();
  applyActionButtonsState();
}

function renderAll(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(doRender);
}

function sendSync(): void {
  const gameState = gameController.getState();
  if (!gameState || !state.meta) return;
  controllers.networkController.send({
    type: 'SYNC_STATE',
    state: gameState,
    meta: state.meta,
    labels: state.labels
  });
  appendLog('Sync pushed to peer.');
}

function sendDraftPlacements(): void {
  const gameState = gameController.getState();
  const placements = gameController.getPlacements();
  if (!gameState || !state.meta) return;
  if (state.meta.mode === 'solo') return;
  const connection = controllers.networkController.getConnection();
  if (!connection?.dataChannelReady) return;
  if (gameState.currentPlayer !== state.meta.localPlayerId) return;
  controllers.networkController.send({
    type: 'DRAFT_PLACEMENTS',
    playerId: state.meta.localPlayerId,
    placements,
    moveNumber: gameState.moveNumber
  });
}

function markLocalReady(): void {
  if (!state.meta || !gameController.getState()) return;
  if (!readyGate.isReadyGateEnabled()) return;
  if (state.meta.gameOver) return;

  readyGate.markLocalReady();
  renderAll();
  void storageController.persistSnapshot(gameController.getState(), state.meta, state.labels);

  if (state.meta.isHost) {
    void readyGate.maybeScheduleGameStartFromReady().then(() => {
      renderAll();
      void storageController.persistSnapshot(gameController.getState(), state.meta, state.labels);
      sendSync();
    });
  } else {
    controllers.networkController.send({
      type: 'PLAYER_READY',
      playerId: state.meta.localPlayerId,
      ready: true
    });
  }
}

function checkAndHandleGameEnd(): void {
  endgameScanController.requestEndgameScanIfNeeded(uiElements.minLengthInput);
}

function handleEndgameScanComplete(): void {
  const gameState = gameController.getState();
  if (!state.meta || !gameState) return;
  if (state.meta.gameOver) return;
  if (!state.meta.isHost && state.meta.mode !== 'solo') return;

  const game = gameController.getGame();
  game.applyEndGameScoring();
  const newState = game.getState();
  gameController.setCurrentState(newState);
  state.meta.gameOver = {
    reason: 'no_moves_bag_empty',
    at: Date.now(),
    moveNumber: newState.moveNumber,
    finalScores: structuredClone(newState.scores)
  };

  void finalizeGameEnd();
}

function maybeShowTimeoutToastFromMeta(incoming: SessionMeta): void {
  const ev = incoming.lastTurnEvent;
  if (!ev || ev.type !== 'timeout') return;
  const token = `${ev.type}:${ev.playerId}:${ev.moveNumber}:${ev.at}`;
  if (token === state.lastShownTurnEventToken) return;
  state.lastShownTurnEventToken = token;
  const playerName = state.labels[ev.playerId] ?? ev.playerId;
  const isMe = incoming.localPlayerId === ev.playerId;
  toastManager.showToast(
    isMe ? "Time's up — you were auto-passed." : `Time's up — ${playerName} was auto-passed.`,
    'danger'
  );
}

function applyModeUIInternal(): void {
  applyModeUI(state.mode, uiElements.modeTabs, uiElements.hostCard, uiElements.clientCard, () =>
    renderModeControls(
      state.mode, uiElements.meInput, uiElements.peerInput, uiElements.minLengthInput,
      uiElements.languageSelect, uiElements.russianVariantSelect, uiElements.russianVariantWrapper,
      uiElements.languageWrapper, uiElements.timerInput, uiElements.timerEnabledToggle,
      uiElements.timerWrapper, uiElements.timerMinutesWrapper, additional.startBtn
    )
  );
}

function applyTimerInputFromMetaInternal(): void {
  applyTimerInputFromMeta(state.meta, uiElements.timerEnabledToggle, uiElements.timerInput, uiElements.timerMinutesWrapper);
}

function applyMinLengthInputFromMetaInternal(): void {
  applyMinLengthInputFromMeta(state.meta, uiElements.minLengthInput);
}

function renderVisibilityInternal(): void {
  renderVisibility(uiElements.settingsSection, uiElements.logEl, additional.toggleSetupBtn, additional.toggleLogsBtn, state.settingsHidden, state.logsHidden);
}

async function finalizeGameEnd(): Promise<void> {
  const meta = state.meta;
  if (!meta?.gameOver) return;
  await storageController.persistSnapshot(gameController.getState(), meta, state.labels);
  sendSync();
  renderAll();
  gameOverController.maybeShowGameOverToastFromMeta(meta);
  appendLog(`Game ended: ${formatGameOverReason(meta.gameOver.reason)}`);
}

// --- Assemble App object ---
const app: App = {
  state,
  controllers,
  uiElements,
  additional,
  appendLog,
  renderAll,
  sendSync,
  checkAndHandleGameEnd,
  markLocalReady,
  maybeShowTimeoutToastFromMeta,
  applyModeUIInternal,
  applyTimerInputFromMetaInternal,
  applyMinLengthInputFromMetaInternal,
  renderVisibilityInternal,
  finalizeGameEnd
};

// --- Wire everything ---
const session = createSessionManager(app);
const handleMessage = createMessageHandler(app, session.restartForRematch);

wireCallbacks(controllers, {
  getMeta: () => state.meta,
  getLabels: () => state.labels,
  updateValidationUI,
  applyActionButtonsState,
  checkAndHandleGameEnd,
  handleEndgameScanComplete,
  renderAll,
  sendSync,
  sendDraftPlacements,
  handleMessage,
  appendLog
});

setupEvents(app, session);

// --- Service worker ---
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${BASE_PATH}sw.js`)
      .then(() => appendLog('Service worker registered'))
      .catch((err) => appendLog(`SW registration failed: ${String(err)}`));
  });
}

// --- Initialize ---
uiElements.russianVariantWrapper.style.display = uiElements.languageSelect.value === 'ru' ? 'flex' : 'none';
renderNetworkStatus(uiElements.offlineStatus);
renderVersion(uiElements.versionEl, __APP_VERSION__);
applyModeUIInternal();
renderVisibilityInternal();
void dictionaryController.refreshDictStatus();
dictionaryController.startDictionaryAutoCheck();
void storageController.checkSavedSnapshot();
registerServiceWorker();
