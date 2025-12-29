import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import { formatGameOverReason } from '../utils/appUtils';

export class GameOverController {
    private meta: SessionMeta | null = null;
    private currentState: GameState | null = null;
    private labels: Record<string, string> = {};
    private gameOverOverlay: HTMLDivElement;
    private gameOverReasonEl: HTMLParagraphElement;
    private gameOverScoresEl: HTMLDivElement;
    private gameOverStatsEl: HTMLDivElement;
    private rematchStatusEl: HTMLParagraphElement;
    private rematchBtnOverlay: HTMLButtonElement;
    private gameOverBanner: HTMLDivElement;
    private gameOverBannerScoresEl: HTMLSpanElement;
    private rematchBannerStatusEl: HTMLSpanElement;
    private rematchBtnBanner: HTMLButtonElement;
    private lastHandledGameOverUiToken: string | null = null;
    private gameOverOverlayDismissed = false;

    constructor(
        gameOverOverlay: HTMLDivElement,
        gameOverReasonEl: HTMLParagraphElement,
        gameOverScoresEl: HTMLDivElement,
        gameOverStatsEl: HTMLDivElement,
        rematchStatusEl: HTMLParagraphElement,
        rematchBtnOverlay: HTMLButtonElement,
        gameOverBanner: HTMLDivElement,
        gameOverBannerScoresEl: HTMLSpanElement,
        rematchBannerStatusEl: HTMLSpanElement,
        rematchBtnBanner: HTMLButtonElement
    ) {
        this.gameOverOverlay = gameOverOverlay;
        this.gameOverReasonEl = gameOverReasonEl;
        this.gameOverScoresEl = gameOverScoresEl;
        this.gameOverStatsEl = gameOverStatsEl;
        this.rematchStatusEl = rematchStatusEl;
        this.rematchBtnOverlay = rematchBtnOverlay;
        this.gameOverBanner = gameOverBanner;
        this.gameOverBannerScoresEl = gameOverBannerScoresEl;
        this.rematchBannerStatusEl = rematchBannerStatusEl;
        this.rematchBtnBanner = rematchBtnBanner;
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setCurrentState(state: GameState | null): void {
        this.currentState = state;
    }

    setLabels(labels: Record<string, string>): void {
        this.labels = labels;
    }

    setGameOverOverlayDismissed(dismissed: boolean): void {
        this.gameOverOverlayDismissed = dismissed;
    }

    private computeEndgameStats(): {
        moves: number;
        passes: number;
        exchanges: number;
        bingos: number;
        bestMove?: { playerId: string; scoreDelta: number; words: string[] };
        longestWord?: { word: string; playerId: string; scoreDelta: number };
    } {
        const state = this.currentState;
        if (!state) return { moves: 0, passes: 0, exchanges: 0, bingos: 0 };
        let moves = 0;
        let passes = 0;
        let exchanges = 0;
        let bingos = 0;
        let bestMove: { playerId: string; scoreDelta: number; words: string[] } | undefined;
        let longestWord: { word: string; playerId: string; scoreDelta: number } | undefined;

        for (const entry of state.history) {
            if (entry.type === 'MOVE') {
                moves += 1;
                if (entry.placedTiles === 7) bingos += 1;
                if (!bestMove || entry.scoreDelta > bestMove.scoreDelta) {
                    bestMove = { playerId: entry.playerId, scoreDelta: entry.scoreDelta, words: entry.words };
                }
                for (const w of entry.words) {
                    const norm = w.trim();
                    if (!norm) continue;
                    if (!longestWord || norm.length > longestWord.word.length) {
                        longestWord = { word: norm, playerId: entry.playerId, scoreDelta: entry.scoreDelta };
                    }
                }
            } else if (entry.type === 'PASS') {
                passes += 1;
            } else if (entry.type === 'EXCHANGE') {
                exchanges += 1;
            }
        }

        return { moves, passes, exchanges, bingos, bestMove, longestWord };
    }

    renderGameOverUi(): void {
        const meta = this.meta;
        if (!meta || !meta.gameOver) {
            this.gameOverOverlay.style.display = 'none';
            this.gameOverOverlay.setAttribute('aria-hidden', 'true');
            this.gameOverBanner.style.display = 'none';
            return;
        }

        const ev = meta.gameOver;
        const scoresText = Object.entries(ev.finalScores)
            .map(([id, score]) => `${this.labels[id] ?? id}: ${score}`)
            .join(' • ');

        this.gameOverReasonEl.textContent = formatGameOverReason(ev.reason);
        this.gameOverScoresEl.innerHTML = `<div class="hint">Final scores</div><div class="gameover-scores-row">${scoresText}</div>`;

        const stats = this.computeEndgameStats();
        const bestMoveText = stats.bestMove
            ? `${this.labels[stats.bestMove.playerId] ?? stats.bestMove.playerId}: +${stats.bestMove.scoreDelta}`
            : '—';
        const longestWordText = stats.longestWord
            ? `${stats.longestWord.word} (${this.labels[stats.longestWord.playerId] ?? stats.longestWord.playerId})`
            : '—';

        this.gameOverStatsEl.innerHTML = [
            `<div class="gameover-stat"><span class="label">Moves</span><strong>${stats.moves}</strong></div>`,
            `<div class="gameover-stat"><span class="label">Passes</span><strong>${stats.passes}</strong></div>`,
            `<div class="gameover-stat"><span class="label">Exchanges</span><strong>${stats.exchanges}</strong></div>`,
            `<div class="gameover-stat"><span class="label">Bingos</span><strong>${stats.bingos}</strong></div>`,
            `<div class="gameover-stat"><span class="label">Best move</span><strong>${bestMoveText}</strong></div>`,
            `<div class="gameover-stat"><span class="label">Longest word</span><strong>${longestWordText}</strong></div>`
        ].join('');

        this.gameOverBannerScoresEl.textContent = scoresText ? `— ${scoresText}` : '';

        const players = this.currentState?.players ?? [meta.localPlayerId, meta.remotePlayerId].filter(Boolean) as string[];
        const baseAt = meta.gameOver.at;
        const requestedBy =
            meta.rematch && meta.rematch.at >= baseAt ? meta.rematch.requestedBy : {};
        const confirmed = players.filter((id) => requestedBy[id]);
        const missing = players.filter((id) => !requestedBy[id]);
        const meRequested = Boolean(requestedBy[meta.localPlayerId]);

        this.rematchBtnOverlay.disabled = meRequested;
        this.rematchBtnBanner.disabled = meRequested;

        if (meta.mode === 'solo') {
            this.rematchStatusEl.textContent = 'Start a new game with the same settings.';
            this.rematchBannerStatusEl.textContent = '';
        } else if (missing.length === 0) {
            this.rematchStatusEl.textContent = 'Starting rematch…';
            this.rematchBannerStatusEl.textContent = '';
        } else if (meRequested) {
            const missingNames = missing.map((id) => this.labels[id] ?? id).join(' & ');
            this.rematchStatusEl.textContent = `Waiting for ${missingNames} to confirm rematch…`;
            this.rematchBannerStatusEl.textContent = `(${confirmed.length}/${players.length} confirmed)`;
        } else {
            this.rematchStatusEl.textContent = 'Confirm rematch to start a new game.';
            this.rematchBannerStatusEl.textContent = `(${confirmed.length}/${players.length} confirmed)`;
        }

        if (!this.gameOverOverlayDismissed) {
            this.gameOverOverlay.style.display = '';
            this.gameOverOverlay.setAttribute('aria-hidden', 'false');
            this.gameOverBanner.style.display = 'none';
        } else {
            this.gameOverOverlay.style.display = 'none';
            this.gameOverOverlay.setAttribute('aria-hidden', 'true');
            this.gameOverBanner.style.display = '';
        }
    }

    maybeShowGameOverToastFromMeta(incoming: SessionMeta): void {
        const ev = incoming.gameOver;
        if (!ev) {
            this.gameOverOverlay.style.display = 'none';
            this.gameOverBanner.style.display = 'none';
            return;
        }

        const token = `${ev.reason}:${ev.moveNumber}:${ev.at}`;
        if (token !== this.lastHandledGameOverUiToken) {
            this.lastHandledGameOverUiToken = token;
            this.gameOverOverlayDismissed = false;
        }

        this.renderGameOverUi();
    }

    applyRematchRequest(playerId: string, at: number): void {
        const meta = this.meta;
        if (!meta || !meta.gameOver) return;
        const baseAt = meta.gameOver.at;
        if (!meta.rematch || meta.rematch.at < baseAt) {
            meta.rematch = { requestedBy: {}, at };
        }
        meta.rematch.requestedBy[playerId] = true;
    }

    allPlayersRequestedRematch(): boolean {
        const meta = this.meta;
        if (!meta || !meta.gameOver) return false;
        const players = this.currentState?.players ?? [meta.localPlayerId, meta.remotePlayerId].filter(Boolean) as string[];
        const baseAt = meta.gameOver.at;
        const requestedBy = meta.rematch && meta.rematch.at >= baseAt ? meta.rematch.requestedBy : {};
        return players.length > 0 && players.every((id) => requestedBy[id]);
    }

    stopTimerForGameOver(incoming: SessionMeta, stopTimerFn: () => void): void {
        if (!incoming.timerEnabled) return;
        incoming.turnDeadline = null;
        stopTimerFn();
    }
}
