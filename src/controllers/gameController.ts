import type { SessionMeta } from '../types';
import type { GameState, Language, Placement, Tile } from '../core/types';
import { ScrabbleGame, type WordChecker } from '../core/game';
import { reconcileOrder, shuffleCopy } from '../ui/rackOrder';
import { hasWord } from '../dictionary/dictionaryService';

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
    private validationNonce = 0;
    private lastAutoPassToken: string | null = null;
    private autoPassInProgress = false;
    private appendLog: (msg: string) => void;
    private onValidationUpdate: () => void = () => { };
    private onGameEnd: () => void = () => { };
    private onPersist: () => Promise<void> = async () => { };
    private onSync: () => void = () => { };
    private onRenderAll: () => void = () => { };

    constructor(appendLog: (msg: string) => void) {
        this.game = new ScrabbleGame();
        this.appendLog = appendLog;
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
                buildWordChecker()
            );
            if (!result.success) {
                this.appendLog(result.message ?? 'Invalid move');
                return false;
            }
            this.currentState = this.game.getState();
            this.placements = [];
            this.updateValidation();
            this.onRenderAll();
            void this.onPersist();
            this.onSync();
            if (result.gameEnded) {
                meta.gameOver = {
                    reason: result.gameEnded.reason,
                    at: Date.now(),
                    moveNumber: this.currentState.moveNumber,
                    finalScores: result.gameEnded.finalScores
                };
                void this.onPersist();
                this.onSync();
                this.onGameEnd();
            } else {
                this.onGameEnd();
            }
            return true;
        }
        return false;
    }

    async submitPass(): Promise<boolean> {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        if (meta.isHost || meta.mode === 'solo') {
            const result = this.game.passTurn(meta.localPlayerId);
            if (!result.success) {
                this.appendLog(result.message ?? 'Cannot pass');
                return false;
            }
            this.currentState = this.game.getState();
            this.onRenderAll();
            void this.onPersist();
            this.onSync();
            if (result.gameEnded) {
                meta.gameOver = {
                    reason: result.gameEnded.reason,
                    at: Date.now(),
                    moveNumber: this.currentState.moveNumber,
                    finalScores: result.gameEnded.finalScores
                };
                void this.onPersist();
                this.onSync();
                this.onGameEnd();
            } else {
                this.onGameEnd();
            }
            return true;
        }
        return false;
    }

    async submitExchange(tileIds: string[]): Promise<boolean> {
        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta) return false;

        if (meta.isHost || meta.mode === 'solo') {
            const result = this.game.exchangeTiles(meta.localPlayerId, tileIds);
            if (!result.success) {
                this.appendLog(result.message ?? 'Exchange rejected');
                return false;
            }
            this.currentState = this.game.getState();
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
            const result = this.game.passTurn(timedOutPlayerId);
            if (!result.success) return;

            this.currentState = this.game.getState();
            meta.lastTurnEvent = {
                type: 'timeout',
                playerId: timedOutPlayerId,
                at: Date.now(),
                moveNumber: state.moveNumber
            };
            if (timedOutPlayerId === meta.localPlayerId) {
                this.placements = [];
                this.selectedTileId = null;
                this.updateValidation();
            }
            void this.onPersist();
            this.onSync();
            this.onRenderAll();
            if (result.gameEnded) {
                meta.gameOver = {
                    reason: result.gameEnded.reason,
                    at: Date.now(),
                    moveNumber: this.currentState.moveNumber,
                    finalScores: result.gameEnded.finalScores
                };
                void this.onPersist();
                this.onSync();
                this.onGameEnd();
            } else {
                this.onGameEnd();
            }
        } finally {
            this.autoPassInProgress = false;
        }
    }

    buildWordChecker(): WordChecker {
        const meta = this.meta;
        void meta?.russianDictionaryVariant; // Used for dictionary variant selection
        const fn = ((word: string, language: Language) => {
            return hasWord(word, language);
        }) as WordChecker;
        return fn;
    }

    async updateValidation(): Promise<void> {
        this.validationNonce += 1;
        const ticket = this.validationNonce;

        this.onValidationUpdate();

        const state = this.currentState;
        const meta = this.meta;
        if (!state || !meta || this.placements.length === 0) {
            this.validationStatus = 'idle';
            this.onRenderAll();
            return;
        }

        this.validationStatus = 'checking';
        this.onRenderAll();

        const preview = new ScrabbleGame();
        preview.resume(structuredClone(state));
        const result = await preview.placeMove(
            meta.localPlayerId,
            this.placements,
            (word, lang) => hasWord(word, lang)
        );

        if (ticket !== this.validationNonce) return;

        this.validationStatus = result.success ? 'valid' : 'invalid';
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
        return state;
    }
}
