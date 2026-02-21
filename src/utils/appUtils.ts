export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, delayMs: number): (...args: Parameters<T>) => void {
    let t: number | null = null;
    return (...args: Parameters<T>) => {
        if (t != null) window.clearTimeout(t);
        t = window.setTimeout(() => fn(...args), delayMs);
    };
}

interface SdpDecoded {
    type?: unknown;
    sdp?: unknown;
}

export function looksLikeEncodedSdp(text: string): boolean {
    if (!text) return false;
    try {
        const decoded = JSON.parse(atob(text)) as SdpDecoded;
        return Boolean(decoded && typeof decoded === 'object' && typeof decoded.type === 'string' && typeof decoded.sdp === 'string');
    } catch {
        return false;
    }
}

export function copyToClipboard(text: string, appendLog: (msg: string) => void): void {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => appendLog('Copied to clipboard'));
}

export function appendLog(logEl: HTMLDivElement, msg: string): void {
    const now = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.textContent = `[${now}] ${msg}`;
    logEl.prepend(entry);
}

export function formatCountdownMs(ms: number): string {
    const s = Math.ceil(ms / 1000);
    return `${Math.max(0, s)}s`;
}

export function formatGameOverReason(reason: import('../core/types').GameEndReason): string {
    if (reason === 'four_passes') return 'Both players passed twice in a row.';
    if (reason === 'rack_empty_bag_empty') return 'A player used all their tiles with no tiles left in the bag.';
    return 'No tiles left in the bag and no valid moves available.';
}
