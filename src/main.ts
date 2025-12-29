import './style.css';
import type { Language } from './core/types';
import type { Mode, SessionMeta, ActionMessage } from './types';
import {
  setLabels,
  type UiElements,
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
  updateTimerSettingsUI,
  renderVersion
} from './ui/uiRenderer';
import { ToastManager } from './ui/toast';
import { QrScanner } from './ui/qrScanner';
import { BlankTileSelector } from './ui/blankTileSelector';
import { GameController } from './controllers/gameController';
import { NetworkController } from './controllers/networkController';
import { TimerController } from './controllers/timerController';
import { DictionaryController } from './controllers/dictionaryController';
import { StorageController } from './controllers/storageController';
import { ReadyGate } from './controllers/readyGate';
import { GameOverController } from './controllers/gameOver';
import { EndgameScanController } from './controllers/endgameScan';
import { copyToClipboard, appendLog as appendLogUtil, formatGameOverReason } from './utils/appUtils';

declare const __APP_VERSION__: string;

const BASE_PATH = import.meta.env.BASE_URL ?? '/';

// Global state
let mode: Mode = 'solo';
let meta: SessionMeta | null = null;
let labels: Record<string, string> = {};
let settingsHidden = false;
let logsHidden = false;
let lastShownTurnEventToken: string | null = null;

// UI Elements
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="shell">
    <header class="top">
      <div class="brand">
        <p class="eyebrow">Mobile-first • Offline • P2P</p>
        <h1>Scrabble PWA</h1>
        <p id="app-version" class="hint version"></p>
      </div>
      <div class="stack top-controls">
        <div class="status-row">
          <span id="offline-status" class="pill"><span class="status-dot"></span>...</span>
          <span id="dict-status" class="pill">Dictionaries: checking...</span>
          <span id="p2p-status" class="pill">P2P: idle</span>
        </div>
        <div class="row gap wrap">
          <button id="force-reload" class="ghost">Update Game</button>
          <button id="toggle-setup" class="ghost">Hide setup</button>
        </div>
      </div>
    </header>

    <section class="cards setup-section" id="settings-section">
      <div class="card compact" id="dict-controls">
        <div class="row wrap gap">
          <span class="label">Dictionaries</span>
          <button class="ghost" id="refresh-dicts">Re-check</button>
          <button id="download-en" class="ghost">
            EN pack <span id="dict-en-icon" aria-label="English dictionary status">…</span>
          </button>
          <button id="download-ru" class="ghost">
            RU pack <span id="dict-ru-icon" aria-label="Russian dictionary status">…</span>
          </button>
          <button id="download-ru-strict" class="ghost">
            RU strict <span id="dict-ru-strict-icon" aria-label="Russian strict dictionary status">…</span>
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Session</h3>
          <span class="hint">Solo, Host (offer), or Join (answer)</span>
        </div>
        <div class="row wrap gap">
          <div class="segmented" id="mode-tabs">
            <button data-mode="solo" class="active">Solo</button>
            <button data-mode="host">Host</button>
            <button data-mode="client">Join</button>
          </div>
          <label class="stack flex1">
            <span class="label">Your name</span>
            <input id="me-name" value="Player 1" />
          </label>
          <label class="stack flex1">
            <span class="label">Partner name</span>
            <input id="peer-name" value="Player 2" />
          </label>
          <label class="stack" id="session-language">
            <span class="label">Session language</span>
            <select id="language">
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <label class="stack" id="russian-variant" style="display: none;">
            <span class="label">Russian dictionary</span>
            <select id="russian-dict-variant">
              <option value="full">Full (all forms)</option>
              <option value="strict">Strict (nominative+plural only)</option>
            </select>
            <p class="hint">Full: all inflected forms. Strict: nouns nominative+plural only, others base forms.</p>
          </label>
          <label class="stack">
            <span class="label">Minimum word length</span>
            <input id="min-length" type="number" min="1" value="2" />
            <p class="hint">Words shorter than this are rejected (e.g., set to 2 or 3).</p>
          </label>
          <div class="stack" id="session-timer">
            <div class="row gap wrap">
              <label class="row gap" style="align-items: center;">
                <input id="turn-timer-enabled" type="checkbox" checked />
                <span class="label">Enable turn timer</span>
              </label>
              <label class="stack" id="turn-timer-minutes" style="max-width: 120px;">
                <span class="label">Minutes</span>
                <input id="turn-timer" type="number" min="1" max="10" value="5" />
              </label>
            </div>
            <p class="hint">Host/solo only; shared with peers. When time runs out, the turn auto-passes.</p>
          </div>
        </div>
        <div class="row gap">
          <button id="start-btn" class="primary">Start</button>
          <button id="resume-btn" class="ghost" disabled>Resume saved</button>
          <button id="clear-snapshot" class="ghost danger" disabled>Forget saved</button>
        </div>
        <p id="resume-note" class="hint"></p>
      </div>
    </section>

    <section class="cards">
      <div class="card" id="host-handshake">
        <div class="card-head">
          <h3>Host Handshake</h3>
          <span class="hint">Share offer QR → scan/paste answer (auto-apply)</span>
        </div>
        <div class="row wrap gap">
          <div class="stack flex1">
            <span class="label">Offer (share with partner)</span>
            <textarea id="offer-text" rows="3" readonly></textarea>
            <div class="row gap wrap">
              <button id="copy-offer" class="ghost">Copy</button>
            </div>
          </div>
          <div class="stack flex1">
            <span class="label">Answer from partner</span>
            <textarea id="answer-text" rows="3" placeholder="Scan/paste answer"></textarea>
            <div class="row gap wrap">
              <button id="scan-answer" class="ghost">Scan QR</button>
            </div>
          </div>
          <div class="qr-stack">
            <img id="offer-qr" alt="Offer QR" />
            <span class="hint center">Offer QR</span>
          </div>
        </div>
      </div>

      <div class="card" id="client-handshake">
        <div class="card-head">
          <h3>Join Handshake</h3>
          <span class="hint">Scan/paste host offer → answer is generated automatically</span>
        </div>
        <div class="row wrap gap">
          <div class="stack flex1">
            <span class="label">Host offer</span>
            <textarea id="host-offer-input" rows="3" placeholder="Scan/paste host offer"></textarea>
            <div class="row gap wrap">
              <button id="scan-offer" class="ghost">Scan QR</button>
            </div>
          </div>
          <div class="stack flex1">
            <span class="label">Your answer (share back)</span>
            <textarea id="client-answer" rows="3" readonly></textarea>
            <div class="row gap wrap">
              <button id="copy-client-answer" class="ghost">Copy</button>
            </div>
          </div>
          <div class="qr-stack">
            <img id="answer-qr" alt="Answer QR" />
            <span class="hint center">Answer QR</span>
          </div>
        </div>
      </div>
    </section>

    <section class="cards">
      <div class="card board-card board-bleed">
        <div class="card-head">
          <h3>Board</h3>
          <div class="row gap">
            <span class="label">Turn:</span>
            <span id="turn-indicator" class="pill"></span>
            <span id="timer-display" class="pill timer-pill"></span>
            <span id="word-check-status" class="pill" style="display: none"></span>
            <span id="word-length-status" class="pill" style="display: none"></span>
            <span id="endgame-scan-status" class="pill" style="display: none"></span>
          </div>
        </div>
        <div id="toast" class="toast" role="status" aria-live="polite" style="display: none"></div>
        <div id="gameover-banner" class="gameover-banner" style="display: none;" aria-live="polite">
          <div class="gameover-banner-inner">
            <div class="gameover-banner-text">
              <strong>Game ended</strong>
              <span id="gameover-banner-scores" class="hint"></span>
              <span id="rematch-banner-status" class="hint"></span>
            </div>
            <div class="row gap wrap">
              <button id="rematch-btn-banner" class="primary">Rematch</button>
              <button id="show-results-btn" class="ghost">Results</button>
            </div>
          </div>
        </div>
        <div id="disconnect-overlay" class="disconnect-overlay" style="display: none;">
          <div class="disconnect-content">
            <div class="disconnect-icon">⚡</div>
            <h3>Connection Lost</h3>
            <p id="disconnect-message">The connection to your opponent was interrupted.</p>
            <p class="disconnect-hint">Scan the QR code again to reconnect and resume your game.</p>
            <div class="disconnect-spinner"></div>
          </div>
        </div>
        <div id="ready-overlay" class="ready-overlay" style="display: none;" aria-hidden="true">
          <div class="ready-content">
            <h3>Get ready</h3>
            <p id="ready-status" class="hint"></p>
            <button id="ready-btn" class="primary">Ready</button>
          </div>
        </div>
        <div id="gameover-overlay" class="gameover-overlay" style="display: none;" aria-hidden="true">
          <div class="gameover-content">
            <div class="gameover-icon">🏁</div>
            <h3>Game ended</h3>
            <p id="gameover-reason" class="hint"></p>
            <div id="gameover-scores" class="gameover-scores"></div>
            <div id="gameover-stats" class="gameover-stats"></div>
            <p id="rematch-status" class="hint" style="margin: 0.75rem 0 0;"></p>
            <div class="row gap wrap" style="justify-content: center; margin-top: 1rem;">
              <button id="rematch-btn-overlay" class="primary">Rematch</button>
              <button id="view-board-btn" class="ghost">View board</button>
            </div>
          </div>
        </div>
        <div id="board" class="board"></div>
      </div>

      <div class="card rack-card">
        <div class="card-head">
          <h3>Rack & Actions</h3>
          <span id="rack-owner" class="hint"></span>
        </div>
        <div id="rack" class="rack"></div>
        <div class="row wrap gap">
          <button id="confirm-move" class="primary">Confirm move</button>
          <button id="clear-placements" class="ghost">Clear placements</button>
          <button id="mix-rack" class="ghost" title="Shuffle your rack tiles">Mix</button>
          <button id="pass-btn" class="ghost">Pass</button>
          <button id="exchange-btn" class="ghost">Replace & pass</button>
        </div>
      </div>

      <div class="card info-card">
        <div class="card-head">
          <h3>Scores & Status</h3>
          <div class="row gap wrap">
            <button id="toggle-logs" class="ghost">Hide logs</button>
            <button id="request-sync" class="ghost">Request sync</button>
          </div>
        </div>
        <div id="scores"></div>
        <div id="log" class="log"></div>
      </div>
    </section>

    <section class="cards" id="stats-section">
      <div class="card">
        <div class="card-head">
          <h3>Game stats</h3>
          <span class="hint">Optional</span>
        </div>
        <details id="stats-details" class="stats-details">
          <summary>Show</summary>
          <div class="stats-row">
            <span class="label">Letters left in bag</span>
            <strong id="bag-count" class="bag-count"></strong>
          </div>
          <div id="move-history" class="move-history"></div>
        </details>
      </div>
    </section>
  </div>
`;

// Get UI elements
const uiElements: UiElements = {
  boardEl: document.querySelector<HTMLDivElement>('#board')!,
  rackEl: document.querySelector<HTMLDivElement>('#rack')!,
  rackOwnerEl: document.querySelector<HTMLSpanElement>('#rack-owner')!,
  turnIndicator: document.querySelector<HTMLSpanElement>('#turn-indicator')!,
  timerDisplay: document.querySelector<HTMLSpanElement>('#timer-display')!,
  wordCheckStatus: document.querySelector<HTMLSpanElement>('#word-check-status')!,
  wordLengthStatus: document.querySelector<HTMLSpanElement>('#word-length-status')!,
  endgameScanStatus: document.querySelector<HTMLSpanElement>('#endgame-scan-status')!,
  scoresEl: document.querySelector<HTMLDivElement>('#scores')!,
  logEl: document.querySelector<HTMLDivElement>('#log')!,
  bagCountEl: document.querySelector<HTMLElement>('#bag-count')!,
  moveHistoryEl: document.querySelector<HTMLDivElement>('#move-history')!,
  settingsSection: document.querySelector<HTMLElement>('#settings-section')!,
  confirmMoveBtn: document.querySelector<HTMLButtonElement>('#confirm-move')!,
  passBtn: document.querySelector<HTMLButtonElement>('#pass-btn')!,
  exchangeBtn: document.querySelector<HTMLButtonElement>('#exchange-btn')!,
  clearPlacementsBtn: document.querySelector<HTMLButtonElement>('#clear-placements')!,
  mixRackBtn: document.querySelector<HTMLButtonElement>('#mix-rack')!,
  languageSelect: document.querySelector<HTMLSelectElement>('#language')!,
  russianVariantSelect: document.querySelector<HTMLSelectElement>('#russian-dict-variant')!,
  russianVariantWrapper: document.querySelector<HTMLElement>('#russian-variant')!,
  minLengthInput: document.querySelector<HTMLInputElement>('#min-length')!,
  timerEnabledToggle: document.querySelector<HTMLInputElement>('#turn-timer-enabled')!,
  timerMinutesWrapper: document.querySelector<HTMLElement>('#turn-timer-minutes')!,
  timerInput: document.querySelector<HTMLInputElement>('#turn-timer')!,
  meInput: document.querySelector<HTMLInputElement>('#me-name')!,
  peerInput: document.querySelector<HTMLInputElement>('#peer-name')!,
  modeTabs: document.querySelector<HTMLDivElement>('#mode-tabs')!,
  hostCard: document.querySelector<HTMLDivElement>('#host-handshake')!,
  clientCard: document.querySelector<HTMLDivElement>('#client-handshake')!,
  languageWrapper: document.querySelector<HTMLElement>('#session-language')!,
  timerWrapper: document.querySelector<HTMLElement>('#session-timer')!,
  offlineStatus: document.querySelector<HTMLSpanElement>('#offline-status')!,
  dictStatus: document.querySelector<HTMLSpanElement>('#dict-status')!,
  p2pStatus: document.querySelector<HTMLSpanElement>('#p2p-status')!,
  versionEl: document.querySelector<HTMLParagraphElement>('#app-version'),
  readyOverlay: document.querySelector<HTMLDivElement>('#ready-overlay')!,
  readyStatusEl: document.querySelector<HTMLParagraphElement>('#ready-status')!,
  readyBtn: document.querySelector<HTMLButtonElement>('#ready-btn')!,
  gameOverOverlay: document.querySelector<HTMLDivElement>('#gameover-overlay')!,
  gameOverReasonEl: document.querySelector<HTMLParagraphElement>('#gameover-reason')!,
  gameOverScoresEl: document.querySelector<HTMLDivElement>('#gameover-scores')!,
  gameOverStatsEl: document.querySelector<HTMLDivElement>('#gameover-stats')!,
  rematchStatusEl: document.querySelector<HTMLParagraphElement>('#rematch-status')!,
  rematchBtnOverlay: document.querySelector<HTMLButtonElement>('#rematch-btn-overlay')!,
  viewBoardBtn: document.querySelector<HTMLButtonElement>('#view-board-btn')!,
  gameOverBanner: document.querySelector<HTMLDivElement>('#gameover-banner')!,
  gameOverBannerScoresEl: document.querySelector<HTMLSpanElement>('#gameover-banner-scores')!,
  rematchBannerStatusEl: document.querySelector<HTMLSpanElement>('#rematch-banner-status')!,
  rematchBtnBanner: document.querySelector<HTMLButtonElement>('#rematch-btn-banner')!,
  showResultsBtn: document.querySelector<HTMLButtonElement>('#show-results-btn')!,
  disconnectOverlay: document.querySelector<HTMLDivElement>('#disconnect-overlay')!,
  disconnectMessage: document.querySelector<HTMLParagraphElement>('#disconnect-message')!
};

// Additional elements
const toastEl = document.querySelector<HTMLDivElement>('#toast')!;
const copyOfferBtn = document.querySelector<HTMLButtonElement>('#copy-offer')!;
const offerText = document.querySelector<HTMLTextAreaElement>('#offer-text')!;
const offerQr = document.querySelector<HTMLImageElement>('#offer-qr')!;
const answerText = document.querySelector<HTMLTextAreaElement>('#answer-text')!;
const scanAnswerBtn = document.querySelector<HTMLButtonElement>('#scan-answer')!;
const hostOfferInput = document.querySelector<HTMLTextAreaElement>('#host-offer-input')!;
const scanOfferBtn = document.querySelector<HTMLButtonElement>('#scan-offer')!;
const clientAnswer = document.querySelector<HTMLTextAreaElement>('#client-answer')!;
const copyClientAnswerBtn = document.querySelector<HTMLButtonElement>('#copy-client-answer')!;
const answerQr = document.querySelector<HTMLImageElement>('#answer-qr')!;
const refreshDictsBtn = document.querySelector<HTMLButtonElement>('#refresh-dicts')!;
const downloadEnBtn = document.querySelector<HTMLButtonElement>('#download-en')!;
const downloadRuBtn = document.querySelector<HTMLButtonElement>('#download-ru')!;
const downloadRuStrictBtn = document.querySelector<HTMLButtonElement>('#download-ru-strict')!;
const dictEnIcon = document.querySelector<HTMLSpanElement>('#dict-en-icon')!;
const dictRuIcon = document.querySelector<HTMLSpanElement>('#dict-ru-icon')!;
const dictRuStrictIcon = document.querySelector<HTMLSpanElement>('#dict-ru-strict-icon')!;
const requestSyncBtn = document.querySelector<HTMLButtonElement>('#request-sync')!;
const toggleSetupBtn = document.querySelector<HTMLButtonElement>('#toggle-setup')!;
const toggleLogsBtn = document.querySelector<HTMLButtonElement>('#toggle-logs')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume-btn')!;
const clearSnapshotBtn = document.querySelector<HTMLButtonElement>('#clear-snapshot')!;
const resumeNote = document.querySelector<HTMLParagraphElement>('#resume-note')!;
const forceReloadBtn = document.querySelector<HTMLButtonElement>('#force-reload')!;

// Helper function for logging
function appendLog(msg: string): void {
  appendLogUtil(uiElements.logEl, msg);
}

// Initialize controllers
const toastManager = new ToastManager(toastEl);
const qrScanner = new QrScanner(appendLog);
const blankTileSelector = new BlankTileSelector(appendLog);
const gameController = new GameController(appendLog);
const networkController = new NetworkController(
  uiElements.p2pStatus,
  offerText,
  offerQr,
  answerText,
  hostOfferInput,
  clientAnswer,
  answerQr,
  uiElements.disconnectOverlay,
  uiElements.disconnectMessage,
  appendLog
);
const timerController = new TimerController(uiElements.timerDisplay);
const dictionaryController = new DictionaryController(
  dictEnIcon,
  dictRuIcon,
  dictRuStrictIcon,
  uiElements.dictStatus,
  appendLog
);
const storageController = new StorageController(
  resumeBtn,
  clearSnapshotBtn,
  resumeNote,
  appendLog
);
const readyGate = new ReadyGate(
  uiElements.readyOverlay,
  uiElements.readyStatusEl,
  uiElements.readyBtn
);
const gameOverController = new GameOverController(
  uiElements.gameOverOverlay,
  uiElements.gameOverReasonEl,
  uiElements.gameOverScoresEl,
  uiElements.gameOverStatsEl,
  uiElements.rematchStatusEl,
  uiElements.rematchBtnOverlay,
  uiElements.gameOverBanner,
  uiElements.gameOverBannerScoresEl,
  uiElements.rematchBannerStatusEl,
  uiElements.rematchBtnBanner
);
const endgameScanController = new EndgameScanController(
  uiElements.endgameScanStatus,
  appendLog
);


// Setup callbacks between controllers
function setupControllerCallbacks(): void {
  // Game controller callbacks
  gameController.setOnValidationUpdate(() => {
    updateValidationUI();
    applyActionButtonsState();
  });
  gameController.setOnGameEnd(() => {
    checkAndHandleGameEnd();
  });
  gameController.setOnPersist(async () => {
    await storageController.persistSnapshot(
      gameController.getState(),
      meta,
      labels
    );
  });
  gameController.setOnSync(() => {
    sendSync();
    sendDraftPlacements();
  });
  gameController.setOnRenderAll(() => {
    renderAll();
  });

  // Timer controller callbacks
  timerController.setOnTimeout(() => {
    void gameController.maybeAutoPassOnTimeout();
  });

  // Network controller callbacks
  networkController.setOnMessage((data: unknown) => {
    handleMessage(data);
  });
  networkController.setOnOpen(() => {
    if (meta?.isHost && gameController.getState()) {
      if (meta.timerEnabled && meta.timerDurationSec && !meta.turnDeadline && !readyGate.isPreGameLocked()) {
        timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
        void storageController.persistSnapshot(
          gameController.getState(),
          meta,
          labels
        );
      }
      appendLog('Host: sending sync to peer.');
      sendSync();
    } else {
      appendLog('Client: requesting sync from host.');
      networkController.send({ type: 'REQUEST_SYNC' });
    }
  });
  networkController.setOnClose(() => {
    // Handled internally
  });
  networkController.setOnError((err: unknown) => {
    appendLog(`P2P error: ${String(err)}`);
  });
  networkController.setOnConnectionStateChange((_state: string) => {
    // Handled internally
  });

  // Ready gate callbacks
  readyGate.setOnReadyClick(() => {
    markLocalReady();
  });

  // Endgame scan callbacks
  endgameScanController.setOnGameEnd(() => {
    handleEndgameScanComplete();
  });
}

// Helper functions
function updateValidationUI(): void {
  const validationStatus = gameController.getValidationStatus();
  const placements = gameController.getPlacements();
  const state = gameController.getState();

  if (!state || !meta || placements.length === 0) {
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
    // This will be updated by the game controller after validation completes
    uiElements.wordCheckStatus.style.display = '';
    uiElements.wordLengthStatus.style.display = 'none';
  } else if (validationStatus === 'invalid') {
    uiElements.wordCheckStatus.textContent = 'Invalid';
    uiElements.wordCheckStatus.classList.add('danger');
    uiElements.wordCheckStatus.style.display = '';

    const minWordLength = Math.max(
      1,
      Math.floor(meta.minWordLength ?? (Number(uiElements.minLengthInput.value) || 2))
    );
    const isTooShort = false; // Would need actual message parsing
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
  const state = gameController.getState();
  const isOver = Boolean(meta?.gameOver);
  const locked = readyGate.isPreGameLocked();
  const placementsCount = gameController.getPlacements().length;

  uiElements.confirmMoveBtn.disabled = !state || isOver || locked || placementsCount === 0;
  uiElements.passBtn.disabled = !state || isOver || locked;
  uiElements.exchangeBtn.disabled = !state || isOver || locked;
  uiElements.clearPlacementsBtn.disabled = placementsCount === 0;
  uiElements.mixRackBtn.disabled = !state || isOver || locked;
}

function renderAll(): void {
  const state = gameController.getState();
  const placements = gameController.getPlacements();
  const selectedTileId = gameController.getSelectedTileId();
  const remoteDraft = gameController.getRemoteDraft();
  const validationStatus = gameController.getValidationStatus();

  // Update labels in uiRenderer
  setLabels(labels);

  // Render board
  renderBoard(
    uiElements.boardEl,
    uiElements.turnIndicator,
    state,
    meta,
    placements,
    validationStatus,
    remoteDraft,
    labels
  );

  // Render rack
  renderRack(
    uiElements.rackEl,
    uiElements.rackOwnerEl,
    state,
    meta,
    placements,
    selectedTileId,
    gameController.getRackOrder(),
    gameController.syncLocalRackOrder.bind(gameController)
  );

  // Render scores
  renderScores(uiElements.scoresEl, state, labels);

  // Render stats
  renderStats(uiElements.bagCountEl, uiElements.moveHistoryEl, state, labels);

  // Render timer
  timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));

  // Render endgame scan status
  endgameScanController.renderEndgameScanStatus();

  // Render game over UI
  gameOverController.renderGameOverUi();

  // Render ready overlay
  readyGate.renderReadyOverlay();

  // Apply action buttons state
  applyActionButtonsState();
}

function sendSync(): void {
  const state = gameController.getState();
  if (!state || !meta) return;
  const payload: ActionMessage = {
    type: 'SYNC_STATE',
    state,
    meta,
    labels
  };
  networkController.send(payload);
  appendLog('Sync pushed to peer.');
}

function sendDraftPlacements(): void {
  const state = gameController.getState();
  const placements = gameController.getPlacements();
  if (!state || !meta) return;
  if (meta.mode === 'solo') return;
  const connection = networkController.getConnection();
  if (!connection?.dataChannelReady) return;
  if (state.currentPlayer !== meta.localPlayerId) return;
  networkController.send({
    type: 'DRAFT_PLACEMENTS',
    playerId: meta.localPlayerId,
    placements,
    moveNumber: state.moveNumber
  });
}

function markLocalReady(): void {
  if (!meta || !gameController.getState()) return;
  if (!readyGate.isReadyGateEnabled()) return;
  if (meta.gameOver) return;

  readyGate.markLocalReady();
  renderAll();
  void storageController.persistSnapshot(
    gameController.getState(),
    meta,
    labels
  );

  if (meta.isHost) {
    void readyGate.maybeScheduleGameStartFromReady().then(() => {
      renderAll();
      void storageController.persistSnapshot(
        gameController.getState(),
        meta,
        labels
      );
      sendSync();
    });
  } else {
    networkController.send({
      type: 'PLAYER_READY',
      playerId: meta.localPlayerId,
      ready: true
    });
  }
}

function checkAndHandleGameEnd(): void {
  endgameScanController.requestEndgameScanIfNeeded(uiElements.minLengthInput);
}

function handleEndgameScanComplete(): void {
  const state = gameController.getState();
  if (!meta || !state) return;
  if (meta.gameOver) return;
  if (!meta.isHost && meta.mode !== 'solo') return;

  const game = gameController.getGame();
  game.applyEndGameScoring();
  const newState = game.getState();
  gameController.setCurrentState(newState);
  meta.gameOver = {
    reason: 'no_moves_bag_empty',
    at: Date.now(),
    moveNumber: newState.moveNumber,
    finalScores: structuredClone(newState.scores)
  };

  void storageController.persistSnapshot(newState, meta, labels).then(() => {
    sendSync();
    renderAll();
    if (meta) {
      gameOverController.maybeShowGameOverToastFromMeta(meta);
    }
    appendLog(`Game ended: ${formatGameOverReason('no_moves_bag_empty')}`);
  });
}

async function handleMessage(data: unknown): Promise<void> {
  const msg = data as ActionMessage;

  if (msg.type === 'SYNC_STATE') {
    const incoming = msg.meta;
    if (incoming.mode === 'host') {
      meta = {
        ...incoming,
        mode: 'client',
        isHost: false,
        localPlayerId: incoming.remotePlayerId ?? incoming.localPlayerId,
        remotePlayerId: incoming.localPlayerId
      };
    } else {
      meta = { ...incoming, isHost: false };
    }
    labels = msg.labels;
    gameController.resume(msg.state);
    gameController.setMeta(meta);
    networkController.setMeta(meta);
    networkController.setCurrentState(msg.state);
    networkController.setLabels(labels);
    timerController.setMeta(meta);
    timerController.setConnection(networkController.getConnection());
    readyGate.setMeta(meta);
    readyGate.setCurrentState(msg.state);
    readyGate.setLabels(labels);
    gameOverController.setMeta(meta);
    gameOverController.setCurrentState(msg.state);
    gameOverController.setLabels(labels);
    endgameScanController.setMeta(meta);
    endgameScanController.setCurrentState(msg.state);

    uiElements.languageSelect.value = meta.language;
    if (meta.language === 'ru') {
      uiElements.russianVariantWrapper.style.display = 'flex';
      uiElements.russianVariantSelect.value = meta.russianDictionaryVariant || 'full';
    } else {
      uiElements.russianVariantWrapper.style.display = 'none';
    }
    mode = meta.mode;
    applyModeUIInternal();
    applyTimerInputFromMetaInternal();
    applyMinLengthInputFromMetaInternal();
    if (meta.timerEnabled && meta.turnDeadline) {
      timerController.startTimerTicker();
    } else {
      timerController.stopTimerTicker();
    }
    gameController.updateValidation();
    renderAll();
    await storageController.persistSnapshot(msg.state, meta, labels);
    appendLog('Synced state from peer.');
    if (meta) {
      maybeShowTimeoutToastFromMeta(meta);
      gameOverController.maybeShowGameOverToastFromMeta(meta);
    }
    return;
  }

  if (msg.type === 'PLAYER_READY') {
    if (!meta?.isHost || !gameController.getState()) return;
    if (!readyGate.isReadyGateEnabled()) return;
    if (!meta.readyState) meta.readyState = {};
    meta.readyState[msg.playerId] = Boolean(msg.ready);
    await readyGate.maybeScheduleGameStartFromReady();
    renderAll();
    await storageController.persistSnapshot(
      gameController.getState(),
      meta,
      labels
    );
    sendSync();
    return;
  }

  if (msg.type === 'DRAFT_PLACEMENTS') {
    const state = gameController.getState();
    if (!state) return;
    gameController.setRemoteDraft({
      playerId: msg.playerId,
      placements: msg.placements,
      moveNumber: msg.moveNumber
    });
    renderAll();
    return;
  }

  if (msg.type === 'REQUEST_SYNC') {
    if (meta?.isHost && gameController.getState()) sendSync();
    return;
  }

  if (!meta?.isHost) {
    appendLog('Received action but not host; ignoring.');
    return;
  }

  if (msg.type === 'ACTION_REMATCH_REQUEST') {
    if (!meta.gameOver) return;
    gameOverController.applyRematchRequest(msg.playerId, msg.at);
    renderAll();
    if (gameOverController.allPlayersRequestedRematch()) {
      await restartForRematch();
      return;
    }
    await storageController.persistSnapshot(
      gameController.getState(),
      meta,
      labels
    );
    sendSync();
    return;
  }

  await dictionaryController.ensureLanguage(meta.language);

  if (msg.type === 'ACTION_MOVE') {
    gameController.setRemoteDraft(null);
    const success = await gameController.submitMove(gameController.buildWordChecker.bind(gameController));
    if (success) {
      if (meta && meta.gameOver) {
        await storageController.persistSnapshot(
          gameController.getState(),
          meta,
          labels
        );
        sendSync();
        renderAll();
        if (meta) {
          gameOverController.maybeShowGameOverToastFromMeta(meta);
        }
        appendLog(`Game ended: ${formatGameOverReason(meta.gameOver.reason)}`);
      } else {
        checkAndHandleGameEnd();
      }
    }
  } else if (msg.type === 'ACTION_PASS') {
    gameController.setRemoteDraft(null);
    const success = await gameController.submitPass();
    if (success) {
      if (meta && meta.gameOver) {
        await storageController.persistSnapshot(
          gameController.getState(),
          meta,
          labels
        );
        sendSync();
        renderAll();
        if (meta) {
          gameOverController.maybeShowGameOverToastFromMeta(meta);
        }
        appendLog(`Game ended: ${formatGameOverReason(meta.gameOver.reason)}`);
      } else {
        checkAndHandleGameEnd();
      }
    }
  } else if (msg.type === 'ACTION_EXCHANGE') {
    gameController.setRemoteDraft(null);
    const success = await gameController.submitExchange(msg.tileIds);
    if (success) {
      checkAndHandleGameEnd();
    }
  }
}

function maybeShowTimeoutToastFromMeta(incoming: SessionMeta): void {
  const ev = incoming.lastTurnEvent;
  if (!ev || ev.type !== 'timeout') return;
  const token = `${ev.type}:${ev.playerId}:${ev.moveNumber}:${ev.at}`;
  if (token === lastShownTurnEventToken) return;
  lastShownTurnEventToken = token;

  const playerName = labels[ev.playerId] ?? ev.playerId;
  const isMe = incoming.localPlayerId === ev.playerId;
  toastManager.showToast(
    isMe ? "Time's up — you were auto-passed." : `Time's up — ${playerName} was auto-passed.`,
    'danger'
  );
}

async function restartForRematch(): Promise<void> {
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

  gameController.setMeta(meta);
  networkController.setMeta(meta);
  timerController.setMeta(meta);
  readyGate.setMeta(meta);
  gameOverController.setMeta(meta);
  endgameScanController.setMeta(meta);
  endgameScanController.resetState();

  const minWordLength = meta.minWordLength ?? Math.max(1, Math.floor(Number(uiElements.minLengthInput.value) || 2));
  dictionaryController.setMinWordLength(minWordLength);

  meta.turnDeadline = null;
  timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
  renderAll();
  gameController.updateValidation();

  await storageController.persistSnapshot(newState, meta, labels);
  if (meta.mode !== 'solo') {
    sendSync();
  }
  appendLog('Rematch started.');
}

async function requestRematch(): Promise<void> {
  if (!meta || !gameController.getState()) return;
  if (!meta.gameOver) return;

  if (meta.mode === 'solo') {
    await restartForRematch();
    return;
  }

  gameOverController.applyRematchRequest(meta.localPlayerId, Date.now());
  renderAll();

  if (meta.isHost) {
    if (gameOverController.allPlayersRequestedRematch()) {
      await restartForRematch();
      return;
    }
    await storageController.persistSnapshot(
      gameController.getState(),
      meta,
      labels
    );
    sendSync();
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
    labels
  );
  appendLog('Rematch request sent to host.');
}

async function startSession(): Promise<void> {
  if (mode === 'client') {
    appendLog('Join mode: scan/paste host offer to generate your answer, then wait for sync.');
    return;
  }

  const language = uiElements.languageSelect.value as Language;
  uiElements.languageSelect.value = language;
  const russianVariant = language === 'ru' ? (uiElements.russianVariantSelect.value as 'full' | 'strict') : undefined;
  const me = uiElements.meInput.value || 'Player 1';
  const peer = uiElements.peerInput.value || 'Player 2';
  const localId = mode === 'solo' ? 'p1' : 'host';
  const remoteId = mode === 'solo' ? undefined : 'client';
  const players = [localId];
  if (remoteId) players.push(remoteId);

  const minWordLength = Math.max(1, Math.floor(Number(uiElements.minLengthInput.value) || 2));
  dictionaryController.setMinWordLength(minWordLength);

  const timerDurationSec = Math.min(Math.max(Number(uiElements.timerInput.value) || 0, 1), 10) * 60;
  const timerEnabled = uiElements.timerEnabledToggle.checked && timerDurationSec > 0;
  const shouldStartTimerNow = mode === 'solo';

  await dictionaryController.ensureLanguage(language);
  if (language === 'ru' && russianVariant === 'strict') {
    await dictionaryController.downloadRuStrict();
  }

  const state = gameController.start(language, players);
  meta = {
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
  labels = { [localId]: me };
  if (remoteId) {
    labels[remoteId] = peer;
  }

  gameController.setMeta(meta);
  networkController.setMeta(meta);
  networkController.setCurrentState(state);
  networkController.setLabels(labels);
  networkController.setMode(mode);
  timerController.setMeta(meta);
  timerController.setConnection(networkController.getConnection());
  readyGate.setMeta(meta);
  readyGate.setCurrentState(state);
  readyGate.setLabels(labels);
  gameOverController.setMeta(meta);
  gameOverController.setCurrentState(state);
  gameOverController.setLabels(labels);
  endgameScanController.setMeta(meta);
  endgameScanController.setCurrentState(state);

  timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
  renderAll();
  gameController.updateValidation();
  appendLog(`Started ${mode} game as ${me}`);

  await storageController.persistSnapshot(state, meta, labels);

  if (mode === 'host') {
    await networkController.buildHostOffer(uiElements.languageSelect, dictionaryController.ensureLanguage.bind(dictionaryController));
  }
}

async function resumeSnapshot(): Promise<void> {
  const pendingSnapshot = storageController.getPendingSnapshot();
  if (!pendingSnapshot) return;
  await dictionaryController.ensureLanguage(pendingSnapshot.meta.language);
  if (pendingSnapshot.meta.language === 'ru' && pendingSnapshot.meta.russianDictionaryVariant === 'strict') {
    await dictionaryController.downloadRuStrict();
  }

  meta = pendingSnapshot.meta;
  labels = pendingSnapshot.labels;
  uiElements.languageSelect.value = pendingSnapshot.meta.language;
  if (pendingSnapshot.meta.language === 'ru') {
    uiElements.russianVariantWrapper.style.display = 'flex';
    uiElements.russianVariantSelect.value = pendingSnapshot.meta.russianDictionaryVariant || 'full';
  } else {
    uiElements.russianVariantWrapper.style.display = 'none';
  }
  mode = pendingSnapshot.meta.mode;
  applyModeUIInternal();
  applyTimerInputFromMetaInternal();
  applyMinLengthInputFromMetaInternal();
  if (meta.timerEnabled && meta.turnDeadline) {
    timerController.startTimerTicker();
  } else {
    timerController.stopTimerTicker();
  }
  gameController.resume(pendingSnapshot.state);
  gameController.setMeta(meta);
  networkController.setMeta(meta);
  networkController.setCurrentState(pendingSnapshot.state);
  networkController.setLabels(labels);
  networkController.setMode(mode);
  timerController.setMeta(meta);
  timerController.setConnection(networkController.getConnection());
  readyGate.setMeta(meta);
  readyGate.setCurrentState(pendingSnapshot.state);
  readyGate.setLabels(labels);
  gameOverController.setMeta(meta);
  gameOverController.setCurrentState(pendingSnapshot.state);
  gameOverController.setLabels(labels);
  endgameScanController.setMeta(meta);
  endgameScanController.setCurrentState(pendingSnapshot.state);

  gameController.updateValidation();
  renderAll();
  maybeShowTimeoutToastFromMeta(meta);
  gameOverController.maybeShowGameOverToastFromMeta(meta);
  appendLog('Resumed saved game.');

  if (mode !== 'solo') {
    appendLog('Resumed P2P session. Connection needed.');
    void networkController.triggerReconnect(settingsHidden, renderVisibilityInternal);
  }
}

function applyModeUIInternal(): void {
  applyModeUI(
    mode,
    uiElements.modeTabs,
    uiElements.hostCard,
    uiElements.clientCard,
    () => renderModeControlsInternal()
  );
}

function renderModeControlsInternal(): void {
  renderModeControls(
    mode,
    uiElements.meInput,
    uiElements.peerInput,
    uiElements.minLengthInput,
    uiElements.languageSelect,
    uiElements.russianVariantSelect,
    uiElements.russianVariantWrapper,
    uiElements.languageWrapper,
    uiElements.timerInput,
    uiElements.timerEnabledToggle,
    uiElements.timerWrapper,
    uiElements.timerMinutesWrapper,
    startBtn
  );
}

function applyTimerInputFromMetaInternal(): void {
  applyTimerInputFromMeta(
    meta,
    uiElements.timerEnabledToggle,
    uiElements.timerInput,
    uiElements.timerMinutesWrapper
  );
}

function applyMinLengthInputFromMetaInternal(): void {
  applyMinLengthInputFromMeta(
    meta,
    uiElements.minLengthInput,
    dictionaryController.setMinWordLength.bind(dictionaryController)
  );
}

function renderVisibilityInternal(): void {
  renderVisibility(
    uiElements.settingsSection,
    uiElements.logEl,
    toggleSetupBtn,
    toggleLogsBtn,
    settingsHidden,
    logsHidden
  );
}

function setupEvents(): void {
  window.addEventListener('online', () => {
    renderNetworkStatus(uiElements.offlineStatus);
    void dictionaryController.refreshDictStatus();
  });
  window.addEventListener('offline', () => {
    renderNetworkStatus(uiElements.offlineStatus);
    void dictionaryController.refreshDictStatus();
  });
  appendLog('Tips: both devices on same Wi-Fi, no VPN; host creates offer, client returns answer; host applies answer.');

  forceReloadBtn.addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      appendLog('Service workers unregistered');
    }
    window.location.reload();
  });

  uiElements.modeTabs.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!target) return;
    mode = target.dataset.mode as Mode;
    applyModeUIInternal();
  });

  uiElements.languageSelect.addEventListener('change', () => {
    const language = uiElements.languageSelect.value as Language;
    if (meta) {
      meta.language = language;
    }
    uiElements.russianVariantWrapper.style.display = language === 'ru' ? 'flex' : 'none';
  });

  uiElements.russianVariantSelect.addEventListener('change', () => {
    if (meta) {
      meta.russianDictionaryVariant = uiElements.russianVariantSelect.value as 'full' | 'strict';
    }
  });

  startBtn.addEventListener('click', () => startSession());
  resumeBtn.addEventListener('click', () => resumeSnapshot());
  clearSnapshotBtn.addEventListener('click', async () => {
    await storageController.clearSavedSnapshot();
  });

  uiElements.confirmMoveBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      appendLog('Waiting for both players to be ready.');
      return;
    }
    if (gameController.getPlacements().length === 0) {
      appendLog('Place tiles before confirming.');
      return;
    }

    if (meta?.isHost || meta?.mode === 'solo') {
      await dictionaryController.ensureLanguage(meta.language);
      const success = await gameController.submitMove(gameController.buildWordChecker.bind(gameController));
      if (success) {
        if (meta && meta.gameOver) {
          await storageController.persistSnapshot(
            gameController.getState(),
            meta,
            labels
          );
          sendSync();
          renderAll();
          gameOverController.maybeShowGameOverToastFromMeta(meta);
          appendLog(`Game ended: ${formatGameOverReason(meta.gameOver.reason)}`);
        } else {
          checkAndHandleGameEnd();
        }
      }
    } else {
      networkController.send({
        type: 'ACTION_MOVE',
        placements: gameController.getPlacements(),
        playerId: meta!.localPlayerId
      });
      gameController.clearPlacements();
      renderAll();
      appendLog('Move sent to host');
    }
  });

  uiElements.clearPlacementsBtn.addEventListener('click', () => {
    gameController.clearPlacements();
  });

  uiElements.mixRackBtn.addEventListener('click', () => {
    gameController.shuffleRack();
    renderAll();
  });

  uiElements.passBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      appendLog('Waiting for both players to be ready.');
      return;
    }

    if (meta?.isHost || meta?.mode === 'solo') {
      const success = await gameController.submitPass();
      if (success) {
        if (meta && meta.gameOver) {
          await storageController.persistSnapshot(
            gameController.getState(),
            meta,
            labels
          );
          sendSync();
          renderAll();
          gameOverController.maybeShowGameOverToastFromMeta(meta);
          appendLog(`Game ended: ${formatGameOverReason(meta.gameOver.reason)}`);
        } else {
          checkAndHandleGameEnd();
        }
      }
    } else {
      networkController.send({
        type: 'ACTION_PASS',
        playerId: meta!.localPlayerId
      });
      appendLog('Pass sent to host');
    }
  });

  uiElements.exchangeBtn.addEventListener('click', async () => {
    if (readyGate.isPreGameLocked()) {
      appendLog('Waiting for both players to be ready.');
      return;
    }

    const tileIds =
      gameController.getPlacements().length > 0
        ? gameController.getPlacements().map((p) => p.tile.id)
        : gameController.getSelectedTileId()
          ? [gameController.getSelectedTileId()!]
          : [];
    if (tileIds.length === 0) {
      appendLog('Select a tile to exchange (tap a rack tile).');
      return;
    }

    if (meta?.isHost || meta?.mode === 'solo') {
      const success = await gameController.submitExchange(tileIds);
      if (success) {
        checkAndHandleGameEnd();
      }
    } else {
      networkController.send({
        type: 'ACTION_EXCHANGE',
        playerId: meta!.localPlayerId,
        tileIds
      });
      appendLog('Exchange sent to host');
    }
  });

  copyOfferBtn.addEventListener('click', () => copyToClipboard(offerText.value, appendLog));
  copyClientAnswerBtn.addEventListener('click', () => copyToClipboard(clientAnswer.value, appendLog));
  scanOfferBtn.addEventListener('click', () =>
    qrScanner.scanInto(hostOfferInput, async () => {
      await networkController.buildClientAnswer();
    })
  );
  scanAnswerBtn.addEventListener('click', () =>
    qrScanner.scanInto(answerText, async () => {
      await networkController.applyHostAnswer();
    })
  );

  networkController.setupAutoBuildClientAnswer(async () => {
    await networkController.buildClientAnswer();
  });
  networkController.setupAutoApplyHostAnswer(async () => {
    await networkController.applyHostAnswer();
  });

  refreshDictsBtn.addEventListener('click', async () => {
    dictEnIcon.textContent = '⏳';
    dictRuIcon.textContent = '⏳';
    dictRuStrictIcon.textContent = '⏳';
    uiElements.dictStatus.textContent = 'Dictionaries: checking...';
    try {
      await dictionaryController.refreshDictStatus();
    } catch (err) {
      dictEnIcon.textContent = '❌';
      dictRuIcon.textContent = '❌';
      dictRuStrictIcon.textContent = '❌';
      uiElements.dictStatus.textContent = 'Dictionaries: check failed';
      uiElements.dictStatus.classList.add('danger');
      appendLog(`Dictionary status check failed: ${String(err)}`);
    }
  });
  downloadEnBtn.addEventListener('click', () => dictionaryController.downloadLanguage('en'));
  downloadRuBtn.addEventListener('click', () => dictionaryController.downloadLanguage('ru'));
  downloadRuStrictBtn.addEventListener('click', async () => {
    await dictionaryController.downloadRuStrict();
  });
  requestSyncBtn.addEventListener('click', () => {
    networkController.send({ type: 'REQUEST_SYNC' });
    appendLog('Requested sync from peer');
  });
  toggleSetupBtn.addEventListener('click', () => {
    settingsHidden = !settingsHidden;
    renderVisibilityInternal();
  });
  toggleLogsBtn.addEventListener('click', () => {
    logsHidden = !logsHidden;
    renderVisibilityInternal();
  });
  uiElements.minLengthInput.addEventListener('change', () => {
    const val = Number(uiElements.minLengthInput.value) || 2;
    dictionaryController.setMinWordLength(val);
    appendLog(`Min word length set to ${val}`);
    if (meta && meta.isHost) {
      meta.minWordLength = val;
      sendSync();
    }
  });
  uiElements.timerEnabledToggle.addEventListener('change', () => {
    updateTimerSettingsUI(
      uiElements.timerEnabledToggle,
      uiElements.timerInput,
      uiElements.timerMinutesWrapper,
      mode === 'client'
    );
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerEnabled = uiElements.timerEnabledToggle.checked;
    meta.timerDurationSec = Math.min(Math.max(Number(uiElements.timerInput.value) || 0, 1), 10) * 60;
    timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
    renderAll();
    void storageController.persistSnapshot(
      gameController.getState(),
      meta,
      labels
    );
    sendSync();
  });
  uiElements.timerInput.addEventListener('change', () => {
    updateTimerSettingsUI(
      uiElements.timerEnabledToggle,
      uiElements.timerInput,
      uiElements.timerMinutesWrapper,
      mode === 'client'
    );
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerDurationSec = Math.min(Math.max(Number(uiElements.timerInput.value) || 0, 1), 10) * 60;
    if (meta.timerEnabled) {
      timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
      renderAll();
      void storageController.persistSnapshot(
        gameController.getState(),
        meta,
        labels
      );
      sendSync();
    }
  });

  uiElements.boardEl.addEventListener('click', onBoardClick);
  uiElements.rackEl.addEventListener('click', onRackClick);
  uiElements.readyBtn.addEventListener('click', () => {
    markLocalReady();
  });

  uiElements.viewBoardBtn.addEventListener('click', () => {
    gameOverController.setGameOverOverlayDismissed(true);
    gameOverController.renderGameOverUi();
  });
  uiElements.showResultsBtn.addEventListener('click', () => {
    gameOverController.setGameOverOverlayDismissed(false);
    gameOverController.renderGameOverUi();
  });
  uiElements.rematchBtnOverlay.addEventListener('click', () => void requestRematch());
  uiElements.rematchBtnBanner.addEventListener('click', () => void requestRematch());
}

function onRackClick(ev: MouseEvent): void {
  if (readyGate.isPreGameLocked()) return;
  const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-tile]');
  if (!button) return;
  gameController.setSelectedTileId(button.dataset.tile ?? null);
  renderAll();
}

function onBoardClick(ev: MouseEvent): void {
  const cell = (ev.target as HTMLElement).closest<HTMLDivElement>('[data-x][data-y]');
  const state = gameController.getState();
  if (!cell || !state || !meta) return;
  if (readyGate.isPreGameLocked()) return;
  if (meta.gameOver) return;
  if (state.currentPlayer !== meta.localPlayerId) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  if (state.board[y][x].tile) {
    return;
  }

  if (gameController.getSelectedTileId()) {
    gameController.placeSelectedTileAt(x, y, async (tile) => {
      return blankTileSelector.selectBlankLetter(tile, meta?.language ?? 'en');
    });
  } else {
    gameController.removePlacementAt(x, y);
  }
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${BASE_PATH}sw.js`)
      .then(() => appendLog('Service worker registered'))
      .catch((err) => appendLog(`SW registration failed: ${String(err)}`));
  });
}

// Initialize
setupControllerCallbacks();
setupEvents();
uiElements.russianVariantWrapper.style.display = uiElements.languageSelect.value === 'ru' ? 'flex' : 'none';
renderNetworkStatus(uiElements.offlineStatus);
renderVersion(uiElements.versionEl, __APP_VERSION__);
applyModeUIInternal();
renderVisibilityInternal();
void dictionaryController.refreshDictStatus();
dictionaryController.startDictionaryAutoCheck();
void storageController.checkSavedSnapshot();
registerServiceWorker();
