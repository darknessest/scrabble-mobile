import type { SessionMeta, ActionMessage } from '../types';
import type { GameState } from '../core/types';
import type { P2PCallbacks, P2PConnection } from '../network/p2p';
import { createClient, createHost } from '../network/p2p';
import { toQrDataUrl } from '../network/qr';
import { debounce, looksLikeEncodedSdp } from '../utils/appUtils';

export class NetworkController {
    private connection: P2PConnection | null = null;
    private hostApplyAnswer: ((answer: string) => Promise<void>) | null = null;
    private meta: SessionMeta | null = null;
    private currentState: GameState | null = null;
    private mode: 'solo' | 'host' | 'client' = 'solo';
    private lastHandshakeOffer = '';
    private lastHandshakeAnswer = '';
    private p2pStatus: HTMLSpanElement;
    private offerText: HTMLTextAreaElement;
    private offerQr: HTMLImageElement;
    private answerText: HTMLTextAreaElement;
    private hostOfferInput: HTMLTextAreaElement;
    private clientAnswer: HTMLTextAreaElement;
    private answerQr: HTMLImageElement;
    private disconnectOverlay: HTMLDivElement;
    private disconnectMessage: HTMLParagraphElement;
    private appendLog: (msg: string) => void;
    private onMessageCallback: (data: unknown) => void = () => { };
    private onOpenCallback: () => void = () => { };
    private onCloseCallback: () => void = () => { };
    private onErrorCallback: (err: unknown) => void = () => { };
    private onConnectionStateChangeCallback: (state: string) => void = () => { };
    private disconnectTimerState: { deadline: number; remaining: number } | null = null;

    constructor(
        p2pStatus: HTMLSpanElement,
        offerText: HTMLTextAreaElement,
        offerQr: HTMLImageElement,
        answerText: HTMLTextAreaElement,
        hostOfferInput: HTMLTextAreaElement,
        clientAnswer: HTMLTextAreaElement,
        answerQr: HTMLImageElement,
        disconnectOverlay: HTMLDivElement,
        disconnectMessage: HTMLParagraphElement,
        appendLog: (msg: string) => void
    ) {
        this.p2pStatus = p2pStatus;
        this.offerText = offerText;
        this.offerQr = offerQr;
        this.answerText = answerText;
        this.hostOfferInput = hostOfferInput;
        this.clientAnswer = clientAnswer;
        this.answerQr = answerQr;
        this.disconnectOverlay = disconnectOverlay;
        this.disconnectMessage = disconnectMessage;
        this.appendLog = appendLog;
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setCurrentState(state: GameState | null): void {
        this.currentState = state;
    }

    setLabels(_labels: Record<string, string>): void {
        // Labels are managed externally
    }

    setMode(mode: 'solo' | 'host' | 'client'): void {
        this.mode = mode;
    }

    setOnMessage(callback: (data: unknown) => void): void {
        this.onMessageCallback = callback;
    }

    setOnOpen(callback: () => void): void {
        this.onOpenCallback = callback;
    }

    setOnClose(callback: () => void): void {
        this.onCloseCallback = callback;
    }

    setOnError(callback: (err: unknown) => void): void {
        this.onErrorCallback = callback;
    }

    setOnConnectionStateChange(callback: (state: string) => void): void {
        this.onConnectionStateChangeCallback = callback;
    }

    getConnection(): P2PConnection | null {
        return this.connection;
    }

    private buildCallbacks(): P2PCallbacks {
        return {
            onMessage: (data: unknown) => this.onMessageCallback(data),
            onOpen: () => {
                this.p2pStatus.textContent = 'Connected';
                this.p2pStatus.className = 'pill active';
                this.appendLog('Data channel open.');
                this.hideDisconnectOverlay();
                this.onOpenCallback();
            },
            onClose: () => {
                this.handleDisconnect();
                this.onCloseCallback();
            },
            onError: (err: unknown) => {
                this.appendLog(`P2P error: ${String(err)}`);
                this.onErrorCallback(err);
            },
            onLog: (msg: string) => this.appendLog(msg),
            onConnectionStateChange: (state) => {
                if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                    this.handleDisconnect();
                }
                this.onConnectionStateChangeCallback(state);
            }
        };
    }

    async buildHostOffer(languageSelect: HTMLSelectElement, ensureLanguage: (lang: import('../core/types').Language) => Promise<void>): Promise<void> {
        if (this.mode !== 'host') {
            this.appendLog('Switch to Host mode to create an offer.');
            return;
        }
        if (!this.meta?.isHost || !this.currentState) {
            this.appendLog('Start a Host session first, then share the offer QR.');
            return;
        }
        await ensureLanguage(languageSelect.value as import('../core/types').Language);

        const callbacks = this.buildCallbacks();
        if (this.connection) {
            const old = this.connection;
            this.connection = null;
            try {
                old.close();
            } catch {
                // ignore
            }
        }
        const { connection: conn, offer, applyAnswer: apply } = await createHost(callbacks);
        this.connection = conn;
        this.hostApplyAnswer = apply;
        this.offerText.value = offer;
        this.offerQr.src = await toQrDataUrl(offer);
        this.p2pStatus.textContent = 'Offer created - waiting for answer';
        this.p2pStatus.className = 'pill';
        this.appendLog('Offer created. Share this code/QR, then paste the answer you get back.');
    }

    async applyHostAnswer(): Promise<void> {
        if (!this.hostApplyAnswer) {
            this.appendLog('Create an offer first.');
            return;
        }
        const answer = this.answerText.value.trim();
        if (!answer) {
            this.appendLog('Paste or scan an answer first.');
            return;
        }
        await this.hostApplyAnswer(answer);
        this.p2pStatus.textContent = 'Connecting...';
        this.p2pStatus.className = 'pill';
        this.appendLog('Answer applied. Waiting for data channel to open.');
    }

    async buildClientAnswer(): Promise<void> {
        const offer = this.hostOfferInput.value.trim();
        if (!offer) {
            this.appendLog('Paste or scan host offer first.');
            return;
        }
        const callbacks = this.buildCallbacks();
        if (this.connection) {
            const old = this.connection;
            this.connection = null;
            try {
                old.close();
            } catch {
                // ignore
            }
        }
        const { connection: conn, answer } = await createClient(callbacks, offer);
        this.connection = conn;
        this.clientAnswer.value = answer;
        this.answerQr.src = await toQrDataUrl(answer);
        this.p2pStatus.textContent = 'Answer ready - share with host';
        this.p2pStatus.className = 'pill';
        this.appendLog('Answer created. Share this code/QR back to the host.');
    }

    send(data: ActionMessage): void {
        this.connection?.send(data);
    }

    private showDisconnectOverlay(message?: string): void {
        if (message) {
            this.disconnectMessage.textContent = message;
        } else {
            this.disconnectMessage.textContent = 'The connection to your opponent was interrupted.';
        }
        this.disconnectOverlay.style.display = '';

        if (this.meta?.timerEnabled && this.meta.turnDeadline) {
            const remaining = Math.max(0, this.meta.turnDeadline - Date.now());
            this.disconnectTimerState = { deadline: this.meta.turnDeadline, remaining };
        }
    }

    private hideDisconnectOverlay(): void {
        this.disconnectOverlay.style.display = 'none';

        if (this.meta?.timerEnabled && this.disconnectTimerState && this.disconnectTimerState.remaining > 0) {
            this.meta.turnDeadline = Date.now() + this.disconnectTimerState.remaining;
            this.disconnectTimerState = null;
        }
    }

    private handleDisconnect(): void {
        if (!this.connection) return;

        if (this.p2pStatus.textContent === 'Connection lost') return;
        this.p2pStatus.textContent = 'Connection lost';
        this.p2pStatus.className = 'pill danger';
        this.appendLog('P2P connection lost or failed.');

        if (this.currentState && this.mode !== 'solo') {
            const roleMessage = this.mode === 'host'
                ? 'Creating a new connection offer...'
                : 'Please scan the host\'s QR code again to reconnect.';
            this.showDisconnectOverlay(roleMessage);
            void this.triggerReconnect();
        }
    }

    async triggerReconnect(settingsHidden?: boolean, renderVisibilityFn?: () => void): Promise<void> {
        if (this.mode === 'solo') return;

        if (this.connection) {
            const old = this.connection;
            this.connection = null;
            try {
                old.close();
            } catch {
                // ignore
            }
        }

        if (settingsHidden && renderVisibilityFn) {
            renderVisibilityFn();
        }

        if (this.mode === 'host') {
            this.appendLog('Host: Connection lost. Recreating offer...');
            await new Promise(r => setTimeout(r, 500));
            // Note: This would need languageSelect and ensureLanguage passed in
            // await this.buildHostOffer(languageSelect, ensureLanguage);
        } else if (this.mode === 'client') {
            this.appendLog('Client: Connection lost. Please re-scan host offer.');
            this.p2pStatus.textContent = 'Disconnected';
            this.p2pStatus.className = 'pill';
        }
    }

    setupAutoBuildClientAnswer(onBuild: () => Promise<void>): void {
        this.hostOfferInput.addEventListener(
            'input',
            debounce(() => {
                void this.maybeAutoBuildClientAnswer(onBuild);
            }, 350)
        );
    }

    setupAutoApplyHostAnswer(onApply: () => Promise<void>): void {
        this.answerText.addEventListener(
            'input',
            debounce(() => {
                void this.maybeAutoApplyHostAnswer(onApply);
            }, 350)
        );
    }

    private async maybeAutoBuildClientAnswer(onBuild: () => Promise<void>): Promise<void> {
        if (this.mode !== 'client') return;
        const offer = this.hostOfferInput.value.trim();
        if (!offer) return;
        if (offer === this.lastHandshakeOffer) return;
        if (!looksLikeEncodedSdp(offer)) return;
        this.lastHandshakeOffer = offer;
        await onBuild();
    }

    private async maybeAutoApplyHostAnswer(onApply: () => Promise<void>): Promise<void> {
        if (this.mode !== 'host') return;
        if (!this.hostApplyAnswer) return;
        const answer = this.answerText.value.trim();
        if (!answer) return;
        if (answer === this.lastHandshakeAnswer) return;
        if (!looksLikeEncodedSdp(answer)) return;
        this.lastHandshakeAnswer = answer;
        await onApply();
    }
}
