import './style.css';
import { BOARD_SIZE, ScrabbleGame } from './core/game';
import type { GameState, Language, Placement, Tile } from './core/types';
import { reconcileOrder, shuffleCopy } from './ui/rackOrder';
import {
  downloadDictionary,
  ensureDictionary,
  hasWord,
  setMinWordLength
} from './dictionary/dictionaryService';
import { createClient, createHost, type P2PCallbacks, type P2PConnection } from './network/p2p';
import { toQrDataUrl } from './network/qr';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './storage/indexedDb';
import jsQR from 'jsqr';
import { canStartInitialTurnTimer } from './core/sessionTimer';

declare const __APP_VERSION__: string;

type Mode = 'solo' | 'host' | 'client';

interface SessionMeta {
  mode: Mode;
  language: Language;
  isHost: boolean;
  localPlayerId: string;
  remotePlayerId?: string;
  sessionId: string;
  minWordLength?: number;
  timerEnabled?: boolean;
  timerDurationSec?: number;
  turnDeadline?: number | null;
  lastTurnEvent?: TurnEvent;
}

interface SnapshotPayload {
  state: GameState;
  meta: SessionMeta;
  labels: Record<string, string>;
}

type TurnEventType = 'timeout';

interface TurnEvent {
  type: TurnEventType;
  playerId: string;
  at: number;
  moveNumber: number;
}

type ActionMessage =
  | { type: 'ACTION_MOVE'; placements: Placement[]; playerId: string }
  | { type: 'ACTION_PASS'; playerId: string }
  | { type: 'ACTION_EXCHANGE'; playerId: string; tileIds: string[] }
  | { type: 'DRAFT_PLACEMENTS'; placements: Placement[]; playerId: string; moveNumber: number }
  | { type: 'REQUEST_SYNC' }
  | { type: 'SYNC_STATE'; state: GameState; meta: SessionMeta; labels: Record<string, string> };

const BASE_PATH = import.meta.env.BASE_URL ?? '/';
const game = new ScrabbleGame();

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
          <button id="force-reload" class="ghost">Force Update</button>
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
          <span class="hint">Share offer QR → scan answer QR</span>
        </div>
        <div class="row wrap gap">
          <div class="stack flex1">
            <span class="label">Offer (share with partner)</span>
            <textarea id="offer-text" rows="3" readonly></textarea>
            <div class="row gap wrap">
              <button id="build-offer" class="primary">Create offer</button>
              <button id="copy-offer" class="ghost">Copy</button>
            </div>
          </div>
          <div class="stack flex1">
            <span class="label">Answer from partner</span>
            <textarea id="answer-text" rows="3" placeholder="Scan/paste answer"></textarea>
            <div class="row gap wrap">
              <button id="apply-answer" class="primary">Apply answer</button>
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
          <span class="hint">Scan/paste host offer → show answer QR</span>
        </div>
        <div class="row wrap gap">
          <div class="stack flex1">
            <span class="label">Host offer</span>
            <textarea id="host-offer-input" rows="3" placeholder="Scan/paste host offer"></textarea>
            <div class="row gap wrap">
              <button id="scan-offer" class="ghost">Scan QR</button>
              <button id="build-answer" class="primary">Build answer</button>
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
          </div>
        </div>
        <div id="toast" class="toast" role="status" aria-live="polite" style="display: none"></div>
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
  </div>
`;

const languageSelect = document.querySelector<HTMLSelectElement>('#language')!;
const offlineStatus = document.querySelector<HTMLSpanElement>('#offline-status')!;
const dictStatus = document.querySelector<HTMLSpanElement>('#dict-status')!;
const p2pStatus = document.querySelector<HTMLSpanElement>('#p2p-status')!;
const versionEl = document.querySelector<HTMLParagraphElement>('#app-version');
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume-btn')!;
const clearSnapshotBtn = document.querySelector<HTMLButtonElement>('#clear-snapshot')!;
const resumeNote = document.querySelector<HTMLParagraphElement>('#resume-note')!;
const minLengthInput = document.querySelector<HTMLInputElement>('#min-length')!;
const timerEnabledToggle = document.querySelector<HTMLInputElement>('#turn-timer-enabled')!;
const timerMinutesWrapper = document.querySelector<HTMLElement>('#turn-timer-minutes')!;
const timerInput = document.querySelector<HTMLInputElement>('#turn-timer')!;
const modeTabs = document.querySelector<HTMLDivElement>('#mode-tabs')!;
const meInput = document.querySelector<HTMLInputElement>('#me-name')!;
const peerInput = document.querySelector<HTMLInputElement>('#peer-name')!;
const boardEl = document.querySelector<HTMLDivElement>('#board')!;
const rackEl = document.querySelector<HTMLDivElement>('#rack')!;
const rackOwnerEl = document.querySelector<HTMLSpanElement>('#rack-owner')!;
const turnIndicator = document.querySelector<HTMLSpanElement>('#turn-indicator')!;
const timerDisplay = document.querySelector<HTMLSpanElement>('#timer-display')!;
const wordCheckStatus = document.querySelector<HTMLSpanElement>('#word-check-status')!;
const wordLengthStatus = document.querySelector<HTMLSpanElement>('#word-length-status')!;
const toastEl = document.querySelector<HTMLDivElement>('#toast')!;
const scoresEl = document.querySelector<HTMLDivElement>('#scores')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const settingsSection = document.querySelector<HTMLElement>('#settings-section')!;
const confirmMoveBtn = document.querySelector<HTMLButtonElement>('#confirm-move')!;
const clearPlacementsBtn = document.querySelector<HTMLButtonElement>('#clear-placements')!;
const mixRackBtn = document.querySelector<HTMLButtonElement>('#mix-rack')!;
const passBtn = document.querySelector<HTMLButtonElement>('#pass-btn')!;
const exchangeBtn = document.querySelector<HTMLButtonElement>('#exchange-btn')!;

const buildOfferBtn = document.querySelector<HTMLButtonElement>('#build-offer')!;
const copyOfferBtn = document.querySelector<HTMLButtonElement>('#copy-offer')!;
const offerText = document.querySelector<HTMLTextAreaElement>('#offer-text')!;
const offerQr = document.querySelector<HTMLImageElement>('#offer-qr')!;
const answerText = document.querySelector<HTMLTextAreaElement>('#answer-text')!;
const applyAnswerBtn = document.querySelector<HTMLButtonElement>('#apply-answer')!;
const scanAnswerBtn = document.querySelector<HTMLButtonElement>('#scan-answer')!;

const hostOfferInput = document.querySelector<HTMLTextAreaElement>('#host-offer-input')!;
const buildAnswerBtn = document.querySelector<HTMLButtonElement>('#build-answer')!;
const scanOfferBtn = document.querySelector<HTMLButtonElement>('#scan-offer')!;
const clientAnswer = document.querySelector<HTMLTextAreaElement>('#client-answer')!;
const copyClientAnswerBtn = document.querySelector<HTMLButtonElement>('#copy-client-answer')!;
const answerQr = document.querySelector<HTMLImageElement>('#answer-qr')!;

const refreshDictsBtn = document.querySelector<HTMLButtonElement>('#refresh-dicts')!;
const downloadEnBtn = document.querySelector<HTMLButtonElement>('#download-en')!;
const downloadRuBtn = document.querySelector<HTMLButtonElement>('#download-ru')!;
const dictEnIcon = document.querySelector<HTMLSpanElement>('#dict-en-icon')!;
const dictRuIcon = document.querySelector<HTMLSpanElement>('#dict-ru-icon')!;
const requestSyncBtn = document.querySelector<HTMLButtonElement>('#request-sync')!;
const toggleSetupBtn = document.querySelector<HTMLButtonElement>('#toggle-setup')!;
const toggleLogsBtn = document.querySelector<HTMLButtonElement>('#toggle-logs')!;
const languageWrapper = document.querySelector<HTMLElement>('#session-language')!;
const timerWrapper = document.querySelector<HTMLElement>('#session-timer')!;

let mode: Mode = 'solo';
let meta: SessionMeta | null = null;
let labels: Record<string, string> = {};
let currentState: GameState | null = null;
let placements: Placement[] = [];
let selectedTileId: string | null = null;
let connection: P2PConnection | null = null;
let hostApplyAnswer: ((answer: string) => Promise<void>) | null = null;
let pendingSnapshot: SnapshotPayload | null = null;
let settingsHidden = false;
let logsHidden = false;
let timerTicker: number | null = null;
let validationStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
let validationNonce = 0;
let remoteDraft: { playerId: string; placements: Placement[]; moveNumber: number } | null = null;
let toastTimer: number | null = null;
let lastShownTurnEventToken: string | null = null;
let lastAutoPassToken: string | null = null;
let autoPassInProgress = false;

// Local-only rack ordering (UX): keep a stable user-defined order (e.g. after Mix)
// by tracking tile ids and reconciling against the authoritative rack on each update.
let rackOrder: string[] = [];
let rackOrderSessionId: string | null = null;

setupEvents();
renderNetworkStatus();
renderVersion();
applyModeUI();
renderVisibility();
refreshDictStatus();
startDictionaryAutoCheck();
checkSavedSnapshot();
registerServiceWorker();

function setupEvents() {
  window.addEventListener('online', () => {
    renderNetworkStatus();
    void refreshDictStatus();
  });
  window.addEventListener('offline', () => {
    renderNetworkStatus();
    void refreshDictStatus();
  });
  appendLog('Tips: both devices on same Wi-Fi, no VPN; host creates offer, client returns answer; host applies answer.');

  document.querySelector('#force-reload')?.addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
      appendLog('Service workers unregistered');
    }
    window.location.reload();
  });

  modeTabs.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!target) return;
    mode = target.dataset.mode as Mode;
    applyModeUI();
  });

  languageSelect.addEventListener('change', () => {
    if (meta) {
      meta.language = languageSelect.value as Language;
    }
  });

  startBtn.addEventListener('click', () => startSession());
  resumeBtn.addEventListener('click', () => resumeSnapshot());
  clearSnapshotBtn.addEventListener('click', async () => {
    await clearSnapshot('last-session');
    pendingSnapshot = null;
    resumeBtn.disabled = true;
    clearSnapshotBtn.disabled = true;
    resumeNote.textContent = '';
  });

  confirmMoveBtn.addEventListener('click', () => submitMove());
  clearPlacementsBtn.addEventListener('click', () => {
    placements = [];
    selectedTileId = null;
    sendDraftPlacements();
    renderBoard();
    renderRack();
    updateValidation();
  });
  mixRackBtn.addEventListener('click', () => {
    if (!currentState || !meta) return;
    syncLocalRackOrder(currentState, meta);
    rackOrder = shuffleCopy(rackOrder);
    renderRack();
  });
  passBtn.addEventListener('click', () => submitPass());
  exchangeBtn.addEventListener('click', () => submitExchange());

  buildOfferBtn.addEventListener('click', () => buildHostOffer());
  copyOfferBtn.addEventListener('click', () => copyToClipboard(offerText.value));
  applyAnswerBtn.addEventListener('click', () => applyHostAnswer());
  buildAnswerBtn.addEventListener('click', () => buildClientAnswer());
  copyClientAnswerBtn.addEventListener('click', () => copyToClipboard(clientAnswer.value));
  scanOfferBtn.addEventListener('click', () =>
    scanInto(hostOfferInput, async () => {
      await buildClientAnswer();
    })
  );
  scanAnswerBtn.addEventListener('click', () =>
    scanInto(answerText, async () => {
      await applyHostAnswer();
    })
  );

  refreshDictsBtn.addEventListener('click', async () => {
    // Give immediate visual feedback so status never looks "missing"
    dictEnIcon.textContent = '⏳';
    dictRuIcon.textContent = '⏳';
    dictStatus.textContent = 'Dictionaries: checking...';
    try {
      await refreshDictStatus();
    } catch (err) {
      dictEnIcon.textContent = '❌';
      dictRuIcon.textContent = '❌';
      dictStatus.textContent = 'Dictionaries: check failed';
      dictStatus.classList.add('danger');
      appendLog(`Dictionary status check failed: ${String(err)}`);
    }
  });
  downloadEnBtn.addEventListener('click', () => downloadLanguage('en'));
  downloadRuBtn.addEventListener('click', () => downloadLanguage('ru'));
  requestSyncBtn.addEventListener('click', () => {
    connection?.send({ type: 'REQUEST_SYNC' });
    appendLog('Requested sync from peer');
  });
  toggleSetupBtn.addEventListener('click', () => {
    settingsHidden = !settingsHidden;
    renderVisibility();
  });
  toggleLogsBtn.addEventListener('click', () => {
    logsHidden = !logsHidden;
    renderVisibility();
  });
  minLengthInput.addEventListener('change', () => {
    const val = Number(minLengthInput.value) || 2;
    setMinWordLength(val);
    appendLog(`Min word length set to ${val}`);
    if (meta && meta.isHost) {
      meta.minWordLength = val;
      sendSync();
    }
  });

  timerEnabledToggle.addEventListener('change', () => {
    updateTimerSettingsUI();
    // Only host/solo can change session meta.
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerEnabled = timerEnabledToggle.checked;
    // Preserve the chosen duration even when disabled (handy when re-enabling).
    meta.timerDurationSec = resolveTimerDurationSeconds();
    resetTurnTimer();
    renderAll();
    void persistSnapshot();
    sendSync();
  });

  timerInput.addEventListener('change', () => {
    updateTimerSettingsUI();
    if (!meta || (!meta.isHost && meta.mode !== 'solo')) return;
    meta.timerDurationSec = resolveTimerDurationSeconds();
    if (meta.timerEnabled) {
      resetTurnTimer();
      renderAll();
      void persistSnapshot();
      sendSync();
    }
  });

  boardEl.addEventListener('click', onBoardClick);
  rackEl.addEventListener('click', onRackClick);
}

function renderNetworkStatus() {
  const online = navigator.onLine;
  offlineStatus.textContent = online ? 'Online' : 'Offline';
  offlineStatus.classList.toggle('danger', !online);
}

function renderVersion() {
  if (!versionEl) return;
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  versionEl.textContent = `Version ${version}`;
}

function applyTimerInputFromMeta() {
  if (!meta) return;
  // Back-compat: old snapshots may have duration/deadline but no explicit enabled flag.
  if (meta.timerEnabled === undefined) {
    meta.timerEnabled = Boolean(meta.timerDurationSec);
  }
  timerEnabledToggle.checked = Boolean(meta.timerEnabled);
  if (meta.timerDurationSec) {
    const minutes = Math.max(1, Math.round(meta.timerDurationSec / 60));
    timerInput.value = String(minutes);
  }
  updateTimerSettingsUI();
}

function applyMinLengthInputFromMeta() {
  if (!meta?.minWordLength) return;
  const val = Math.max(1, Math.floor(meta.minWordLength));
  minLengthInput.value = String(val);
  setMinWordLength(val);
}

function resolveTimerDurationSeconds() {
  const minutes = Number(timerInput.value) || 0;
  if (Number.isNaN(minutes) || minutes <= 0) return 0;
  return Math.min(Math.max(minutes, 1), 10) * 60;
}

function updateTimerSettingsUI() {
  // When timer is disabled, hide the minutes selector entirely.
  const isJoin = mode === 'client';
  const enabled = timerEnabledToggle.checked;
  timerEnabledToggle.disabled = isJoin;
  timerInput.disabled = isJoin || !enabled;
  if (timerMinutesWrapper) {
    timerMinutesWrapper.style.display = isJoin || !enabled ? 'none' : '';
  }
}

function startTimerTicker() {
  stopTimerTicker();
  renderTimer();
  timerTicker = window.setInterval(renderTimer, 500);
}

function stopTimerTicker() {
  if (timerTicker) {
    window.clearInterval(timerTicker);
    timerTicker = null;
  }
}

function renderTimer() {
  if (!timerDisplay) return;
  if (!meta || !meta.timerEnabled || !meta.timerDurationSec || !meta.turnDeadline) {
    timerDisplay.style.display = 'none';
    return;
  }

  const remainingMs = meta.turnDeadline - Date.now();
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  timerDisplay.style.display = '';
  timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  timerDisplay.classList.toggle('danger', clamped === 0);
  timerDisplay.classList.toggle('active', clamped > 0);

  if (clamped === 0) {
    void maybeAutoPassOnTimeout();
  }
}

function resetTurnTimer() {
  if (!meta) {
    stopTimerTicker();
    renderTimer();
    return;
  }

  if (!meta.timerEnabled || !meta.timerDurationSec) {
    meta.turnDeadline = null;
    stopTimerTicker();
    renderTimer();
    return;
  }

  // Gate the initial start so host doesn't start the clock before the peer connects.
  if (!meta.turnDeadline && !canStartInitialTurnTimer(meta, Boolean(connection?.dataChannelReady))) {
    meta.turnDeadline = null;
    stopTimerTicker();
    renderTimer();
    return;
  }

  meta.turnDeadline = Date.now() + meta.timerDurationSec * 1000;
  startTimerTicker();
}

function showToast(message: string, variant: 'info' | 'danger' = 'info', ms = 4500) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast ${variant}`;
  toastEl.style.display = '';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.style.display = 'none';
  }, ms);
}

function maybeShowTimeoutToastFromMeta(incoming: SessionMeta) {
  const ev = incoming.lastTurnEvent;
  if (!ev || ev.type !== 'timeout') return;
  const token = `${ev.type}:${ev.playerId}:${ev.moveNumber}:${ev.at}`;
  if (token === lastShownTurnEventToken) return;
  lastShownTurnEventToken = token;

  const playerName = labels[ev.playerId] ?? ev.playerId;
  const isMe = incoming.localPlayerId === ev.playerId;
  showToast(isMe ? "Time's up — you were auto-passed." : `Time's up — ${playerName} was auto-passed.`, 'danger');
}

async function maybeAutoPassOnTimeout() {
  if (!meta || !currentState) return;
  // Host (or solo) is authoritative for turn advancement.
  if (!meta.isHost && meta.mode !== 'solo') return;
  if (!meta.timerEnabled || !meta.timerDurationSec || !meta.turnDeadline) return;

  const remainingMs = meta.turnDeadline - Date.now();
  if (remainingMs > 0) return;

  const token = `${currentState.sessionId}:${currentState.moveNumber}:${currentState.currentPlayer}:${meta.turnDeadline}`;
  if (token === lastAutoPassToken || autoPassInProgress) return;
  lastAutoPassToken = token;
  autoPassInProgress = true;

  try {
    remoteDraft = null;
    const timedOutPlayerId = currentState.currentPlayer;
    const result = game.passTurn(timedOutPlayerId);
    if (!result.success) return;

    currentState = game.getState();
    meta.lastTurnEvent = {
      type: 'timeout',
      playerId: timedOutPlayerId,
      at: Date.now(),
      moveNumber: currentState.moveNumber
    };
    if (timedOutPlayerId === meta.localPlayerId) {
      placements = [];
      selectedTileId = null;
      updateValidation();
    }
    resetTurnTimer();
    await persistSnapshot();
    sendSync();
    renderAll();
    maybeShowTimeoutToastFromMeta(meta);
    appendLog(`Auto-pass: ${labels[timedOutPlayerId] ?? timedOutPlayerId} ran out of time.`);
  } finally {
    autoPassInProgress = false;
  }
}

async function updateValidation() {
  validationNonce += 1;
  const ticket = validationNonce;

  if (!currentState || !meta || placements.length === 0) {
    validationStatus = 'idle';
    renderBoard();
    wordCheckStatus.style.display = 'none';
    wordLengthStatus.style.display = 'none';
    return;
  }

  validationStatus = 'checking';
  renderBoard();
  wordCheckStatus.textContent = 'Checking...';
  wordCheckStatus.className = 'pill';
  wordCheckStatus.style.display = '';
  wordLengthStatus.style.display = 'none';

  const preview = new ScrabbleGame();
  preview.resume(structuredClone(currentState));
  const result = await preview.placeMove(
    meta.localPlayerId,
    placements,
    (word, lang) => hasWord(word, lang)
  );

  if (ticket !== validationNonce) return;

  validationStatus = result.success ? 'valid' : 'invalid';
  renderBoard();

  wordCheckStatus.className = 'pill';
  if (result.success && result.words) {
    wordCheckStatus.textContent = `Valid: ${result.words.join(', ')} (+${result.scoreDelta})`;
    wordCheckStatus.classList.add('active');
    wordLengthStatus.style.display = 'none';
  } else {
    wordCheckStatus.textContent = result.message || 'Invalid';
    wordCheckStatus.classList.add('danger');

    // Extra pill: show ONLY when failure is caused by min word length rule.
    // Current engine reports "Invalid word: XYZ" for any dictionary rejection;
    // we treat it as "too short" if that invalid word is shorter than the configured minimum.
    const minWordLength = Math.max(
      1,
      Math.floor(meta.minWordLength ?? (Number(minLengthInput.value) || 2))
    );
    const invalidWordMatch = (result.message ?? '').match(/^Invalid word:\s*(.+)\s*$/);
    const invalidWord = invalidWordMatch?.[1]?.trim() ?? '';
    const isTooShort = Boolean(invalidWord) && invalidWord.length > 0 && invalidWord.length < minWordLength;
    if (isTooShort) {
      wordLengthStatus.className = 'pill danger';
      wordLengthStatus.textContent = `Too short (min ${minWordLength})`;
      wordLengthStatus.style.display = '';
    } else {
      wordLengthStatus.style.display = 'none';
    }
  }
}

function renderHandshakeVisibility() {
  const hostCard = document.querySelector<HTMLDivElement>('#host-handshake')!;
  const clientCard = document.querySelector<HTMLDivElement>('#client-handshake')!;
  hostCard.style.display = mode === 'host' ? 'block' : 'none';
  clientCard.style.display = mode === 'client' ? 'block' : 'none';
}

function applyModeUI() {
  modeTabs.querySelectorAll('button').forEach((b) => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('active', isActive);
  });
  renderHandshakeVisibility();
  renderModeControls();
}

function renderModeControls() {
  const isJoin = mode === 'client';
  const isSolo = mode === 'solo';
  const meWrapper = meInput.closest('.stack') as HTMLElement;
  const peerWrapper = peerInput.closest('.stack') as HTMLElement;
  const minLengthWrapper = minLengthInput.closest('.stack') as HTMLElement;
  if (meWrapper) {
    meWrapper.style.display = isJoin ? 'none' : '';
  }
  if (peerWrapper) {
    peerWrapper.style.display = isSolo || isJoin ? 'none' : '';
  }
  if (minLengthWrapper) {
    minLengthWrapper.style.display = isJoin ? 'none' : '';
  }
  minLengthInput.disabled = isJoin;

  languageSelect.disabled = isJoin;
  if (languageWrapper) {
    languageWrapper.style.display = isJoin ? 'none' : '';
  }
  timerInput.disabled = isJoin;
  timerEnabledToggle.disabled = isJoin;
  if (timerWrapper) {
    timerWrapper.style.display = isJoin ? 'none' : '';
  }
  updateTimerSettingsUI();
}

function renderVisibility() {
  settingsSection.style.display = settingsHidden ? 'none' : '';
  logEl.style.display = logsHidden ? 'none' : '';
  toggleSetupBtn.textContent = settingsHidden ? 'Show setup' : 'Hide setup';
  toggleSetupBtn.setAttribute('aria-pressed', settingsHidden ? 'true' : 'false');
  toggleLogsBtn.textContent = logsHidden ? 'Show logs' : 'Hide logs';
  toggleLogsBtn.setAttribute('aria-pressed', logsHidden ? 'true' : 'false');
}

function renderBoard() {
  const state = currentState;
  if (!state) {
    boardEl.innerHTML = '<p class="hint">Start a session to see the board.</p>';
    return;
  }

  const placementKeys = new Set(placements.map((p) => `${p.x},${p.y}`));
  const ghostPlacements =
    remoteDraft &&
      remoteDraft.moveNumber === state.moveNumber &&
      remoteDraft.playerId === state.currentPlayer &&
      remoteDraft.playerId !== meta?.localPlayerId
      ? remoteDraft.placements
      : [];
  const ghostKeys = new Set(ghostPlacements.map((p) => `${p.x},${p.y}`));
  const rows: string[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const cells: string[] = [];
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const placed = placements.find((p) => p.x === x && p.y === y);
      const ghostPlaced = !placed ? ghostPlacements.find((p) => p.x === x && p.y === y) : undefined;
      const tile = placed?.tile ?? ghostPlaced?.tile ?? state.board[y][x].tile;
      const premium = premiumClass(x, y);
      const isNew = placementKeys.has(`${x},${y}`);
      const isGhost = !isNew && ghostKeys.has(`${x},${y}`) && !state.board[y][x].tile;
      const validationClass =
        isNew && validationStatus === 'valid'
          ? 'valid'
          : isNew && validationStatus === 'invalid'
            ? 'invalid'
            : isNew && validationStatus === 'checking'
              ? 'checking'
              : '';
      const classes = [
        'cell',
        premium,
        isNew ? 'pending' : '',
        isGhost ? 'remote-draft' : '',
        validationClass
      ]
        .filter(Boolean)
        .join(' ');
      cells.push(
        `<div class="${classes}" data-x="${x}" data-y="${y}">
          ${tile ? `<span class="letter">${tile.letter}</span><span class="value">${tile.value}</span>` : ''}
        </div>`
      );
    }
    rows.push(`<div class="row">${cells.join('')}</div>`);
  }
  boardEl.innerHTML = rows.join('');

  turnIndicator.textContent = labels[state.currentPlayer] ?? state.currentPlayer;
  turnIndicator.classList.toggle('active', meta?.localPlayerId === state.currentPlayer);
}

function renderRack() {
  const state = currentState;
  if (!state || !meta) {
    rackEl.innerHTML = '<p class="hint">No rack yet.</p>';
    return;
  }
  syncLocalRackOrder(state, meta);
  const rack = state.racks[meta.localPlayerId] ?? [];
  const byId = new Map(rack.map((t) => [t.id, t] as const));
  const orderedRack = rackOrder.map((id) => byId.get(id)).filter(Boolean) as Tile[];
  const usedIds = new Set(placements.map((p) => p.tile.id));
  const tiles = orderedRack
    .filter((t) => !usedIds.has(t.id))
    .map((t) => renderTile(t, t.id === selectedTileId))
    .join('');

  const pendingTiles = placements.map((p) => renderTile(p.tile, false, true)).join('');
  rackEl.innerHTML = `
    <div class="rack-row">${tiles || '<span class="hint">Empty rack</span>'}</div>
    <div class="rack-row hint">Pending: ${pendingTiles || 'None'}</div>
  `;

  rackOwnerEl.textContent = `You are: ${labels[meta.localPlayerId] ?? meta.localPlayerId}`;
}

function renderScores() {
  const state = currentState;
  if (!state) {
    scoresEl.innerHTML = '<p class="hint">No scores yet.</p>';
    return;
  }
  const parts = Object.entries(state.scores).map(
    ([id, score]) =>
      `<div class="score">
        <span>${labels[id] ?? id}</span>
        <strong>${score}</strong>
      </div>`
  );
  scoresEl.innerHTML = parts.join('');
}

function renderAll() {
  renderBoard();
  renderRack();
  renderScores();
  renderTimer();
}

function renderTile(tile: Tile, selected = false, pending = false) {
  const classes = ['tile'];
  if (selected) classes.push('selected');
  if (pending) classes.push('pending');
  if (tile.blank && tile.letter === ' ') classes.push('blank');
  return `<button class="${classes.join(' ')}" data-tile="${tile.id}">
    <span class="letter">${tile.blank && tile.letter === ' ' ? '?' : tile.letter}</span>
    <span class="value">${tile.value}</span>
  </button>`;
}

function premiumClass(x: number, y: number): string {
  if (x === 7 && y === 7) return 'center';
  const tripleWord = [0, 7, 14];
  if (tripleWord.includes(x) && tripleWord.includes(y)) return 'tw';
  if ((x === y || x + y === 14) && x !== 0 && x !== 7 && x !== 14) return 'dw';
  const tl = [
    [1, 5],
    [1, 9],
    [5, 1],
    [5, 5],
    [5, 9],
    [5, 13],
    [9, 1],
    [9, 5],
    [9, 9],
    [9, 13],
    [13, 5],
    [13, 9]
  ];
  const dl = [
    [0, 3],
    [0, 11],
    [2, 6],
    [2, 8],
    [3, 0],
    [3, 7],
    [3, 14],
    [6, 2],
    [6, 6],
    [6, 8],
    [6, 12],
    [7, 3],
    [7, 11],
    [8, 2],
    [8, 6],
    [8, 8],
    [8, 12],
    [11, 0],
    [11, 7],
    [11, 14],
    [12, 6],
    [12, 8],
    [14, 3],
    [14, 11]
  ];
  if (tl.some(([cx, cy]) => cx === x && cy === y)) return 'tl';
  if (dl.some(([cx, cy]) => cx === x && cy === y)) return 'dl';
  return '';
}

function onRackClick(ev: MouseEvent) {
  const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-tile]');
  if (!button) return;
  selectedTileId = button.dataset.tile ?? null;
  renderRack();
}

function onBoardClick(ev: MouseEvent) {
  const cell = (ev.target as HTMLElement).closest<HTMLDivElement>('[data-x][data-y]');
  if (!cell || !currentState || !meta) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  if (currentState.board[y][x].tile) {
    // Prevent overriding existing tile
    return;
  }

  if (selectedTileId) {
    const tile = takeAvailableTile(selectedTileId);
    if (!tile) return;

    // Handle blank tile letter selection
    if (tile.blank) {
      selectBlankLetter(tile).then((updatedTile) => {
        if (updatedTile) {
          // Replace existing placement if any
          const existingIdx = placements.findIndex((p) => p.x === x && p.y === y);
          if (existingIdx >= 0) {
            placements.splice(existingIdx, 1);
          }

          placements.push({ x, y, tile: updatedTile });
          selectedTileId = null;
          sendDraftPlacements();
          renderBoard();
          renderRack();
          updateValidation();
        }
      });
      return;
    }

    // Replace existing placement if any
    const existingIdx = placements.findIndex((p) => p.x === x && p.y === y);
    if (existingIdx >= 0) {
      placements.splice(existingIdx, 1);
    }

    placements.push({ x, y, tile });
    selectedTileId = null;
    sendDraftPlacements();
    renderBoard();
    renderRack();
    updateValidation();
  } else {
    // Remove pending tile if tapped
    const idx = placements.findIndex((p) => p.x === x && p.y === y);
    if (idx >= 0) {
      placements.splice(idx, 1);
      sendDraftPlacements();
      renderBoard();
      renderRack();
      updateValidation();
    }
  }
}

function takeAvailableTile(tileId: string): Tile | null {
  if (!currentState || !meta) return null;
  const used = new Set(placements.map((p) => p.tile.id));
  const rack = currentState.racks[meta.localPlayerId] ?? [];
  const tile = rack.find((t) => t.id === tileId && !used.has(t.id));
  return tile ?? null;
}

function selectBlankLetter(tile: Tile): Promise<Tile | null> {
  return new Promise((resolve) => {
    const language = meta?.language ?? 'en';
    const letters = language === 'en'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      : 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

    // Create modal dialog
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #1e293b;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 16px;
      padding: 24px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0 0 12px 0; color: #f1f5f9; font-size: 1.25rem; font-weight: 600;">Choose blank tile letter</h3>
      <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 0.9rem;">Select which letter this blank tile will represent:</p>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 8px; margin-bottom: 20px;">
        ${letters.split('').map(letter => `
          <button class="blank-letter-btn" data-letter="${letter}" style="
            padding: 10px 8px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 8px;
            background: linear-gradient(145deg, #fef3c7 0%, #fde68a 50%, #fcd34d 100%);
            color: #1c1917;
            cursor: pointer;
            font-weight: 700;
            font-size: 16px;
            transition: all 0.15s;
            box-shadow: inset 0 -2px 0 #b45309, 0 2px 4px rgba(0,0,0,0.2);
          " onmouseover="this.style.transform='translateY(-2px) scale(1.05)'; this.style.boxShadow='0 0 0 2px #3b82f6, inset 0 -2px 0 #b45309, 0 4px 8px rgba(0,0,0,0.3)'"
             onmouseout="this.style.transform=''; this.style.boxShadow='inset 0 -2px 0 #b45309, 0 2px 4px rgba(0,0,0,0.2)'">
            ${letter}
          </button>
        `).join('')}
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancel-blank" style="
          padding: 10px 20px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 10px;
          background: #334155;
          color: #f1f5f9;
          cursor: pointer;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.15s;
        " onmouseover="this.style.background='#475569'" onmouseout="this.style.background='#334155'">Cancel</button>
      </div>
    `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Handle letter selection
    dialog.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.classList.contains('blank-letter-btn')) {
        const letter = target.dataset.letter!;
        const updatedTile: Tile = {
          ...tile,
          letter: letter,
          value: 0 // blanks are worth 0 points
        };
        document.body.removeChild(modal);
        resolve(updatedTile);
      } else if (target.id === 'cancel-blank') {
        document.body.removeChild(modal);
        resolve(null);
      }
    });

    // Handle escape key
    const handleEscape = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', handleEscape);
        resolve(null);
      }
    };
    document.addEventListener('keydown', handleEscape);
  });
}

async function startSession() {
  if (mode === 'client') {
    appendLog('Join mode: paste/scan host offer and build answer.');
    return;
  }

  const language = languageSelect.value as Language;
  languageSelect.value = language;
  const me = meInput.value || 'Player 1';
  const peer = peerInput.value || 'Player 2';
  const localId = mode === 'solo' ? 'p1' : 'host';
  const remoteId = mode === 'solo' ? undefined : 'client';
  const players = [localId];
  if (remoteId) players.push(remoteId);

  const minWordLength = Math.max(1, Math.floor(Number(minLengthInput.value) || 2));
  setMinWordLength(minWordLength);

  const timerDurationSec = resolveTimerDurationSeconds();
  const timerEnabled = timerEnabledToggle.checked && timerDurationSec > 0;
  const shouldStartTimerNow = mode === 'solo';

  await ensureLanguage(language);

  const state = game.start(language, players);
  meta = {
    mode,
    language,
    isHost: mode === 'host' || mode === 'solo',
    localPlayerId: localId,
    remotePlayerId: remoteId,
    sessionId: state.sessionId,
    minWordLength,
    timerEnabled,
    timerDurationSec,
    // In host P2P mode, start the first timer only after both users are connected.
    turnDeadline: timerEnabled && shouldStartTimerNow ? Date.now() + timerDurationSec * 1000 : null
  };
  labels = { [localId]: me };
  if (remoteId) {
    labels[remoteId] = peer;
  }
  currentState = state;
  placements = [];
  rackOrder = [];
  rackOrderSessionId = state.sessionId;
  resetTurnTimer();
  renderAll();
  updateValidation();
  appendLog(`Started ${mode} game as ${me}`);

  await persistSnapshot();

  if (mode === 'host') {
    buildHostOffer();
  }
}

async function buildHostOffer() {
  if (mode !== 'host') {
    appendLog('Switch to Host mode to create an offer.');
    return;
  }
  await ensureLanguage(languageSelect.value as Language);

  const callbacks = buildCallbacks();
  const { connection: conn, offer, applyAnswer: apply } = await createHost(callbacks);
  connection = conn;
  hostApplyAnswer = apply;
  offerText.value = offer;
  offerQr.src = await toQrDataUrl(offer);
  p2pStatus.textContent = 'Offer created - waiting for answer';
  p2pStatus.className = 'pill';
  appendLog('Offer created. Share this code/QR, then paste the answer you get back.');
}

async function applyHostAnswer() {
  if (!hostApplyAnswer) {
    appendLog('Create an offer first.');
    return;
  }
  const answer = answerText.value.trim();
  if (!answer) {
    appendLog('Paste or scan an answer first.');
    return;
  }
  await hostApplyAnswer(answer);
  p2pStatus.textContent = 'Connecting...';
  p2pStatus.className = 'pill';
  appendLog('Answer applied. Waiting for data channel to open.');
}

async function buildClientAnswer() {
  const offer = hostOfferInput.value.trim();
  if (!offer) {
    appendLog('Paste or scan host offer first.');
    return;
  }
  const callbacks = buildCallbacks();
  const { connection: conn, answer } = await createClient(callbacks, offer);
  connection = conn;
  clientAnswer.value = answer;
  answerQr.src = await toQrDataUrl(answer);
  p2pStatus.textContent = 'Answer ready - share with host';
  p2pStatus.className = 'pill';
  appendLog('Answer created. Share this code/QR back to the host.');
}

function buildCallbacks(): P2PCallbacks {
  return {
    onMessage: (data: unknown) => handleMessage(data),
    onOpen: () => {
      p2pStatus.textContent = 'Connected';
      p2pStatus.className = 'pill active';
      appendLog('Data channel open.');
      if (meta?.isHost && currentState) {
        // If host started the session before the peer connected, arm the initial turn timer now.
        if (meta.timerEnabled && meta.timerDurationSec && !meta.turnDeadline) {
          resetTurnTimer();
          void persistSnapshot();
        }
        appendLog('Host: sending sync to peer.');
        sendSync();
      } else {
        appendLog('Client: requesting sync from host.');
        connection?.send({ type: 'REQUEST_SYNC' });
      }
    },
    onClose: () => {
      handleDisconnect();
    },
    onError: (err: unknown) => {
      appendLog(`P2P error: ${String(err)}`);
    },
    onLog: (msg: string) => appendLog(msg),
    onConnectionStateChange: (state) => {
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        handleDisconnect();
      }
    }
  };
}

function handleDisconnect() {
  // Guard: If connection is null, we are likely manually resetting/reconnecting,
  // so ignore callbacks from dying connections to prevent loops.
  if (!connection) return;

  if (p2pStatus.textContent === 'Connection lost') return;
  p2pStatus.textContent = 'Connection lost';
  p2pStatus.className = 'pill danger';
  appendLog('P2P connection lost or failed.');

  // If we are in the middle of a game, try to help the user reconnect.
  if (currentState && mode !== 'solo') {
    showToast('Connection lost. Attempting to restore...', 'danger');
    void triggerReconnect();
  }
}

async function triggerReconnect() {
  if (mode === 'solo') return;

  // Cleanup old connection if exists, preventing loop via null check in handleDisconnect
  if (connection) {
    const old = connection;
    connection = null; // Sentinel to block handleDisconnect loop
    try {
      old.close();
    } catch (e) {
      // ignore
    }
  }

  // Ensure setup is visible so users can see the handshake UI
  if (settingsHidden) {
    settingsHidden = false;
    renderVisibility();
  }

  if (mode === 'host') {
    appendLog('Host: Connection lost. Recreating offer...');
    // Small delay to ensure previous connection teardown
    await new Promise(r => setTimeout(r, 500));
    await buildHostOffer();
    showToast('Connection lost. New offer created - ask client to scan.', 'info', 6000);
  } else if (mode === 'client') {
    appendLog('Client: Connection lost. Please re-scan host offer.');
    p2pStatus.textContent = 'Disconnected';
    p2pStatus.className = 'pill'; // Reset danger class
    showToast('Connection lost. Please scan host offer again.', 'danger', 6000);
  }
}


async function handleMessage(data: unknown) {
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
    game.resume(msg.state);
    currentState = game.getState();
    rackOrder = [];
    rackOrderSessionId = currentState.sessionId;
    placements = [];
    remoteDraft = null;
    languageSelect.value = meta.language;
    mode = meta.mode;
    applyModeUI();
    applyTimerInputFromMeta();
    applyMinLengthInputFromMeta();
    if (meta.timerEnabled && meta.turnDeadline) {
      startTimerTicker();
    } else {
      stopTimerTicker();
    }
    updateValidation();
    renderAll();
    await persistSnapshot();
    appendLog('Synced state from peer.');
    // Show "timeout auto-pass" banner when we learn about it.
    if (meta) maybeShowTimeoutToastFromMeta(meta);
    return;
  }

  if (msg.type === 'DRAFT_PLACEMENTS') {
    // Draft placements are a visual-only preview of the current-turn player's in-progress move.
    // Ignore until we have a game state (i.e., synced).
    if (!currentState) return;
    remoteDraft = {
      playerId: msg.playerId,
      placements: msg.placements,
      moveNumber: msg.moveNumber
    };
    renderBoard();
    return;
  }

  if (msg.type === 'REQUEST_SYNC') {
    if (meta?.isHost && currentState) sendSync();
    return;
  }

  if (!meta?.isHost) {
    appendLog('Received action but not host; ignoring.');
    return;
  }

  await ensureLanguage(meta.language);

  if (msg.type === 'ACTION_MOVE') {
    remoteDraft = null;
    const result = await game.placeMove(
      msg.playerId,
      msg.placements,
      (word, lang) => hasWord(word, lang)
    );
    if (result.success) {
      currentState = game.getState();
      resetTurnTimer();
      await persistSnapshot();
      sendSync();
      renderAll();
    } else {
      appendLog(result.message ?? 'Move rejected');
    }
  } else if (msg.type === 'ACTION_PASS') {
    remoteDraft = null;
    const result = game.passTurn(msg.playerId);
    if (result.success) {
      currentState = game.getState();
      resetTurnTimer();
      await persistSnapshot();
      sendSync();
      renderAll();
    }
  } else if (msg.type === 'ACTION_EXCHANGE') {
    remoteDraft = null;
    const result = game.exchangeTiles(msg.playerId, msg.tileIds);
    if (result.success) {
      currentState = game.getState();
      resetTurnTimer();
      await persistSnapshot();
      sendSync();
      renderAll();
    } else {
      appendLog(result.message ?? 'Exchange rejected');
    }
  }
}

async function submitMove() {
  if (!currentState || !meta) return;
  if (placements.length === 0) {
    appendLog('Place tiles before confirming.');
    return;
  }

  if (meta.isHost || meta.mode === 'solo') {
    await ensureLanguage(meta.language);
    const result = await game.placeMove(
      meta.localPlayerId,
      placements,
      (word, lang) => hasWord(word, lang)
    );
    if (!result.success) {
      appendLog(result.message ?? 'Invalid move');
      return;
    }
    currentState = game.getState();
    resetTurnTimer();
    placements = [];
    updateValidation();
    renderAll();
    await persistSnapshot();
    sendSync();
  } else {
    connection?.send({
      type: 'ACTION_MOVE',
      placements,
      playerId: meta.localPlayerId
    } satisfies ActionMessage);
    placements = [];
    sendDraftPlacements();
    renderBoard();
    renderRack();
    updateValidation();
    appendLog('Move sent to host');
  }
}

async function submitPass() {
  if (!currentState || !meta) return;
  if (meta.isHost || meta.mode === 'solo') {
    const result = game.passTurn(meta.localPlayerId);
    if (!result.success) {
      appendLog(result.message ?? 'Cannot pass');
      return;
    }
    currentState = game.getState();
    resetTurnTimer();
    await persistSnapshot();
    renderAll();
    sendSync();
  } else {
    connection?.send({ type: 'ACTION_PASS', playerId: meta.localPlayerId } satisfies ActionMessage);
    appendLog('Pass sent to host');
  }
}

async function submitExchange() {
  if (!currentState || !meta) return;
  const tileIds =
    placements.length > 0
      ? placements.map((p) => p.tile.id)
      : selectedTileId
        ? [selectedTileId]
        : [];
  if (tileIds.length === 0) {
    appendLog('Select a tile to exchange (tap a rack tile).');
    return;
  }
  placements = [];
  selectedTileId = null;
  renderBoard();
  renderRack();
  updateValidation();

  if (meta.isHost || meta.mode === 'solo') {
    const result = game.exchangeTiles(meta.localPlayerId, tileIds);
    if (!result.success) {
      appendLog(result.message ?? 'Exchange rejected');
      return;
    }
    currentState = game.getState();
    resetTurnTimer();
    await persistSnapshot();
    renderAll();
    sendSync();
  } else {
    connection?.send({
      type: 'ACTION_EXCHANGE',
      playerId: meta.localPlayerId,
      tileIds
    } satisfies ActionMessage);
    appendLog('Exchange sent to host');
  }
}

function sendSync() {
  if (!connection || !currentState || !meta) return;
  const payload: ActionMessage = {
    type: 'SYNC_STATE',
    state: currentState,
    meta,
    labels
  };
  connection.send(payload);
  appendLog('Sync pushed to peer.');
}

function sendDraftPlacements(nextPlacements: Placement[] = placements) {
  if (!connection || !currentState || !meta) return;
  if (meta.mode === 'solo') return;
  if (!connection.dataChannelReady) return;
  // Only broadcast drafts for the current-turn player.
  if (currentState.currentPlayer !== meta.localPlayerId) return;
  connection.send({
    type: 'DRAFT_PLACEMENTS',
    playerId: meta.localPlayerId,
    placements: nextPlacements,
    moveNumber: currentState.moveNumber
  } satisfies ActionMessage);
}

function syncLocalRackOrder(state: GameState, session: SessionMeta) {
  if (rackOrderSessionId !== state.sessionId) {
    rackOrder = [];
    rackOrderSessionId = state.sessionId;
  }
  const rack = state.racks[session.localPlayerId] ?? [];
  rackOrder = reconcileOrder(rackOrder, rack, (t) => t.id);
}

async function ensureLanguage(language: Language) {
  const status = await ensureDictionary(language);
  if (!status.available) {
    appendLog(`Dictionary ${language} missing. Prompting download.`);
    await downloadLanguage(language);
  }
  await refreshDictStatus();
}

async function downloadLanguage(language: Language) {
  const result = await downloadDictionary(language);
  if (result.available) {
    appendLog(`Downloaded ${language.toUpperCase()} dictionary (${result.words ?? '?'} words)`);
  } else {
    appendLog(`Failed to download ${language} dictionary`);
  }
  await refreshDictStatus();
}

async function refreshDictStatus() {
  const [en, ru] = await Promise.all([ensureDictionary('en'), ensureDictionary('ru')]);
  const icon = (available: boolean) => (available ? '✅' : '❌');

  // Header pill summary
  dictStatus.textContent = `EN ${icon(en.available)} • RU ${icon(ru.available)}`;
  dictStatus.classList.toggle('danger', !en.available || !ru.available);

  // Dictionary buttons
  dictEnIcon.textContent = icon(en.available);
  dictRuIcon.textContent = icon(ru.available);
}

function startDictionaryAutoCheck() {
  // Keep UI indicators correct if IndexedDB is updated elsewhere
  window.addEventListener('focus', () => void refreshDictStatus());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshDictStatus();
  });
  window.setInterval(() => void refreshDictStatus(), 30_000);
}

async function persistSnapshot() {
  if (!currentState || !meta) return;
  const payload: SnapshotPayload = {
    state: currentState,
    meta,
    labels
  };
  await saveSnapshot('last-session', payload);
  pendingSnapshot = payload;
  resumeBtn.disabled = false;
  clearSnapshotBtn.disabled = false;
  resumeNote.textContent = `Saved session (${meta.mode}) as ${labels[meta.localPlayerId] ?? ''}`;
}

async function checkSavedSnapshot() {
  const saved = await loadSnapshot<SnapshotPayload>('last-session');
  pendingSnapshot = saved;
  if (saved) {
    resumeBtn.disabled = false;
    clearSnapshotBtn.disabled = false;
    resumeNote.textContent = `Found saved session (${saved.meta.mode})`;
  }
}

async function resumeSnapshot() {
  if (!pendingSnapshot) return;
  await ensureLanguage(pendingSnapshot.meta.language);
  meta = pendingSnapshot.meta;
  labels = pendingSnapshot.labels;
  languageSelect.value = pendingSnapshot.meta.language;
  mode = pendingSnapshot.meta.mode;
  applyModeUI();
  applyTimerInputFromMeta();
  applyMinLengthInputFromMeta();
  if (meta.timerEnabled && meta.turnDeadline) {
    startTimerTicker();
  } else {
    stopTimerTicker();
  }
  game.resume(pendingSnapshot.state);
  currentState = game.getState();
  placements = [];
  updateValidation();
  renderAll();
  maybeShowTimeoutToastFromMeta(meta);
  appendLog('Resumed saved game.');

  if (mode !== 'solo') {
    appendLog('Resumed P2P session. Connection needed.');
    void triggerReconnect();
  }
}

function appendLog(msg: string) {
  const now = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.textContent = `[${now}] ${msg}`;
  logEl.prepend(entry);
}

function copyToClipboard(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => appendLog('Copied to clipboard'));
}

async function scanInto(target: HTMLTextAreaElement, onScanned?: (data: string) => void | Promise<void>) {
  // Create modal UI
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #000; display: flex; flex-direction: column; z-index: 2000;
  `;

  const videoContainer = document.createElement('div');
  videoContainer.style.cssText = `position: relative; width: 100%; flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #000;`;

  const video = document.createElement('video');
  video.style.cssText = `width: 100%; height: 100%; object-fit: cover;`;
  video.setAttribute('playsinline', 'true'); // Required for iOS
  videoContainer.appendChild(video);

  // Add a scan reticle/overlay
  const reticle = document.createElement('div');
  reticle.style.cssText = `
    position: absolute; width: 250px; height: 250px;
    border: 2px solid rgba(255, 255, 255, 0.8);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
    border-radius: 16px;
    pointer-events: none;
  `;
  videoContainer.appendChild(reticle);

  const controls = document.createElement('div');
  controls.style.cssText = `
    width: 100%; background: #000;
    display: flex; justify-content: center; padding: 20px; padding-bottom: max(20px, env(safe-area-inset-bottom));
  `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Cancel Scan';
  closeBtn.className = 'primary danger';
  closeBtn.style.minWidth = '120px';
  closeBtn.onclick = () => stop();
  controls.appendChild(closeBtn);

  modal.appendChild(videoContainer);
  modal.appendChild(controls);
  document.body.appendChild(modal);

  let stream: MediaStream | null = null;
  let animationFrameId: number | null = null;
  let isActive = true;

  const stop = () => {
    isActive = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    if (document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  };

  try {
    // Request camera
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (!isActive) {
      // User cancelled while waiting for permission
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      appendLog('Canvas context not supported');
      stop();
      return;
    }

    const tick = () => {
      if (!isActive) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          target.value = code.data;
          appendLog('QR scanned successfully');
          if (onScanned) {
            Promise.resolve(onScanned(code.data)).catch((err) =>
              appendLog(`Auto-connect error: ${String(err)}`)
            );
          }
          stop();
          return;
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    tick();
  } catch (err) {
    appendLog(`Camera error: ${err}`);
    stop();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${BASE_PATH}sw.js`)
      .then(() => appendLog('Service worker registered'))
      .catch((err) => appendLog(`SW registration failed: ${String(err)}`));
  });
}
