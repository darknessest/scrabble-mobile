import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, ScrabbleGame, type WordChecker } from './game';
import type { BoardCell, GameState, Language, Tile } from './types';

function emptyBoard(): BoardCell[][] {
    return Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => ({ tile: null }))
    );
}

function makeTileFactory() {
    let n = 0;
    return (letter: string, value: number): Tile => {
        n += 1;
        return { id: `t${n}`, letter, value };
    };
}

const acceptAllWords: WordChecker = Object.assign(
    async (_word: string, _language: Language) => true,
    {}
);

function baseState(board: BoardCell[][], racks: Record<string, Tile[]>): GameState {
    return {
        board,
        bag: [],
        racks,
        scores: { p1: 0, p2: 0 },
        currentPlayer: 'p1',
        players: ['p1', 'p2'],
        language: 'en',
        moveNumber: 0,
        history: [],
        sessionId: 'test-session'
    };
}

describe('scoring: premiums (DL/TL/DW/TW)', () => {
    it('does not re-apply TL/DL for existing tiles when extending a word', async () => {
        const t = makeTileFactory();
        const board = emptyBoard();

        // Existing "AT" where A sits on a TL square at (5,5).
        board[5][5].tile = t('A', 1); // TL at (5,5) but should NOT apply (already placed)
        board[5][6].tile = t('T', 1);

        const game = new ScrabbleGame();
        const e = t('E', 1);
        game.resume(
            baseState(board, {
                p1: [e],
                p2: []
            })
        );

        const result = await game.placeMove('p1', [{ x: 7, y: 5, tile: e }], acceptAllWords);
        expect(result.success).toBe(true);
        expect(result.scoreDelta).toBe(3); // A(1)+T(1)+E(1), no TL re-application
    });

    it('applies DW per-word (does not globally multiply unrelated cross-words)', async () => {
        const t = makeTileFactory();
        const board = emptyBoard();

        // Build a vertical word shell "I _ E" at x=5 to force a cross-word on (5,4).
        board[3][5].tile = t('I', 1);
        board[5][5].tile = t('E', 1);

        const a = t('A', 1); // Will be placed on DW at (4,4)
        const tt = t('T', 1); // Will be placed at (5,4) and create "ITE" cross-word (no word multiplier)

        const game = new ScrabbleGame();
        game.resume(
            baseState(board, {
                p1: [a, tt],
                p2: []
            })
        );

        const result = await game.placeMove(
            'p1',
            [
                { x: 4, y: 4, tile: a }, // DW
                { x: 5, y: 4, tile: tt }
            ],
            acceptAllWords
        );

        expect(result.success).toBe(true);

        // Primary word: "AT" with A on DW => (1+1)*2 = 4
        // Cross word: "ITE" at x=5 => 1+1+1 = 3 (no DW/TW involved)
        // Total should be 7, NOT (2+3)*2 = 10.
        expect(result.scoreDelta).toBe(7);
        expect((result.words ?? []).slice().sort()).toEqual(['AT', 'ITE'].sort());
    });

    it('applies TL to the placed letter in each word it forms (primary + cross word)', async () => {
        const t = makeTileFactory();
        const board = emptyBoard();

        // Horizontal shell: A _ T at y=5, x=4..6, where center x=5 is TL.
        board[5][4].tile = t('A', 1);
        board[5][6].tile = t('T', 1);

        // Vertical shell: I _ E at x=5, y=4..6.
        board[4][5].tile = t('I', 1);
        board[6][5].tile = t('E', 1);

        const h = t('H', 4); // place on TL at (5,5)

        const game = new ScrabbleGame();
        game.resume(
            baseState(board, {
                p1: [h],
                p2: []
            })
        );

        const result = await game.placeMove('p1', [{ x: 5, y: 5, tile: h }], acceptAllWords);
        expect(result.success).toBe(true);

        // Word1 "AHT": A(1) + H(4*3) + T(1) = 14
        // Word2 "IHE": I(1) + H(4*3) + E(1) = 14
        expect(result.scoreDelta).toBe(28);
        expect((result.words ?? []).slice().sort()).toEqual(['AHT', 'IHE'].sort());
    });

    it('applies TW per-word (does not globally multiply unrelated cross-words)', async () => {
        const t = makeTileFactory();
        const board = emptyBoard();

        // Vertical shell around (1,7) so placing I creates a cross-word (no word multiplier).
        board[6][1].tile = t('A', 1);
        board[8][1].tile = t('T', 1);

        const h = t('H', 4); // place on TW at (0,7)
        const i = t('I', 1); // place at (1,7)

        const game = new ScrabbleGame();
        game.resume(
            baseState(board, {
                p1: [h, i],
                p2: []
            })
        );

        const result = await game.placeMove(
            'p1',
            [
                { x: 0, y: 7, tile: h }, // TW
                { x: 1, y: 7, tile: i }
            ],
            acceptAllWords
        );

        expect(result.success).toBe(true);

        // Primary word "HI" on TW => (4+1)*3 = 15
        // Cross word "AIT" at x=1 => 1+1+1 = 3
        // Total should be 18, NOT (5+3)*3 = 24.
        expect(result.scoreDelta).toBe(18);
        expect((result.words ?? []).slice().sort()).toEqual(['HI', 'AIT'].sort());
    });

    it('complex: long word over TW + DL + CENTER with multiple cross-words (premiums apply per word)', async () => {
        const t = makeTileFactory();
        const board = emptyBoard();

        // Create vertical "shells" so several placements on row 7 form cross-words:
        // - x=0: A _ A  (the placed tile at 0,7 is also on TW)
        // - x=3: A _ E  (the placed tile at 3,7 is also on DL)
        // - x=5: E _ E
        // - x=7: E _ D  (the placed tile at 7,7 is CENTER => DW)
        board[6][0].tile = t('A', 1);
        board[8][0].tile = t('A', 1);

        board[6][3].tile = t('A', 1);
        board[8][3].tile = t('E', 1);

        board[6][5].tile = t('E', 1);
        board[8][5].tile = t('E', 1);

        board[6][7].tile = t('E', 1);
        board[8][7].tile = t('D', 2);

        // Place "HELLOWOR" across row 7, x=0..7.
        // Premium squares involved:
        // - (0,7) is TW
        // - (3,7) is DL
        // - (7,7) is CENTER (treated as DW)
        const h = t('H', 4);
        const e1 = t('E', 1);
        const l1 = t('L', 1);
        const l2 = t('L', 1);
        const o1 = t('O', 1);
        const w = t('W', 4);
        const o2 = t('O', 1);
        const r = t('R', 1);

        const game = new ScrabbleGame();
        game.resume(
            baseState(board, {
                p1: [h, e1, l1, l2, o1, w, o2, r],
                p2: []
            })
        );

        const result = await game.placeMove(
            'p1',
            [
                { x: 0, y: 7, tile: h },
                { x: 1, y: 7, tile: e1 },
                { x: 2, y: 7, tile: l1 },
                { x: 3, y: 7, tile: l2 },
                { x: 4, y: 7, tile: o1 },
                { x: 5, y: 7, tile: w },
                { x: 6, y: 7, tile: o2 },
                { x: 7, y: 7, tile: r }
            ],
            acceptAllWords
        );

        expect(result.success).toBe(true);

        // Primary "HELLOWOR":
        // Letter sum = 4+1+1+(1*2)+1+4+1+1 = 15 (DL at 3,7)
        // Word multipliers: TW at 0,7 (*3) and CENTER at 7,7 (*2) => *6
        // => 15*6 = 90
        //
        // Cross words:
        // - x=0: "AHA" => (1+4+1)*3 = 18 (TW applies to this word too)
        // - x=3: "ALE" => 1+(1*2)+1 = 4 (DL applies here too)
        // - x=5: "EWE" => 1+4+1 = 6
        // - x=7: "ERD" => (1+1+2)*2 = 8 (CENTER/DW applies here too)
        //
        // Total: 90 + 18 + 4 + 6 + 8 = 126
        expect(result.scoreDelta).toBe(126);
        expect((result.words ?? []).slice().sort()).toEqual(['HELLOWOR', 'AHA', 'ALE', 'EWE', 'ERD'].sort());
    });
});


