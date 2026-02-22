import type { SessionMeta, SnapshotPayload } from '../types';
import type { GameState } from '../core/types';
import { clearSnapshot, loadSnapshot, saveSnapshot } from '../storage/indexedDb';

const SNAPSHOT_VERSION = 1;

export class StorageController {
    private pendingSnapshot: SnapshotPayload | null = null;
    private resumeBtn: HTMLButtonElement;
    private clearSnapshotBtn: HTMLButtonElement;
    private resumeNote: HTMLParagraphElement;

    constructor(
        resumeBtn: HTMLButtonElement,
        clearSnapshotBtn: HTMLButtonElement,
        resumeNote: HTMLParagraphElement
    ) {
        this.resumeBtn = resumeBtn;
        this.clearSnapshotBtn = clearSnapshotBtn;
        this.resumeNote = resumeNote;
    }

    async persistSnapshot(
        currentState: GameState | null,
        meta: SessionMeta | null,
        labels: Record<string, string>
    ): Promise<void> {
        if (!currentState || !meta) return;
        const payload: SnapshotPayload = {
            version: SNAPSHOT_VERSION,
            state: currentState,
            meta,
            labels
        };
        await saveSnapshot('last-session', payload);
        this.pendingSnapshot = payload;
        this.resumeBtn.disabled = false;
        this.clearSnapshotBtn.disabled = false;
        this.resumeNote.textContent = `Saved session (${meta.mode}) as ${labels[meta.localPlayerId] ?? ''}`;
    }

    async checkSavedSnapshot(): Promise<void> {
        const saved = await loadSnapshot<SnapshotPayload>('last-session');
        this.pendingSnapshot = saved;
        if (saved) {
            this.resumeBtn.disabled = false;
            this.clearSnapshotBtn.disabled = false;
            this.resumeNote.textContent = `Found saved session (${saved.meta.mode})`;
        }
    }

    getPendingSnapshot(): SnapshotPayload | null {
        return this.pendingSnapshot;
    }

    async clearSavedSnapshot(): Promise<void> {
        await clearSnapshot('last-session');
        this.pendingSnapshot = null;
        this.resumeBtn.disabled = true;
        this.clearSnapshotBtn.disabled = true;
        this.resumeNote.textContent = '';
    }
}
