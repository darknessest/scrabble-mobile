import type { SessionMeta } from '../types';
import { canStartInitialTurnTimer } from '../core/sessionTimer';

export class TimerController {
    private timerDisplay: HTMLSpanElement;
    private timerTicker: number | null = null;
    private meta: SessionMeta | null = null;
    private connection: { dataChannelReady: boolean } | null = null;
    private onTimeoutCallback: () => void = () => { };

    constructor(timerDisplay: HTMLSpanElement) {
        this.timerDisplay = timerDisplay;
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setConnection(connection: { dataChannelReady: boolean } | null): void {
        this.connection = connection;
    }

    setOnTimeout(callback: () => void): void {
        this.onTimeoutCallback = callback;
    }

    startTimerTicker(): void {
        this.stopTimerTicker();
        this.renderTimer();
        this.timerTicker = window.setInterval(() => this.renderTimer(), 500);
    }

    stopTimerTicker(): void {
        if (this.timerTicker) {
            window.clearInterval(this.timerTicker);
            this.timerTicker = null;
        }
    }

    private renderTimer(): void {
        if (!this.timerDisplay) return;
        const meta = this.meta;
        if (!meta || !meta.timerEnabled || !meta.timerDurationSec || !meta.turnDeadline) {
            this.timerDisplay.style.display = 'none';
            return;
        }

        const remainingMs = meta.turnDeadline - Date.now();
        const clamped = Math.max(0, remainingMs);
        const totalSeconds = Math.floor(clamped / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        this.timerDisplay.style.display = '';
        this.timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        this.timerDisplay.classList.toggle('danger', clamped === 0);
        this.timerDisplay.classList.toggle('active', clamped > 0);

        if (clamped === 0) {
            void this.onTimeoutCallback();
        }
    }

    resetTurnTimer(isPreGameLocked: () => boolean): void {
        const meta = this.meta;
        if (!meta) {
            this.stopTimerTicker();
            this.renderTimer();
            return;
        }

        if (!meta.timerEnabled || !meta.timerDurationSec) {
            meta.turnDeadline = null;
            this.stopTimerTicker();
            this.renderTimer();
            return;
        }

        if (!meta.turnDeadline && isPreGameLocked()) {
            meta.turnDeadline = null;
            this.stopTimerTicker();
            this.renderTimer();
            return;
        }

        if (!meta.turnDeadline && !canStartInitialTurnTimer(meta, Boolean(this.connection?.dataChannelReady))) {
            meta.turnDeadline = null;
            this.stopTimerTicker();
            this.renderTimer();
            return;
        }

        meta.turnDeadline = Date.now() + meta.timerDurationSec * 1000;
        this.startTimerTicker();
    }

    stopTimerForGameOver(): void {
        const meta = this.meta;
        if (!meta || !meta.timerEnabled) return;
        meta.turnDeadline = null;
        this.stopTimerTicker();
        this.renderTimer();
    }
}
