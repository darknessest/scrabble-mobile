import type { GameEndReason, Language } from './core/types';

export type Mode = 'solo' | 'host' | 'client';

export interface SessionMeta {
    mode: Mode;
    language: Language;
    isHost: boolean;
    localPlayerId: string;
    remotePlayerId?: string;
    sessionId: string;
    minWordLength?: number;
    timerEnabled?: boolean;
    timerDurationSec?: number;
    turnDeadline?: number | null;
    lastTurnEvent?: TurnEvent;
    gameOver?: GameOverEvent;
    /**
     * Russian dictionary variant: 'full' (all inflected forms) or 'strict' (nominative+plural only for nouns)
     * Only applies when language is 'ru'
     */
    russianDictionaryVariant?: 'full' | 'strict';
    /**
     * Pre-game sync (P2P only): both users must click "Ready".
     *
     * Back-compat note:
     * - If `gameStartAt` is undefined, the session behaves as "already started" (old snapshots).
     * - New P2P sessions set `gameStartAt` to null and will show a Ready overlay until scheduled.
     */
    readyState?: Record<string, boolean>;
    gameStartAt?: number | null;
    rematch?: { requestedBy: Record<string, boolean>; at: number };
}

export interface SnapshotPayload {
    state: import('./core/types').GameState;
    meta: SessionMeta;
    labels: Record<string, string>;
}

export type TurnEventType = 'timeout';

export interface TurnEvent {
    type: TurnEventType;
    playerId: string;
    at: number;
    moveNumber: number;
}

export interface GameOverEvent {
    reason: GameEndReason;
    at: number;
    moveNumber: number;
    finalScores: Record<string, number>;
}

export type ActionMessage =
    | { type: 'ACTION_MOVE'; placements: import('./core/types').Placement[]; playerId: string }
    | { type: 'ACTION_PASS'; playerId: string }
    | { type: 'ACTION_EXCHANGE'; playerId: string; tileIds: string[] }
    | { type: 'ACTION_REMATCH_REQUEST'; playerId: string; at: number }
    | { type: 'DRAFT_PLACEMENTS'; placements: import('./core/types').Placement[]; playerId: string; moveNumber: number }
    | { type: 'PLAYER_READY'; playerId: string; ready: boolean }
    | { type: 'REQUEST_SYNC' }
    | { type: 'SYNC_STATE'; state: import('./core/types').GameState; meta: SessionMeta; labels: Record<string, string> };
