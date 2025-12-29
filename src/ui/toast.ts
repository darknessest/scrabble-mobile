export class ToastManager {
    private toastEl: HTMLDivElement;
    private toastTimer: number | null = null;
    private toastOutTimer: number | null = null;

    constructor(toastEl: HTMLDivElement) {
        this.toastEl = toastEl;
    }

    private hideToast(): void {
        if (!this.toastEl) return;
        this.toastEl.classList.remove('is-visible');
        this.toastEl.classList.add('is-hiding');
        if (this.toastOutTimer) window.clearTimeout(this.toastOutTimer);
        this.toastOutTimer = window.setTimeout(() => {
            this.toastEl.style.display = 'none';
            this.toastEl.classList.remove('is-hiding');
        }, 220);
    }

    showToast(message: string, variant: 'info' | 'danger' = 'info', ms = 4500): void {
        if (!this.toastEl) return;
        this.toastEl.textContent = message;
        this.toastEl.className = `toast ${variant}`;
        this.toastEl.style.display = '';
        this.toastEl.classList.remove('is-hiding');
        if (this.toastOutTimer) window.clearTimeout(this.toastOutTimer);
        window.requestAnimationFrame(() => this.toastEl.classList.add('is-visible'));

        if (this.toastTimer) window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.hideToast(), ms);
    }
}
