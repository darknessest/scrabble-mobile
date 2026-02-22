import type { GameEndReason, GameState, Language, Placement } from './core/types';

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
    stateHash?: string;
    diverged?: boolean;
    vectorClock?: Record<string, number>;
    messageSequence?: {
        lastSentByPeer: Record<string, number>;
        lastReceivedByPeer: Record<string, number>;
    };
    rematch?: { requestedBy: Record<string, boolean>; at: number };
}

export type OperationType = 'MOVE' | 'PASS' | 'EXCHANGE';

export interface LogAction {
    placements?: Placement[];
    tileIds?: string[];
}

export interface LogEntry {
    sessionId: string;
    seq: number;
    action: LogAction;
    timestamp: number;
    playerId: string;
    type: OperationType;
}

export interface LogDeltaPayload {
    sinceSeq: number;
    operations: LogEntry[];
}

export interface SnapshotPayload {
    version?: number;
    state: GameState;
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
  | ({ type: 'ACTION_MOVE'; placements: Placement[]; playerId: string } & { seq?: number; ack?: number })
  | ({ type: 'ACTION_PASS'; playerId: string } & { seq?: number; ack?: number })
  | ({ type: 'ACTION_EXCHANGE'; playerId: string; tileIds: string[] } & { seq?: number; ack?: number })
  | ({ type: 'ACTION_REMATCH_REQUEST'; playerId: string; at: number } & { seq?: number; ack?: number })
  | ({ type: 'DRAFT_PLACEMENTS'; placements: Placement[]; playerId: string; moveNumber: number } & { seq?: number; ack?: number })
  | ({ type: 'PLAYER_READY'; playerId: string; ready: boolean } & { seq?: number; ack?: number })
   | ({ type: 'REQUEST_SYNC'; sinceSeq?: number } & { seq?: number; ack?: number })
   | ({ type: 'SYNC_STATE'; state: GameState; meta: SessionMeta; labels: Record<string, string> } & { seq?: number; ack?: number })
   | ({ type: 'LOG_DELTA'; payload: LogDeltaPayload } & { seq?: number; ack?: number })
   | ({ type: 'MSG_ACK'; ack: number } & { seq?: number })
   | ({ type: 'MSG_NACK'; ack: number } & { seq?: number; reason?: string });
