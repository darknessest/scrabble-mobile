import type { SessionMeta } from '../types';
import type { GameState } from '../core/types';
import { resolveMinWordLength } from '../utils/minWordLength';

interface EndgameWorkerMessage {
    type: string;
    requestId?: string;
    reason?: string;
    error?: string;
    allStuck?: boolean;
}

export type EndgameScanUiState = 'idle' | 'running' | 'error';

export class EndgameScanController {
    private meta: SessionMeta | null = null;
    private currentState: GameState | null = null;
    private endgameScanStatus: HTMLSpanElement;
    private endgameWorker: Worker | null = null;
    private endgameScanUi: EndgameScanUiState = 'idle';
    private endgameScanLastToken: string | null = null;
    private endgameScanInFlight: { requestId: string; token: string; startedAt: number; debug: boolean } | null = null;
    private appendLog: (msg: string) => void;
    private onGameEndCallback: () => void = () => { };

    constructor(
        endgameScanStatus: HTMLSpanElement,
        appendLog: (msg: string) => void
    ) {
        this.endgameScanStatus = endgameScanStatus;
        this.appendLog = appendLog;
        this.initializeWorker();
    }

    private initializeWorker(): void {
        if (typeof Worker !== 'undefined') {
            try {
                this.endgameWorker = new Worker(new URL('../workers/endgameScan.worker.ts', import.meta.url), { type: 'module' });
                this.endgameWorker.addEventListener('message', (ev: MessageEvent) => {
                    this.handleEndgameWorkerMessage(ev.data as EndgameWorkerMessage);
                });
            } catch {
                this.endgameWorker = null;
            }
        }
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setCurrentState(state: GameState | null): void {
        this.currentState = state;
    }

    setOnGameEnd(callback: () => void): void {
        this.onGameEndCallback = callback;
    }

    private computeEndgameScanToken(minLengthInput?: HTMLInputElement): string | null {
        const meta = this.meta;
        const state = this.currentState;
        if (!meta || !state) return null;
        const variant = meta.russianDictionaryVariant ?? 'full';
        const minLength = resolveMinWordLength(minLengthInput?.value);
        return `${state.sessionId}:${state.moveNumber}:${meta.language}:${variant}:${minLength}`;
    }

    private setEndgameScanUi(state: EndgameScanUiState, message?: string): void {
        this.endgameScanUi = state;
        if (state === 'idle') {
            this.endgameScanStatus.style.display = 'none';
            this.endgameScanStatus.textContent = '';
            this.endgameScanStatus.className = 'pill';
            return;
        }

        this.endgameScanStatus.className = 'pill';
        this.endgameScanStatus.style.display = '';
        if (state === 'running') {
            this.endgameScanStatus.textContent = message ?? 'Checking endgame…';
        } else {
            this.endgameScanStatus.textContent = message ?? 'Endgame scan failed';
            this.endgameScanStatus.classList.add('danger');
        }
    }

    private isEndgameScanDebugEnabled(): boolean {
        try {
            const param = new URLSearchParams(window.location.search).get('debugEndgameScan');
            if (param === '1' || param === 'true') return true;
            return localStorage.getItem('scrabble.debugEndgameScan') === '1';
        } catch {
            return false;
        }
    }

    renderEndgameScanStatus(): void {
        const meta = this.meta;
        if (!meta || meta.gameOver) {
            this.setEndgameScanUi('idle');
            return;
        }
        if (this.endgameScanUi === 'idle') {
            this.endgameScanStatus.style.display = 'none';
            return;
        }
        this.endgameScanStatus.style.display = '';
    }

    requestEndgameScanIfNeeded(minLengthInput?: HTMLInputElement): void {
        const meta = this.meta;
        const state = this.currentState;
        if (!meta || !state) return;
        if (meta.gameOver) return;
        if (!meta.isHost && meta.mode !== 'solo') return;
        if (!this.endgameWorker) return;

        if (state.bag.length !== 0) return;

        const token = this.computeEndgameScanToken(minLengthInput);
        if (!token) return;
        if (this.endgameScanInFlight?.token === token) return;
        if (this.endgameScanLastToken === token) return;

        const requestId = crypto.randomUUID();
        const debug = this.isEndgameScanDebugEnabled();
        void debug; // Used for logging
        this.endgameScanInFlight = { requestId, token, startedAt: Date.now(), debug };
        this.setEndgameScanUi('running');
        this.appendLog(`Endgame scan started (bag empty).${debug ? ' (debug on)' : ''}`);

        this.endgameWorker.postMessage({
            type: 'ENDGAME_SCAN_REQUEST',
            requestId,
            state,
            language: meta.language,
            russianVariant: meta.russianDictionaryVariant,
            minLength: resolveMinWordLength(minLengthInput?.value),
            debug
        });
    }

    private handleEndgameWorkerMessage(msg: EndgameWorkerMessage): void {
        if (!msg || msg.type !== 'ENDGAME_SCAN_RESPONSE') return;
        if (!this.endgameScanInFlight) return;
        if (msg.requestId !== this.endgameScanInFlight.requestId) return;

        const token = this.endgameScanInFlight.token;
        const elapsedMs = Date.now() - this.endgameScanInFlight.startedAt;
        this.endgameScanInFlight = null;
        this.endgameScanLastToken = token;

        const currentToken = this.computeEndgameScanToken();
        if (!currentToken || currentToken !== token) {
            this.setEndgameScanUi('idle');
            return;
        }

        if (msg.reason === 'error') {
            this.setEndgameScanUi('error', 'Endgame scan error');
            this.appendLog(`Endgame scan error after ${elapsedMs}ms: ${msg.error ?? 'unknown error'}`);
            return;
        }

        if (msg.reason === 'dictionary_unavailable') {
            this.setEndgameScanUi('idle');
            this.appendLog(`Endgame scan skipped after ${elapsedMs}ms: dictionary unavailable (won't auto-end).`);
            return;
        }

        if (!msg.allStuck) {
            this.setEndgameScanUi('idle');
            this.appendLog(`Endgame scan finished in ${elapsedMs}ms: moves available.`);
            return;
        }

        this.appendLog(`Endgame scan finished in ${elapsedMs}ms: no moves for all players.`);
        this.onGameEndCallback();
    }

    resetState(): void {
        this.endgameScanLastToken = null;
        this.endgameScanInFlight = null;
        this.setEndgameScanUi('idle');
    }
}
