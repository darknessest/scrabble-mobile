// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { SessionMeta } from '../types';
import type { GameHistoryEntry, GameState } from '../core/types';
import { GameOverController } from './gameOver';

interface EndgameStats {
    moves: number;
    passes: number;
    exchanges: number;
    bingos: number;
    bestMove?: { playerId: string; scoreDelta: number; words: string[] };
    longestWord?: { word: string; playerId: string; scoreDelta: number };
}

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
    return {
        mode: 'host',
        language: 'en',
        isHost: true,
        localPlayerId: 'host',
        remotePlayerId: 'client',
        sessionId: 's1',
        gameOver: {
            reason: 'rack_empty_bag_empty',
            at: 100,
            moveNumber: 42,
            finalScores: { host: 24, client: 17 }
        },
        ...overrides
    };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
    return {
        sessionId: 's1',
        language: 'en',
        board: [],
        racks: { host: [], client: [] },
        scores: { host: 24, client: 17 },
        bag: [],
        players: ['host', 'client'],
        currentPlayer: 'host',
        moveNumber: 42,
        history: [],
        ...overrides
    };
}

describe('GameOverController', () => {
    let gameOverOverlay: HTMLDivElement;
    let gameOverReasonEl: HTMLParagraphElement;
    let gameOverScoresEl: HTMLDivElement;
    let gameOverStatsEl: HTMLDivElement;
    let rematchStatusEl: HTMLParagraphElement;
    let rematchBtnOverlay: HTMLButtonElement;
    let gameOverBanner: HTMLDivElement;
    let gameOverBannerScoresEl: HTMLSpanElement;
    let rematchBannerStatusEl: HTMLSpanElement;
    let rematchBtnBanner: HTMLButtonElement;
    let controller: GameOverController;

    beforeEach(() => {
        gameOverOverlay = document.createElement('div');
        gameOverReasonEl = document.createElement('p');
        gameOverScoresEl = document.createElement('div');
        gameOverStatsEl = document.createElement('div');
        rematchStatusEl = document.createElement('p');
        rematchBtnOverlay = document.createElement('button');
        gameOverBanner = document.createElement('div');
        gameOverBannerScoresEl = document.createElement('span');
        rematchBannerStatusEl = document.createElement('span');
        rematchBtnBanner = document.createElement('button');

        controller = new GameOverController(
            gameOverOverlay,
            gameOverReasonEl,
            gameOverScoresEl,
            gameOverStatsEl,
            rematchStatusEl,
            rematchBtnOverlay,
            gameOverBanner,
            gameOverBannerScoresEl,
            rematchBannerStatusEl,
            rematchBtnBanner
        );
        controller.setLabels({ host: 'Host Player', client: 'Client Player' });
    });

    it('computes endgame stats including best move, longest word, and bingo count', () => {
        const history: GameHistoryEntry[] = [
            {
                type: 'MOVE',
                moveNumber: 1,
                playerId: 'host',
                scoreDelta: 14,
                words: ['HELLO'],
                placedTiles: 7,
                timestamp: 1000
            },
            { type: 'PASS', moveNumber: 2, playerId: 'client', timestamp: 1001 },
            { type: 'EXCHANGE', moveNumber: 3, playerId: 'client', exchangedTiles: 2, timestamp: 1002 },
            {
                type: 'MOVE',
                moveNumber: 4,
                playerId: 'client',
                scoreDelta: 22,
                words: ['ALPHABET', 'CAT'],
                placedTiles: 6,
                timestamp: 1003
            },
            {
                type: 'MOVE',
                moveNumber: 5,
                playerId: 'host',
                scoreDelta: 18,
                words: ['QUIZ', 'DOG'],
                placedTiles: 7,
                timestamp: 1004
            }
        ];
        controller.setCurrentState(makeState({ history }));
        const stats = (controller as unknown as { computeEndgameStats: () => EndgameStats }).computeEndgameStats();

        expect(stats.moves).toBe(3);
        expect(stats.passes).toBe(1);
        expect(stats.exchanges).toBe(1);
        expect(stats.bingos).toBe(2);
        expect(stats.bestMove).toEqual({
            playerId: 'client',
            scoreDelta: 22,
            words: ['ALPHABET', 'CAT']
        });
        expect(stats.longestWord).toEqual({
            word: 'ALPHABET',
            playerId: 'client',
            scoreDelta: 22
        });
    });

    it('resets stale rematch votes when a new gameOver token starts', () => {
        const meta = makeMeta();
        const state = makeState();
        meta.rematch = { requestedBy: { host: true, client: true }, at: 10 };
        controller.setMeta(meta);
        controller.setCurrentState(state);

        controller.applyRematchRequest('client', 200);

        expect(meta.rematch).toEqual({ requestedBy: { client: true }, at: 200 });
    });

    it('requires all players to request rematch before allPlayersRequestedRematch() is true', () => {
        const meta = makeMeta();
        const state = makeState();
        meta.rematch = { requestedBy: { host: true }, at: 100 };
        controller.setMeta(meta);
        controller.setCurrentState(state);

        expect(controller.allPlayersRequestedRematch()).toBe(false);

        controller.applyRematchRequest('client', 101);
        expect(controller.allPlayersRequestedRematch()).toBe(true);
    });

    it('shows rematch status text for pending confirmations then completion', () => {
        const meta = makeMeta();
        const state = makeState();
        controller.setMeta(meta);
        controller.setCurrentState(state);
        meta.rematch = { requestedBy: { host: true }, at: 100 };

        controller.renderGameOverUi();
        expect(rematchStatusEl.textContent).toBe('Waiting for Client Player to confirm rematch…');
        expect(rematchBannerStatusEl.textContent).toBe('(1/2 confirmed)');

        controller.applyRematchRequest('client', 101);
        controller.renderGameOverUi();
        expect(rematchStatusEl.textContent).toBe('Starting rematch…');
        expect(rematchBannerStatusEl.textContent).toBe('');
        expect(rematchBtnOverlay.disabled).toBe(true);
        expect(rematchBtnBanner.disabled).toBe(true);
    });

    it('uses solo wording when in solo mode', () => {
        const meta = makeMeta({ mode: 'solo', remotePlayerId: undefined });
        const state = makeState({ players: ['host'] });
        controller.setMeta(meta);
        controller.setCurrentState(state);
        controller.renderGameOverUi();

        expect(rematchStatusEl.textContent).toBe('Start a new game with the same settings.');
    });
});
