import type { SessionMeta } from '../types';
import { canStartInitialTurnTimer } from '../core/sessionTimer';

const CRITICAL_TIMER_SECONDS = new Set([60, 30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

export class TimerController {
    private timerDisplay: HTMLSpanElement;
    private timerVisual: HTMLElement;
    private timerLiveRegion: HTMLElement | null;
    private timerTicker: number | null = null;
    private meta: SessionMeta | null = null;
    private connection: { dataChannelReady: boolean } | null = null;
    private onTimeoutCallback: () => void = () => { };
    private lastLiveAnnouncement: number | null = null;

    constructor(timerDisplay: HTMLSpanElement) {
        this.timerDisplay = timerDisplay;
        this.timerVisual = timerDisplay.querySelector<HTMLElement>('[data-role="timer-text"]') ?? timerDisplay;
        this.timerLiveRegion = timerDisplay.querySelector<HTMLElement>('[data-role="timer-live"]');
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
            this.lastLiveAnnouncement = null;
            return;
        }

        const remainingMs = meta.turnDeadline - Date.now();
        const clamped = Math.max(0, remainingMs);
        const totalSeconds = Math.floor(clamped / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        this.timerDisplay.style.display = '';
        this.timerVisual.textContent = timerText;
        this.timerDisplay.classList.toggle('danger', clamped === 0);
        this.timerDisplay.classList.toggle('active', clamped > 0);

        if (this.shouldAnnounceTimer(totalSeconds)) {
            if (this.timerLiveRegion) {
                this.timerLiveRegion.textContent = timerText;
            } else {
                this.timerDisplay.textContent = timerText;
            }
            this.lastLiveAnnouncement = totalSeconds;
        }

        if (clamped === 0) {
            void this.onTimeoutCallback();
        }
    }

    private shouldAnnounceTimer(totalSeconds: number): boolean {
        if (!this.timerVisual) return false;
        if (this.lastLiveAnnouncement === null) return true;
        if (totalSeconds <= 0) return true;
        if (CRITICAL_TIMER_SECONDS.has(totalSeconds)) return true;
        return totalSeconds % 30 === 0;
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

        // If a deadline already exists, just ensure the ticker is running.
        // Don't overwrite — the deadline was set when the turn started.
        if (meta.turnDeadline) {
            this.startTimerTicker();
            return;
        }

        if (isPreGameLocked()) {
            this.stopTimerTicker();
            this.renderTimer();
            return;
        }

        if (!canStartInitialTurnTimer(meta, Boolean(this.connection?.dataChannelReady))) {
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
