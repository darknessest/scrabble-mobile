import './style.css';
import { BOARD_SIZE, ScrabbleGame } from './core/game';
import type { GameState, Language, Placement, Tile } from './core/types';
import {
  downloadDictionary,
  ensureDictionary,
  hasWord,
  setMinWordLength
} from './dictionary/dictionaryService';
import { createClient, createHost, type P2PConnection } from './network/p2p';
import { toQrDataUrl } from './network/qr';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './storage/indexedDb';

type Mode = 'solo' | 'host' | 'client';

interface SessionMeta {
  mode: Mode;
  language: Language;
  isHost: boolean;
  localPlayerId: string;
  remotePlayerId?: string;
  sessionId: string;
}

interface SnapshotPayload {
  state: GameState;
  meta: SessionMeta;
  labels: Record<string, string>;
}

type ActionMessage =
  | { type: 'ACTION_MOVE'; placements: Placement[]; playerId: string }
  | { type: 'ACTION_PASS'; playerId: string }
  | { type: 'ACTION_EXCHANGE'; playerId: string; tileIds: string[] }
  | { type: 'REQUEST_SYNC' }
  | { type: 'SYNC_STATE'; state: GameState; meta: SessionMeta; labels: Record<string, string> };

const BASE_PATH = import.meta.env.BASE_URL ?? '/';
const game = new ScrabbleGame();

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="shell">
    <header class="top">
      <div>
        <p class="eyebrow">Mobile-first • Offline • P2P</p>
        <h1>Scrabble PWA</h1>
      </div>
      <div class="status-row">
        <span id="offline-status" class="pill">...</span>
        <span id="dict-status" class="pill">Dictionaries: checking...</span>
        <span id="p2p-status" class="pill">P2P: idle</span>
      </div>
    </header>

    <section class="cards">
      <div class="card">
        <div class="card-head">
          <h3>Language & Dictionaries</h3>
          <button class="ghost" id="refresh-dicts">Re-check</button>
        </div>
        <div class="row gap">
          <label class="stack">
            <span class="label">Language</span>
            <select id="language">
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <div class="stack">
            <span class="label">Download packs</span>
            <div class="row gap">
              <button id="download-en" class="ghost">EN pack</button>
              <button id="download-ru" class="ghost">RU pack</button>
            </div>
            <p class="hint">Downloads top-50k frequency lists (MIT) for offline validation; cached on device.</p>
          </div>
          <div class="stack">
            <span class="label">Minimum word length</span>
            <input id="min-length" type="number" min="1" value="2" />
            <p class="hint">Words shorter than this are rejected (e.g., set to 2 or 3).</p>
          </div>
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
            <div class="row gap">
              <button id="build-offer" class="primary">Create offer</button>
              <button id="copy-offer" class="ghost">Copy</button>
            </div>
          </div>
          <div class="stack flex1">
            <span class="label">Answer from partner</span>
            <textarea id="answer-text" rows="3" placeholder="Scan/paste answer"></textarea>
            <div class="row gap">
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
            <div class="row gap">
              <button id="scan-offer" class="ghost">Scan QR</button>
              <button id="build-answer" class="primary">Build answer</button>
            </div>
          </div>
          <div class="stack flex1">
            <span class="label">Your answer (share back)</span>
            <textarea id="client-answer" rows="3" readonly></textarea>
            <div class="row gap">
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
      <div class="card board-card">
        <div class="card-head">
          <h3>Board</h3>
          <div class="row gap">
            <span class="label">Turn:</span>
            <span id="turn-indicator" class="pill"></span>
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
          <button id="pass-btn" class="ghost">Pass</button>
          <button id="exchange-btn" class="ghost">Exchange selected</button>
        </div>
      </div>

      <div class="card info-card">
        <div class="card-head">
          <h3>Scores & Status</h3>
          <button id="request-sync" class="ghost">Request sync</button>
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
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const resumeBtn = document.querySelector<HTMLButtonElement>('#resume-btn')!;
const clearSnapshotBtn = document.querySelector<HTMLButtonElement>('#clear-snapshot')!;
const resumeNote = document.querySelector<HTMLParagraphElement>('#resume-note')!;
const minLengthInput = document.querySelector<HTMLInputElement>('#min-length')!;
const modeTabs = document.querySelector<HTMLDivElement>('#mode-tabs')!;
const meInput = document.querySelector<HTMLInputElement>('#me-name')!;
const peerInput = document.querySelector<HTMLInputElement>('#peer-name')!;
const boardEl = document.querySelector<HTMLDivElement>('#board')!;
const rackEl = document.querySelector<HTMLDivElement>('#rack')!;
const rackOwnerEl = document.querySelector<HTMLSpanElement>('#rack-owner')!;
const turnIndicator = document.querySelector<HTMLSpanElement>('#turn-indicator')!;
const scoresEl = document.querySelector<HTMLDivElement>('#scores')!;
const logEl = document.querySelector<HTMLDivElement>('#log')!;
const confirmMoveBtn = document.querySelector<HTMLButtonElement>('#confirm-move')!;
const clearPlacementsBtn = document.querySelector<HTMLButtonElement>('#clear-placements')!;
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
const requestSyncBtn = document.querySelector<HTMLButtonElement>('#request-sync')!;

let mode: Mode = 'solo';
let meta: SessionMeta | null = null;
let labels: Record<string, string> = {};
let currentState: GameState | null = null;
let placements: Placement[] = [];
let selectedTileId: string | null = null;
let connection: P2PConnection | null = null;
let hostApplyAnswer: ((answer: string) => Promise<void>) | null = null;
let pendingSnapshot: SnapshotPayload | null = null;

setupEvents();
renderNetworkStatus();
renderHandshakeVisibility();
refreshDictStatus();
checkSavedSnapshot();
registerServiceWorker();

function setupEvents() {
  window.addEventListener('online', renderNetworkStatus);
  window.addEventListener('offline', renderNetworkStatus);

  modeTabs.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!target) return;
    modeTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    target.classList.add('active');
    mode = target.dataset.mode as Mode;
    renderHandshakeVisibility();
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
    renderBoard();
    renderRack();
  });
  passBtn.addEventListener('click', () => submitPass());
  exchangeBtn.addEventListener('click', () => submitExchange());

  buildOfferBtn.addEventListener('click', () => buildHostOffer());
  copyOfferBtn.addEventListener('click', () => copyToClipboard(offerText.value));
  applyAnswerBtn.addEventListener('click', () => applyHostAnswer());
  buildAnswerBtn.addEventListener('click', () => buildClientAnswer());
  copyClientAnswerBtn.addEventListener('click', () => copyToClipboard(clientAnswer.value));
  scanOfferBtn.addEventListener('click', () => scanInto(hostOfferInput));
  scanAnswerBtn.addEventListener('click', () => scanInto(answerText));

  refreshDictsBtn.addEventListener('click', () => refreshDictStatus());
  downloadEnBtn.addEventListener('click', () => downloadLanguage('en'));
  downloadRuBtn.addEventListener('click', () => downloadLanguage('ru'));
  requestSyncBtn.addEventListener('click', () => {
    connection?.send({ type: 'REQUEST_SYNC' });
    appendLog('Requested sync from peer');
  });
  minLengthInput.addEventListener('change', () => {
    const val = Number(minLengthInput.value) || 2;
    setMinWordLength(val);
    appendLog(`Min word length set to ${val}`);
  });

  boardEl.addEventListener('click', onBoardClick);
  rackEl.addEventListener('click', onRackClick);
}

function renderNetworkStatus() {
  const online = navigator.onLine;
  offlineStatus.textContent = online ? 'Online' : 'Offline';
  offlineStatus.classList.toggle('danger', !online);
}

function renderHandshakeVisibility() {
  const hostCard = document.querySelector<HTMLDivElement>('#host-handshake')!;
  const clientCard = document.querySelector<HTMLDivElement>('#client-handshake')!;
  hostCard.style.display = mode === 'host' ? 'block' : 'none';
  clientCard.style.display = mode === 'client' ? 'block' : 'none';
}

function renderBoard() {
  const state = currentState;
  if (!state) {
    boardEl.innerHTML = '<p class="hint">Start a session to see the board.</p>';
    return;
  }

  const placementKeys = new Set(placements.map((p) => `${p.x},${p.y}`));
  const rows: string[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const cells: string[] = [];
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const placed = placements.find((p) => p.x === x && p.y === y);
      const tile = placed?.tile ?? state.board[y][x].tile;
      const premium = premiumClass(x, y);
      const isNew = placementKeys.has(`${x},${y}`);
      const classes = ['cell', premium, isNew ? 'pending' : ''].filter(Boolean).join(' ');
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
  const rack = state.racks[meta.localPlayerId] ?? [];
  const usedIds = new Set(placements.map((p) => p.tile.id));
  const tiles = rack
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
}

function renderTile(tile: Tile, selected = false, pending = false) {
  const classes = ['tile'];
  if (selected) classes.push('selected');
  if (pending) classes.push('pending');
  return `<button class="${classes.join(' ')}" data-tile="${tile.id}">
    <span class="letter">${tile.letter}</span>
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
    placements.push({ x, y, tile });
    selectedTileId = null;
    renderBoard();
    renderRack();
  } else {
    // Remove pending tile if tapped
    const idx = placements.findIndex((p) => p.x === x && p.y === y);
    if (idx >= 0) {
      placements.splice(idx, 1);
      renderBoard();
      renderRack();
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

async function startSession() {
  if (mode === 'client') {
    appendLog('Join mode: paste/scan host offer and build answer.');
    return;
  }

  const language = languageSelect.value as Language;
  const me = meInput.value || 'Player 1';
  const peer = peerInput.value || 'Player 2';
  const localId = mode === 'solo' ? 'p1' : 'host';
  const remoteId = mode === 'solo' ? 'p2' : 'client';

  await ensureLanguage(language);

  const state = game.start(language, [localId, remoteId]);
  meta = {
    mode,
    language,
    isHost: mode === 'host' || mode === 'solo',
    localPlayerId: localId,
    remotePlayerId: remoteId,
    sessionId: state.sessionId
  };
  labels = { [localId]: me, [remoteId]: peer };
  currentState = state;
  placements = [];
  renderAll();
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
}

function buildCallbacks() {
  return {
    onMessage: (data: unknown) => handleMessage(data),
    onOpen: () => {
      p2pStatus.textContent = 'Connected';
      if (meta?.isHost && currentState) {
        sendSync();
      }
    },
    onClose: () => {
      p2pStatus.textContent = 'Disconnected';
    },
    onError: (err: unknown) => {
      appendLog(`P2P error: ${String(err)}`);
    }
  };
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
    placements = [];
    renderAll();
    await persistSnapshot();
    appendLog('Synced state from peer');
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
    const result = await game.placeMove(
      msg.playerId,
      msg.placements,
      (word, lang) => hasWord(word, lang)
    );
    if (result.success) {
      currentState = game.getState();
      await persistSnapshot();
      sendSync();
      renderAll();
    } else {
      appendLog(result.message ?? 'Move rejected');
    }
  } else if (msg.type === 'ACTION_PASS') {
    const result = game.passTurn(msg.playerId);
    if (result.success) {
      currentState = game.getState();
      await persistSnapshot();
      sendSync();
      renderAll();
    }
  } else if (msg.type === 'ACTION_EXCHANGE') {
    const result = game.exchangeTiles(msg.playerId, msg.tileIds);
    if (result.success) {
      currentState = game.getState();
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
    placements = [];
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
    renderBoard();
    renderRack();
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

  if (meta.isHost || meta.mode === 'solo') {
    const result = game.exchangeTiles(meta.localPlayerId, tileIds);
    if (!result.success) {
      appendLog(result.message ?? 'Exchange rejected');
      return;
    }
    currentState = game.getState();
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
  const parts = [];
  parts.push(`EN: ${en.available ? 'ready' : 'missing'}`);
  parts.push(`RU: ${ru.available ? 'ready' : 'missing'}`);
  dictStatus.textContent = parts.join(' • ');
  dictStatus.classList.toggle('danger', !en.available || !ru.available);
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
  game.resume(pendingSnapshot.state);
  currentState = game.getState();
  placements = [];
  renderAll();
  appendLog('Resumed saved game.');
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

async function scanInto(target: HTMLTextAreaElement) {
  const Detector = (window as unknown as {
    BarcodeDetector?: new (opts: { formats: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    }
  }).BarcodeDetector;
  if (!Detector) {
    appendLog('BarcodeDetector not supported on this device.');
    return;
  }
  const detector = new Detector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  return new Promise<void>((resolve) => {
    const tick = async () => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const codes = await detector.detect(canvas);
      if (codes.length > 0) {
        target.value = codes[0].rawValue;
        stream.getTracks().forEach((t) => t.stop());
        appendLog('QR scanned');
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
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
