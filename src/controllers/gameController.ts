import type { LogAction, OperationType, SessionMeta } from '../types';
import type { GameState, Language, MoveResult, Placement, Tile } from '../core/types';
import { ScrabbleGame, type WordChecker } from '../core/game';
import { reconcileOrder, shuffleCopy } from '../ui/rackOrder';
import { hasWord } from '../dictionary/dictionaryService';
import { appendLogEntry } from '../storage/indexedDb';
import { buildSyncStateForPeer, computeStateHash } from '../utils/syncState';

export class GameController {
    private game: ScrabbleGame;
    private meta: SessionMeta | null = null;
    private currentState: GameState | null = null;
    private placements: Placement[] = [];
    private selectedTileId: string | null = null;
    private remoteDraft: { playerId: string; placements: Placement[]; moveNumber: number } | null = null;
    private rackOrder: string[] = [];
    private rackOrderSessionId: string | null = null;
    private validationStatus: 'idle' | 'checking' | 'valid' | 'invalid' = 'idle';
    private validationMessage: string | null = null;
    private validationHighlightCells: Array<{ x: number; y: number }> = [];
    private validationNonce = 0;
    private lastAutoPassToken: string | null = null;
    private autoPassInProgress = false;
    private appendLog: (msg: string) => void;
    private showToast: (msg: string, variant?: 'info' | 'danger', ms?: number) => void;
    private onValidationUpdate: () => void = () => { };
    private onGameEnd: () => void = () => { };
    private onPersist: () => Promise<void> = async () => { };
    private onSync: () => void = () => { };
    private onRenderAll: () => void = () => { };

    constructor(
        appendLog: (msg: string) => void,
        showToast: (msg: string, variant?: 'info' | 'danger', ms?: number) => void = () => { }
    ) {
        this.game = new ScrabbleGame();
        this.appendLog = appendLog;
        this.showToast = showToast;
    }

    setMeta(meta: SessionMeta | null): void {
        this.meta = meta;
    }

    setCurrentState(state: GameState | null): void {
        this.currentState = state;
    }

    getGame(): ScrabbleGame {
        return this.game;
    }

    getState(): GameState | null {
        return this.currentState;
    }

    getPlacements(): Placement[] {
        return this.placements;
    }

    getSelectedTileId(): string | null {
        return this.selectedTileId;
    }

    getRemoteDraft(): { playerId: string; placements: Placement[]; moveNumber: number } | null {
        return this.remoteDraft;
    }

    getRackOrder(): string[] {
        return this.rackOrder;
    }

    getRackOrderSessionId(): string | null {
        return this.rackOrderSessionId;
    }

    getValidationStatus(): 'idle' | 'checking' | 'valid' | 'invalid' {
        return this.validationStatus;
    }

    getValidationMessage(): string | null {
        return this.validationMessage;
    }

    getValidationHighlightCells(): Array<{ x: number; y: number }> {
        return this.validationHighlightCells;
    }

    setOnValidationUpdate(callback: () => void): void {
        this.onValidationUpdate = callback;
    }

    setOnGameEnd(callback: () => void): void {
        this.onGameEnd = callback;
    }

    setOnPersist(callback: () => Promise<void>): void {
        this.onPersist = callback;
    }

    setOnSync(callback: () => void): void {
        this.onSync = callback;
    }

    setOnRenderAll(callback: () => void): void {
        this.onRenderAll = callback;
    }

    start(language: Language, players: string[]): GameState {
        const state = this.game.start(language, players);
        this.currentState = state;
        this.placements = [];
        this.selectedTileId = null;
        this.remoteDraft = null;
        this.rackOrder = [];
        this.rackOrderSessionId = state.sessionId;
        this.validationHighlightCells = [];
        return state;
    }

    resume(state: GameState): void {
        this.game.resume(state);
        this.currentState = this.game.getState();
        this.placements = [];
        this.selectedTileId = null;
        this.remoteDraft = null;
        this.rackOrder = [];
        this.rackOrderSessionId = state.sessionId;
        this.validationHighlightCells = [];
    }

    syncLocalRackOrder(): void {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return;
        if (this.rackOrderSessionId !== state.sessionId) {
            this.rackOrder = [];
            this.rackOrderSessionId = state.sessionId;
        }
        const rack = state.racks[meta.localPlayerId] ?? [];
        this.rackOrder = reconcileOrder(this.rackOrder, rack, (t) => t.id);
    }

    shuffleRack(): void {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return;
        this.syncLocalRackOrder();
        this.rackOrder = shuffleCopy(this.rackOrder);
    }

    takeAvailableTile(tileId: string): Tile | null {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return null;
        const used = new Set(this.placements.map((p) => p.tile.id));
        const rack = state.racks[meta.localPlayerId] ?? [];
        const tile = rack.find((t) => t.id === tileId && !used.has(t.id));
        return tile ?? null;
    }

    placeSelectedTileAt(x: number, y: number, selectBlankLetter: (tile: Tile) => Promise<Tile | null>): void {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return;
        if (!this.selectedTileId) return;
        if (state.board[y][x].tile) return;

        const tile = this.takeAvailableTile(this.selectedTileId);
        if (!tile) return;

        if (tile.blank) {
            selectBlankLetter(tile).then((updatedTile) => {
                if (!updatedTile) return;

                const existingIdx = this.placements.findIndex((p) => p.x === x && p.y === y);
                if (existingIdx >= 0) {
                    this.placements.splice(existingIdx, 1);
                }

                this.placements.push({ x, y, tile: updatedTile });
                this.selectedTileId = null;
                this.onSync();
                this.onRenderAll();
                this.updateValidation();
            });
            return;
        }

        const existingIdx = this.placements.findIndex((p) => p.x === x && p.y === y);
        if (existingIdx >= 0) {
            this.placements.splice(existingIdx, 1);
        }

        this.placements.push({ x, y, tile });
        this.selectedTileId = null;
        this.onSync();
        this.onRenderAll();
        this.updateValidation();
    }

    removePlacementAt(x: number, y: number): void {
        const idx = this.placements.findIndex((p) => p.x === x && p.y === y);
        if (idx >= 0) {
            this.placements.splice(idx, 1);
            this.onSync();
            this.onRenderAll();
            this.updateValidation();
        }
    }

    setSelectedTileId(tileId: string | null): void {
        this.selectedTileId = tileId;
    }

    clearPlacements(): void {
        this.placements = [];
        this.selectedTileId = null;
        this.onSync();
        this.onRenderAll();
        this.updateValidation();
    }

    setRemoteDraft(draft: { playerId: string; placements: Placement[]; moveNumber: number } | null): void {
        this.remoteDraft = draft;
    }

    async submitMove(buildWordChecker: () => WordChecker): Promise<boolean> {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;
        if (this.placements.length === 0) return false;

        if (meta.isHost || meta.mode === 'solo') {
            const result = await this.game.placeMove(
                meta.localPlayerId,
                this.placements,
                buildWordChecker(),
                meta.minWordLength,
                meta
            );
            if (!result.success) {
                this.reportError(result.message ?? 'Invalid move');
                return false;
            }
            this.currentState = this.game.getState();
            this.refreshLocalStateHash();
            void this.logAction(this.currentState.sessionId, meta.localPlayerId, 'MOVE', {
                placements: this.placements.map((placement) => ({
                    x: placement.x,
                    y: placement.y,
                    tile: { ...placement.tile }
                }))
            });
            this.placements = [];
            if (meta.timerEnabled) meta.turnDeadline = null;
            this.updateValidation();
            this.onRenderAll();
            void this.onPersist();
            this.onSync();
            this.handlePostMoveResult(result, meta);
            return true;
        }
        return false;
    }

    async submitRemoteMove(placements: Placement[], playerId: string, buildWordChecker: () => WordChecker): Promise<boolean> {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        const result = await this.game.placeMove(
            playerId,
            placements,
            buildWordChecker(),
            meta.minWordLength,
            meta
        );
        if (!result.success) {
            this.reportError(result.message ?? 'Invalid move');
            return false;
        }
        this.currentState = this.game.getState();
        this.refreshLocalStateHash();
        void this.logAction(this.currentState.sessionId, playerId, 'MOVE', {
            placements: placements.map((placement) => ({
                x: placement.x,
                y: placement.y,
                tile: { ...placement.tile }
            }))
        });
        if (meta.timerEnabled) meta.turnDeadline = null;
        this.updateValidation();
        this.onRenderAll();
        void this.onPersist();
        this.onSync();
        this.handlePostMoveResult(result, meta);
        return true;
    }

    applyRemotePass(actingPlayerId: string): boolean {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        const result = this.game.passTurn(actingPlayerId, meta);
        if (!result.success) {
            this.reportError(result.message ?? 'Cannot pass');
            return false;
        }
        this.currentState = this.game.getState();
        this.refreshLocalStateHash();
        void this.logAction(this.currentState.sessionId, actingPlayerId, 'PASS');
        if (meta.timerEnabled) meta.turnDeadline = null;
        this.onRenderAll();
        void this.onPersist();
        this.onSync();
        this.handlePostMoveResult(result, meta);
        return true;
    }

    applyRemoteExchange(tileIds: string[], actingPlayerId: string): boolean {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        const result = this.game.exchangeTiles(actingPlayerId, tileIds, meta);
        if (!result.success) {
            this.reportError(result.message ?? 'Exchange rejected');
            return false;
        }
        this.currentState = this.game.getState();
        this.refreshLocalStateHash();
        void this.logAction(this.currentState.sessionId, actingPlayerId, 'EXCHANGE', {
            tileIds: [...tileIds]
        });
        this.placements = [];
        this.selectedTileId = null;
        if (meta.timerEnabled) meta.turnDeadline = null;
        this.updateValidation();
        this.onRenderAll();
        void this.onPersist();
        this.onSync();
        this.onGameEnd();
        return true;
    }

    submitPass(actingPlayerId?: string): boolean {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        if (meta.isHost || meta.mode === 'solo') {
            const pid = actingPlayerId ?? meta.localPlayerId;
            const result = this.game.passTurn(pid, meta);
            if (!result.success) {
                this.reportError(result.message ?? 'Cannot pass');
                return false;
            }
            this.currentState = this.game.getState();
            this.refreshLocalStateHash();
            void this.logAction(this.currentState.sessionId, pid, 'PASS');
            if (meta.timerEnabled) meta.turnDeadline = null;
            this.onRenderAll();
            void this.onPersist();
            this.onSync();
            this.handlePostMoveResult(result, meta);
            return true;
        }
        return false;
    }

    submitExchange(tileIds: string[], actingPlayerId?: string): boolean {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        if (meta.isHost || meta.mode === 'solo') {
            const pid = actingPlayerId ?? meta.localPlayerId;
            const result = this.game.exchangeTiles(pid, tileIds, meta);
            if (!result.success) {
                this.reportError(result.message ?? 'Exchange rejected');
                return false;
            }
            this.currentState = this.game.getState();
            this.refreshLocalStateHash();
            void this.logAction(this.currentState.sessionId, pid, 'EXCHANGE', {
                tileIds: [...tileIds]
            });
            this.placements = [];
            this.selectedTileId = null;
            if (meta.timerEnabled) meta.turnDeadline = null;
            this.updateValidation();
            this.onRenderAll();
            void this.onPersist();
            this.onSync();
            this.onGameEnd();
            return true;
        }
        return false;
    }

    async maybeAutoPassOnTimeout(): Promise<void> {
        const meta = this.meta;
        const state = this.currentState;
        if (!meta || !state) return;
        if (!meta.isHost && meta.mode !== 'solo') return;
        if (!meta.timerEnabled || !meta.timerDurationSec || !meta.turnDeadline) return;

        const remainingMs = meta.turnDeadline - Date.now();
        if (remainingMs > 0) return;

        const token = `${state.sessionId}:${state.moveNumber}:${state.currentPlayer}:${meta.turnDeadline}`;
        if (token === this.lastAutoPassToken || this.autoPassInProgress) return;
        this.lastAutoPassToken = token;
        this.autoPassInProgress = true;

        try {
            this.remoteDraft = null;
            const timedOutPlayerId = state.currentPlayer;
            const result = this.game.passTurn(timedOutPlayerId, meta);
            if (!result.success) return;

            this.currentState = this.game.getState();
            this.refreshLocalStateHash();
            void this.logAction(this.currentState.sessionId, timedOutPlayerId, 'PASS');
            meta.lastTurnEvent = {
                type: 'timeout',
                playerId: timedOutPlayerId,
                at: Date.now(),
                moveNumber: state.moveNumber
            };
            meta.turnDeadline = null;
            if (timedOutPlayerId === meta.localPlayerId) {
                this.placements = [];
                this.selectedTileId = null;
                this.updateValidation();
            }
            void this.onPersist();
            this.onSync();
            this.onRenderAll();
            this.handlePostMoveResult(result, meta);
        } finally {
            this.autoPassInProgress = false;
        }
    }

    private handlePostMoveResult(result: MoveResult, meta: SessionMeta): void {
        if (result.gameEnded) {
            meta.gameOver = {
                reason: result.gameEnded.reason,
                at: Date.now(),
                moveNumber: this.currentState!.moveNumber,
                finalScores: result.gameEnded.finalScores
            };
            void this.onPersist();
            this.onSync();
        }
        this.onGameEnd();
    }

    private logAction(sessionId: string, playerId: string, type: OperationType, action: LogAction = {}): void {
        void appendLogEntry({ sessionId, playerId, type, action });
    }

    private refreshLocalStateHash(): void {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return;
        meta.stateHash = computeStateHash(buildSyncStateForPeer(state, meta));
    }

    private reportError(message: string): void {
        this.appendLog(message);
        this.showToast(message, 'danger');
    }

    buildWordChecker(): WordChecker {
        const meta = this.meta;
        const variant = meta?.russianDictionaryVariant;
        const fn = ((word: string, language: Language) => {
            return hasWord(word, language, variant);
        }) as WordChecker;
        return fn;
    }

    async updateValidation(): Promise<void> {
        this.validationNonce += 1;
        const ticket = this.validationNonce;

        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta || this.placements.length === 0) {
            this.validationStatus = 'idle';
            this.validationMessage = null;
            this.validationHighlightCells = [];
            this.onValidationUpdate();
            this.onRenderAll();
            return;
        }

        this.validationStatus = 'checking';
        this.validationMessage = null;
        this.validationHighlightCells = [];
        this.onValidationUpdate();
        this.onRenderAll();

        const preview = new ScrabbleGame();
        preview.resume(buildValidationState(state));
        const variant = meta.russianDictionaryVariant;
        const result = await preview.placeMove(
            meta.localPlayerId,
            this.placements,
            (word, lang) => hasWord(word, lang, variant),
            meta.minWordLength
        );

        if (ticket !== this.validationNonce) return;

        this.validationStatus = result.success ? 'valid' : 'invalid';
        this.validationMessage = result.success ? null : (result.message ?? null);
        this.validationHighlightCells = result.success
            ? [...(result.highlightCells ?? this.placements.map((placement) => ({ x: placement.x, y: placement.y })))]
            : [];
        this.onValidationUpdate();
        this.onRenderAll();
    }

    resetForRematch(language: Language, players: string[]): GameState {
        const state = this.game.start(language, players);
        this.currentState = state;
        this.placements = [];
        this.selectedTileId = null;
        this.remoteDraft = null;
        this.rackOrder = [];
        this.rackOrderSessionId = state.sessionId;
        this.validationHighlightCells = [];
        return state;
    }
}

function buildValidationState(state: GameState): GameState {
    const board = state.board.map((row) => row.map((cell) => ({ tile: cell.tile })));
    const racks: Record<string, Tile[]> = {};
    Object.entries(state.racks).forEach(([playerId, rack]) => {
        racks[playerId] = rack.map((tile) => tile);
    });

    return {
        board,
        bag: [...state.bag],
        racks,
        scores: { ...state.scores },
        currentPlayer: state.currentPlayer,
        players: [...state.players],
        language: state.language,
        moveNumber: state.moveNumber,
        lastMove: state.lastMove
            ? {
                moveNumber: state.lastMove.moveNumber,
                playerId: state.lastMove.playerId,
                placed: state.lastMove.placed.map((p) => ({ x: p.x, y: p.y }))
            }
            : null,
        history: [],
        sessionId: state.sessionId
    };
}
