import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import { allPlayersReady, maybeComputeGameStartAt } from '../network/readySync';
import { formatCountdownMs } from '../utils/appUtils';

export class ReadyGate {
    private meta: SessionMeta | null = null;
    private currentState: GameState | null = null;
    private readyOverlay: HTMLDivElement;
    private readyStatusEl: HTMLParagraphElement;
    private readyBtn: HTMLButtonElement;
    private readyTicker: number | null = null;
    private labels: Record<string, string> = {};
    private onUnlock: (() => void) | null = null;
    private READY_GRACE_MS = 3000;
    private READY_TICK_MS = 200;

    constructor(
        readyOverlay: HTMLDivElement,
        readyStatusEl: HTMLParagraphElement,
        readyBtn: HTMLButtonElement
    ) {
        this.readyOverlay = readyOverlay;
        this.readyStatusEl = readyStatusEl;
        this.readyBtn = readyBtn;
    }

    setOnUnlock(cb: () => void): void {
        this.onUnlock = cb;
    }

    setLabels(labels: Record<string, string>): void {
        this.labels = labels;
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setCurrentState(state: GameState | null): void {
        this.currentState = state;
    }

    isReadyGateEnabled(): boolean {
        const m = this.meta;
        return Boolean(m && m.mode !== 'solo' && m.gameStartAt !== undefined);
    }

    isPreGameLocked(): boolean {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;
        if (!this.isReadyGateEnabled()) return false;
        if (meta.gameStartAt == null) return true;
        return Date.now() < meta.gameStartAt;
    }

    private stopReadyTicker(): void {
        if (this.readyTicker) {
            window.clearInterval(this.readyTicker);
            this.readyTicker = null;
        }
    }

    private startReadyTickerIfNeeded(): void {
        if (this.readyTicker) return;
        this.readyTicker = window.setInterval(() => {
            this.renderReadyOverlay();
            if (!this.isPreGameLocked()) {
                this.stopReadyTicker();
                this.onUnlock?.();
            }
        }, this.READY_TICK_MS);
    }

    renderReadyOverlay(): void {
        if (!this.readyOverlay || !this.readyStatusEl || !this.readyBtn) return;

        const active = this.isPreGameLocked();
        this.readyOverlay.style.display = active ? '' : 'none';
        this.readyOverlay.setAttribute('aria-hidden', active ? 'false' : 'true');

        if (!active) {
            this.stopReadyTicker();
            return;
        }

        this.startReadyTickerIfNeeded();

        const state = this.currentState;
        const m = this.meta;
        if (!state || !m) return;

        const ready = m.readyState ?? {};
        const meReady = Boolean(ready[m.localPlayerId]);
        const otherId = m.remotePlayerId;
        const otherReady = otherId ? Boolean(ready[otherId]) : false;

        this.readyBtn.disabled = meReady;
        this.readyBtn.textContent = meReady ? 'Ready ✓' : 'Ready';

        if (m.gameStartAt && Date.now() < m.gameStartAt) {
            const remaining = m.gameStartAt - Date.now();
            this.readyStatusEl.textContent = `Both ready. Starting in ${formatCountdownMs(remaining)}…`;
            return;
        }

        const otherLabel = otherId ? (this.labels[otherId] ?? otherId) : 'Opponent';
        const otherLine = otherId ? `${otherLabel}: ${otherReady ? 'Ready ✓' : 'Not ready'}` : '';
        this.readyStatusEl.textContent = `You: ${meReady ? 'Ready ✓' : 'Not ready'}${otherLine ? ` • ${otherLine}` : ''}`;
    }

    async maybeScheduleGameStartFromReady(): Promise<void> {
        const meta = this.meta;
        const state = this.currentState;
        if (!meta || !state) return;
        if (!meta.isHost) return;
        if (!this.isReadyGateEnabled()) return;
        if (meta.gameStartAt != null) return;

        if (!allPlayersReady(state.players, meta.readyState)) return;

        meta.gameStartAt = maybeComputeGameStartAt({
            currentStartAt: meta.gameStartAt ?? null,
            players: state.players,
            readyState: meta.readyState,
            now: Date.now(),
            graceMs: this.READY_GRACE_MS
        });
    }

    markLocalReady(): void {
        const meta = this.meta;
        if (!meta || !this.currentState) return;
        if (!this.isReadyGateEnabled()) return;
        if (meta.gameOver) return;

        if (!meta.readyState) meta.readyState = {};
        meta.readyState[meta.localPlayerId] = true;
    }
}
