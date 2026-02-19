import type { GameState, Language, Placement, Tile } from '../core/types';
import type { SessionMeta } from '../types';
import { BOARD_SIZE } from '../core/game';
import { buildPremiumMap } from '../core/boardLayout';
import { escapeHtml } from '../utils/escapeHtml';


export interface UiElements {
    boardEl: HTMLDivElement;
    rackEl: HTMLDivElement;
    rackOwnerEl: HTMLSpanElement;
    turnIndicator: HTMLSpanElement;
    timerDisplay: HTMLSpanElement;
    wordCheckStatus: HTMLSpanElement;
    wordLengthStatus: HTMLSpanElement;
    endgameScanStatus: HTMLSpanElement;
    scoresEl: HTMLDivElement;
    logEl: HTMLDivElement;
    bagCountEl: HTMLElement;
    moveHistoryEl: HTMLDivElement;
    settingsSection: HTMLElement;
    confirmMoveBtn: HTMLButtonElement;
    passBtn: HTMLButtonElement;
    exchangeBtn: HTMLButtonElement;
    clearPlacementsBtn: HTMLButtonElement;
    mixRackBtn: HTMLButtonElement;
    languageSelect: HTMLSelectElement;
    russianVariantSelect: HTMLSelectElement;
    russianVariantWrapper: HTMLElement;
    minLengthInput: HTMLInputElement;
    timerEnabledToggle: HTMLInputElement;
    timerMinutesWrapper: HTMLElement;
    timerInput: HTMLInputElement;
    meInput: HTMLInputElement;
    peerInput: HTMLInputElement;
    modeTabs: HTMLDivElement;
    hostCard: HTMLDivElement;
    clientCard: HTMLDivElement;
    languageWrapper: HTMLElement;
    timerWrapper: HTMLElement;
    offlineStatus: HTMLSpanElement;
    dictStatus: HTMLSpanElement;
    p2pStatus: HTMLSpanElement;
    versionEl: HTMLParagraphElement | null;
    readyOverlay: HTMLDivElement;
    readyStatusEl: HTMLParagraphElement;
    readyBtn: HTMLButtonElement;
    gameOverOverlay: HTMLDivElement;
    gameOverReasonEl: HTMLParagraphElement;
    gameOverScoresEl: HTMLDivElement;
    gameOverStatsEl: HTMLDivElement;
    rematchStatusEl: HTMLParagraphElement;
    rematchBtnOverlay: HTMLButtonElement;
    viewBoardBtn: HTMLButtonElement;
    gameOverBanner: HTMLDivElement;
    gameOverBannerScoresEl: HTMLSpanElement;
    rematchBannerStatusEl: HTMLSpanElement;
    rematchBtnBanner: HTMLButtonElement;
    showResultsBtn: HTMLButtonElement;
    disconnectOverlay: HTMLDivElement;
    disconnectMessage: HTMLParagraphElement;
}

export type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

export function renderNetworkStatus(offlineStatus: HTMLSpanElement): void {
    const online = navigator.onLine;
    offlineStatus.textContent = online ? 'Online' : 'Offline';
    offlineStatus.classList.toggle('danger', !online);
}

export function renderVersion(versionEl: HTMLParagraphElement | null, appVersion: string): void {
    if (!versionEl) return;
    const version = typeof appVersion === 'string' ? appVersion : 'dev';
    versionEl.textContent = `Version ${version}`;
}

export function applyTimerInputFromMeta(
    meta: SessionMeta | null,
    timerEnabledToggle: HTMLInputElement,
    timerInput: HTMLInputElement,
    timerMinutesWrapper: HTMLElement
): void {
    if (!meta) return;
    if (meta.timerEnabled === undefined) {
        meta.timerEnabled = Boolean(meta.timerDurationSec);
    }
    timerEnabledToggle.checked = Boolean(meta.timerEnabled);
    if (meta.timerDurationSec) {
        const minutes = Math.max(1, Math.round(meta.timerDurationSec / 60));
        timerInput.value = String(minutes);
    }
    updateTimerSettingsUI(timerEnabledToggle, timerInput, timerMinutesWrapper);
}

export function applyMinLengthInputFromMeta(
    meta: SessionMeta | null,
    minLengthInput: HTMLInputElement
): void {
    if (!meta?.minWordLength) return;
    minLengthInput.value = String(Math.max(1, Math.floor(meta.minWordLength)));
}

export function resolveTimerDurationSeconds(timerInput: HTMLInputElement): number {
    const minutes = Number(timerInput.value) || 0;
    if (Number.isNaN(minutes) || minutes <= 0) return 0;
    return Math.min(Math.max(minutes, 1), 10) * 60;
}

export function updateTimerSettingsUI(
    timerEnabledToggle: HTMLInputElement,
    timerInput: HTMLInputElement,
    timerMinutesWrapper: HTMLElement,
    isJoin = false
): void {
    const enabled = timerEnabledToggle.checked;
    timerEnabledToggle.disabled = isJoin;
    timerInput.disabled = isJoin || !enabled;
    if (timerMinutesWrapper) {
        timerMinutesWrapper.style.display = isJoin || !enabled ? 'none' : '';
    }
}

export function renderHandshakeVisibility(
    hostCard: HTMLDivElement,
    clientCard: HTMLDivElement,
    mode: 'solo' | 'host' | 'client'
): void {
    const hostVisible = mode === 'host';
    const clientVisible = mode === 'client';
    hostCard.style.display = hostVisible ? 'block' : 'none';
    clientCard.style.display = clientVisible ? 'block' : 'none';
    hostCard.setAttribute('aria-hidden', hostVisible ? 'false' : 'true');
    clientCard.setAttribute('aria-hidden', clientVisible ? 'false' : 'true');
}

export function applyModeUI(
    mode: 'solo' | 'host' | 'client',
    modeTabs: HTMLDivElement,
    hostCard: HTMLDivElement,
    clientCard: HTMLDivElement,
    renderModeControlsFn: () => void
): void {
    modeTabs.querySelectorAll('button').forEach((b) => {
        const isActive = b.dataset.mode === mode;
        b.classList.toggle('active', isActive);
    });
    renderHandshakeVisibility(hostCard, clientCard, mode);
    renderModeControlsFn();
}

export function renderModeControls(
    mode: 'solo' | 'host' | 'client',
    meInput: HTMLInputElement,
    peerInput: HTMLInputElement,
    minLengthInput: HTMLInputElement,
    languageSelect: HTMLSelectElement,
    russianVariantSelect: HTMLSelectElement,
    russianVariantWrapper: HTMLElement,
    languageWrapper: HTMLElement,
    timerInput: HTMLInputElement,
    timerEnabledToggle: HTMLInputElement,
    timerWrapper: HTMLElement,
    timerMinutesWrapper: HTMLElement,
    startBtn: HTMLButtonElement
): void {
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
    russianVariantSelect.disabled = isJoin;
    if (languageWrapper) {
        languageWrapper.style.display = isJoin ? 'none' : '';
    }
    if (!isJoin) {
        const language = languageSelect.value as Language;
        russianVariantWrapper.style.display = language === 'ru' ? 'flex' : 'none';
    }
    timerInput.disabled = isJoin;
    timerEnabledToggle.disabled = isJoin;
    if (timerWrapper) {
        timerWrapper.style.display = isJoin ? 'none' : '';
    }
    updateTimerSettingsUI(timerEnabledToggle, timerInput, timerMinutesWrapper, isJoin);
    startBtn.style.display = isJoin ? 'none' : '';
}

export function renderVisibility(
    settingsSection: HTMLElement,
    logEl: HTMLDivElement,
    toggleSetupBtn: HTMLButtonElement,
    toggleLogsBtn: HTMLButtonElement,
    settingsHidden: boolean,
    logsHidden: boolean
): void {
    settingsSection.style.display = settingsHidden ? 'none' : '';
    settingsSection.setAttribute('aria-hidden', settingsHidden ? 'true' : 'false');
    logEl.style.display = logsHidden ? 'none' : '';
    logEl.setAttribute('aria-hidden', logsHidden ? 'true' : 'false');
    toggleSetupBtn.textContent = settingsHidden ? 'Show setup' : 'Hide setup';
    toggleSetupBtn.setAttribute('aria-pressed', settingsHidden ? 'true' : 'false');
    toggleLogsBtn.textContent = logsHidden ? 'Show logs' : 'Hide logs';
    toggleLogsBtn.setAttribute('aria-pressed', logsHidden ? 'true' : 'false');
}

export function renderBoard(
    boardEl: HTMLDivElement,
    turnIndicator: HTMLSpanElement,
    currentState: GameState | null,
    meta: SessionMeta | null,
    placements: Placement[],
    validationStatus: ValidationStatus,
    remoteDraft: { playerId: string; placements: Placement[]; moveNumber: number } | null,
    labels: Record<string, string>
): void {
    const state = currentState;
    if (!state) {
        boardEl.removeAttribute('role');
        boardEl.innerHTML = '<p class="hint">Start a session to see the board.</p>';
        return;
    }
    boardEl.setAttribute('role', 'grid');
    boardEl.setAttribute('aria-label', 'Game board');

    const placementKeys = new Set(placements.map((p) => `${p.x},${p.y}`));
    const lastMoveKeys = new Set((state.lastMove?.placed ?? []).map((p) => `${p.x},${p.y}`));
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
            const isLastMove = !isNew && lastMoveKeys.has(`${x},${y}`);
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
                isLastMove ? 'last-move' : '',
                validationClass
            ]
                .filter(Boolean)
                .join(' ');
            const parts: string[] = [];
            if (tile) parts.push(`${tile.letter} (${tile.value})`);
            else if (premium) parts.push(PREMIUM_LABELS[premium] ?? '');
            else parts.push('Empty');
            if (isNew) parts.push('pending');
            if (isLastMove) parts.push('last move');
            const cellLabel = parts.filter(Boolean).join(', ');
            cells.push(
                `<div class="${classes}" role="gridcell" tabindex="0" aria-label="${cellLabel}" data-x="${x}" data-y="${y}">
          ${tile ? `<span class="letter" aria-hidden="true">${escapeHtml(tile.letter)}</span><span class="value" aria-hidden="true">${escapeHtml(String(tile.value))}</span>` : ''}
        </div>`
            );
        }
        rows.push(`<div class="row" role="row">${cells.join('')}</div>`);
    }
    boardEl.innerHTML = rows.join('');

    turnIndicator.textContent = labels[state.currentPlayer] ?? state.currentPlayer;
    turnIndicator.classList.toggle('active', meta?.localPlayerId === state.currentPlayer);
}

export function renderRack(
    rackEl: HTMLDivElement,
    rackOwnerEl: HTMLSpanElement,
    currentState: GameState | null,
    meta: SessionMeta | null,
    placements: Placement[],
    selectedTileId: string | null,
    rackOrder: string[],
    syncLocalRackOrderFn: (state: GameState, session: SessionMeta) => void,
    labels: Record<string, string>
): void {
    const state = currentState;
    if (!state || !meta) {
        rackEl.innerHTML = '<p class="hint">No rack yet.</p>';
        return;
    }
    syncLocalRackOrderFn(state, meta);
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

export function renderScores(
    scoresEl: HTMLDivElement,
    currentState: GameState | null,
    labels: Record<string, string>
): void {
    const state = currentState;
    if (!state) {
        scoresEl.innerHTML = '<p class="hint">No scores yet.</p>';
        return;
    }
    const parts = Object.entries(state.scores).map(
        ([id, score]) =>
            `<div class="score">
        <span>${escapeHtml(labels[id] ?? id)}</span>
        <strong>${score}</strong>
      </div>`
    );
    scoresEl.innerHTML = parts.join('');
}

export function renderStats(
    bagCountEl: HTMLElement,
    moveHistoryEl: HTMLDivElement,
    currentState: GameState | null,
    labels: Record<string, string>
): void {
    const state = currentState;
    if (!state) {
        bagCountEl.textContent = '';
        moveHistoryEl.innerHTML = '<p class="hint">Start a game to see stats.</p>';
        return;
    }

    bagCountEl.textContent = String(state.bag.length);

    const byPlayer = state.players.map((id) => ({
        id,
        entries: state.history.filter((h) => h.playerId === id)
    }));

    const formatEntry = (entry: (typeof state.history)[number]) => {
        if (entry.type === 'MOVE') {
            const words = entry.words.map((w) => escapeHtml(w)).join(', ');
            return `#${entry.moveNumber} — ${words} (+${entry.scoreDelta})`;
        }
        if (entry.type === 'PASS') return `#${entry.moveNumber} — Pass`;
        return `#${entry.moveNumber} — Exchange ${entry.exchangedTiles}`;
    };

    const blocks = byPlayer.map(({ id, entries }) => {
        const name = escapeHtml(labels[id] ?? id);
        const items = entries.length
            ? `<ol class="history-list">${entries
                .map((e) => `<li>${formatEntry(e)}</li>`)
                .join('')}</ol>`
            : '<p class="hint">No moves yet.</p>';
        return `<div class="history-player"><h4>${name}</h4>${items}</div>`;
    });

    moveHistoryEl.innerHTML = blocks.join('');
}

export function renderTile(tile: Tile, selected = false, pending = false): string {
    const classes = ['tile'];
    if (selected) classes.push('selected');
    if (pending) classes.push('pending');
    const isUnassignedBlank = tile.blank && tile.letter === ' ';
    if (isUnassignedBlank) classes.push('blank');
    const letterDisplay = isUnassignedBlank ? '?' : escapeHtml(tile.letter);
    const ariaLabel = `${isUnassignedBlank ? 'Blank' : tile.letter}, value ${tile.value}`;
    return `<button class="${classes.join(' ')}" data-tile="${tile.id}" aria-label="${ariaLabel}">
    <span class="letter" aria-hidden="true">${letterDisplay}</span>
    <span class="value" aria-hidden="true">${escapeHtml(String(tile.value))}</span>
  </button>`;
}

const PREMIUM_LABELS: Record<string, string> = {
    tw: 'Triple Word',
    dw: 'Double Word',
    tl: 'Triple Letter',
    dl: 'Double Letter',
    center: 'Center'
};

const premiumMap = buildPremiumMap();

export function premiumClass(x: number, y: number): string {
    return (premiumMap.get(`${x},${y}`) ?? '').toLowerCase();
}


