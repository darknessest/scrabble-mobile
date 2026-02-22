import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ScrabbleGame } from './game';
import type { GameState, Placement } from './types';

// Mock crypto.randomUUID for deterministic testing
let uuidCounter = 0;
beforeAll(() => {
    vi.stubGlobal('crypto', {
        randomUUID: () => `test-uuid-${uuidCounter++}`
    });
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe('ScrabbleGame', () => {
    let game: ScrabbleGame;
    const mockCheckWord = vi.fn().mockResolvedValue(true);
    const withState = (update: (state: GameState) => void): void => {
        const state = structuredClone(game.getState()) as GameState;
        update(state);
        game.resume(state);
    };

    beforeEach(() => {
        uuidCounter = 0;
        game = new ScrabbleGame();
        mockCheckWord.mockClear();
        mockCheckWord.mockResolvedValue(true);
    });

    it('starts a game correctly', () => {
        const state = game.start('en', ['p1', 'p2']);

        expect(state.language).toBe('en');
        expect(state.players).toEqual(['p1', 'p2']);
        expect(state.currentPlayer).toBe('p1');
        expect(state.scores).toEqual({ p1: 0, p2: 0 });
        expect(state.racks['p1']).toHaveLength(7);
        expect(state.racks['p2']).toHaveLength(7);
        expect(state.bag.length).toBeGreaterThan(0);
        expect(state.moveNumber).toBe(0);
    });

    it('validates first move must cover center', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const tile = state.racks['p1'][0];

        // Attempt move not covering center (7,7)
        const placements: Placement[] = [
            { x: 0, y: 0, tile }
        ];

        const result = await game.placeMove('p1', placements, mockCheckWord);
        expect(result.success).toBe(false);
        expect(result.message).toContain('First move must cover center');
    });

    it('validates tiles must be in rack', async () => {
        game.start('en', ['p1']);

        // Create a fake tile not in rack
        const fakeTile = { id: 'fake', letter: 'A', value: 1 };
        const placements: Placement[] = [
            { x: 7, y: 7, tile: fakeTile }
        ];

        const result = await game.placeMove('p1', placements, mockCheckWord);
        expect(result.success).toBe(false);
        expect(result.message).toContain('Tile not in rack');
    });

    describe('placeMove validation edge cases', () => {
        it('rejects move when it is not the player turn', async () => {
            game.start('en', ['p1', 'p2']);
            const state = game.getState();
            const tile = state.racks['p2'][0];

            const result = await game.placeMove('p2', [{ x: 7, y: 7, tile }], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Not your turn');
        });

        it('rejects move with no placements', async () => {
            game.start('en', ['p1']);

            const result = await game.placeMove('p1', [], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Place at least one tile');
        });

        it('rejects placement outside the board', async () => {
            game.start('en', ['p1']);
            const state = game.getState();
            const tile = state.racks['p1'][0];

            const result = await game.placeMove('p1', [{ x: -1, y: 7, tile }], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Placement outside board');
        });

        it('rejects placement on an occupied cell', async () => {
            game.start('en', ['p1']);
            const state = game.getState();
            const [first] = state.racks['p1'];
            await game.placeMove('p1', [{ x: 7, y: 7, tile: first }], mockCheckWord);
            const nextRack = game.getState().racks['p1'];

            const result = await game.placeMove('p1', [{ x: 7, y: 7, tile: nextRack[0] }], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Cell already occupied');
        });

        it('rejects diagonal placement (must align in row or column)', async () => {
            game.start('en', ['p1']);
            const state = game.getState();
            const [a, b] = state.racks['p1'];

            const result = await game.placeMove('p1', [
                { x: 7, y: 7, tile: a },
                { x: 8, y: 8, tile: b }
            ], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Tiles must align in a row or column');
        });

        it('rejects non-connecting move after board is no longer empty', async () => {
            game.start('en', ['p1']);
            const state = game.getState();
            const rack = state.racks['p1'];
            await game.placeMove('p1', [{ x: 7, y: 7, tile: rack[0] }], mockCheckWord);
            const nextRack = game.getState().racks['p1'];

            const result = await game.placeMove('p1', [{ x: 0, y: 0, tile: nextRack[0] }], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Move must connect to existing tiles');
        });

        it('rejects non-contiguous line even when alignment and connection checks pass', async () => {
            game.start('en', ['p1']);
            const state = game.getState();
            const rack = state.racks['p1'];
            await game.placeMove('p1', [
                { x: 7, y: 7, tile: rack[0] },
                { x: 8, y: 7, tile: rack[1] }
            ], mockCheckWord);
            const nextRack = game.getState().racks['p1'];

            const result = await game.placeMove('p1', [
                { x: 6, y: 7, tile: nextRack[0] },
                { x: 10, y: 7, tile: nextRack[1] }
            ], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Tiles must form a contiguous line');
        });

        it('rejects move when no valid word is formed', async () => {
            game.start('en', ['p1']);
            withState((nextState) => {
                nextState.racks['p1'][0] = { ...nextState.racks['p1'][0], letter: '' };
            });

            const state = game.getState();
            const result = await game.placeMove('p1', [{ x: 7, y: 7, tile: state.racks['p1'][0] }], mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('No valid word formed');
        });
    });

    it('accepts valid first move', async () => {
        game.start('en', ['p1']);
        withState((state) => {
            // Force known letters into rack for predictable word
            state.racks['p1'][0] = { id: 't1', letter: 'H', value: 4 };
            state.racks['p1'][1] = { id: 't2', letter: 'I', value: 1 };
        });
        const state = game.getState();
        const rack = state.racks['p1'];

        const placements: Placement[] = [
            { x: 7, y: 7, tile: rack[0] },
            { x: 8, y: 7, tile: rack[1] }
        ];

        const result = await game.placeMove('p1', placements, mockCheckWord);

        expect(result.success).toBe(true);
        expect(result.words).toContain('HI');
        // H(4) + I(1) = 5. Center is double word -> 10.
        expect(result.scoreDelta).toBe(10);
        expect(game.getState().scores['p1']).toBe(10);
    });

    it('advances turn after move', async () => {
        game.start('en', ['p1', 'p2']);
        const state = game.getState();
        const rack = state.racks['p1'];

        const placements: Placement[] = [
            { x: 7, y: 7, tile: rack[0] }
        ];

        await game.placeMove('p1', placements, mockCheckWord);

        expect(game.getState().currentPlayer).toBe('p2');
        expect(game.getState().moveNumber).toBe(1);
    });

    it('does not call checkGameEnd from placeMove hot path', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const checkGameEndSpy = vi.spyOn(game, 'checkGameEnd');

        const result = await game.placeMove('p1', [{ x: 7, y: 7, tile: state.racks['p1'][0] }], mockCheckWord);
        expect(result.success).toBe(true);
        expect(checkGameEndSpy).not.toHaveBeenCalled();
    });

    it('refills rack after move', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const rack = state.racks['p1'];
        const initialBagSize = state.bag.length;

        const placements: Placement[] = [
            { x: 7, y: 7, tile: rack[0] },
            { x: 8, y: 7, tile: rack[1] }
        ];

        await game.placeMove('p1', placements, mockCheckWord);

        const newState = game.getState();
        expect(newState.racks['p1']).toHaveLength(7);
        expect(newState.bag.length).toBe(initialBagSize - 2);
    });

    it('handles pass turn', () => {
        game.start('en', ['p1', 'p2']);

        const result = game.passTurn('p1');

        expect(result.success).toBe(true);
        expect(game.getState().currentPlayer).toBe('p2');
        expect(game.getState().moveNumber).toBe(1);
    });

    it('ends game after 4 consecutive passes (2 per player) and applies end-game scoring', () => {
        game.start('en', ['p1', 'p2']);
        withState((state) => {
            state.racks['p1'] = [
                { id: 'p1a', letter: 'A', value: 1 },
                { id: 'p1b', letter: 'B', value: 3 }
            ];
            state.racks['p2'] = [
                { id: 'p2c', letter: 'C', value: 3 }
            ];
        });

        expect(game.passTurn('p1').success).toBe(true);
        expect(game.passTurn('p2').success).toBe(true);
        expect(game.passTurn('p1').success).toBe(true);
        const last = game.passTurn('p2');

        expect(last.success).toBe(true);
        expect(last.gameEnded?.reason).toBe('four_passes');
        expect(last.gameEnded?.finalScores).toEqual({ p1: -4, p2: -3 });
    });

    it('handles exchange tiles', () => {
        game.start('en', ['p1', 'p2']);
        const state = game.getState();
        const rack = state.racks['p1'];
        const tilesToExchange = [rack[0].id, rack[1].id];

        const result = game.exchangeTiles('p1', tilesToExchange);

        expect(result.success).toBe(true);
        expect(game.getState().currentPlayer).toBe('p2');
        expect(game.getState().racks['p1']).toHaveLength(7);

        // Check tiles were actually swapped (ids should change)
        const newRack = game.getState().racks['p1'];
        const newIds = newRack.map(t => t.id);
        expect(newIds).not.toContain(tilesToExchange[0]);
        expect(newIds).not.toContain(tilesToExchange[1]);
    });

    it('records move history entries for move, pass, and exchange', async () => {
        game.start('en', ['p1', 'p2']);

        // 1) MOVE by p1: force predictable word "HI"
        withState((state1) => {
            state1.racks['p1'][0] = { id: 't1', letter: 'H', value: 4 };
            state1.racks['p1'][1] = { id: 't2', letter: 'I', value: 1 };
        });
        const state1 = game.getState();
        const rack1 = state1.racks['p1'];
        const placements1: Placement[] = [
            { x: 7, y: 7, tile: rack1[0] },
            { x: 8, y: 7, tile: rack1[1] }
        ];

        const moveResult = await game.placeMove('p1', placements1, mockCheckWord);
        expect(moveResult.success).toBe(true);

        const afterMove = game.getState();
        expect(afterMove.history).toHaveLength(1);
        expect(afterMove.history[0].type).toBe('MOVE');
        expect(afterMove.history[0].playerId).toBe('p1');
        expect(afterMove.history[0].moveNumber).toBe(1);
        if (afterMove.history[0].type === 'MOVE') {
            expect(afterMove.history[0].words).toEqual(['HI']);
            expect(afterMove.history[0].scoreDelta).toBe(10);
            expect(afterMove.history[0].placedTiles).toBe(2);
        }

        // 2) PASS by p2
        const passResult = game.passTurn('p2');
        expect(passResult.success).toBe(true);
        const afterPass = game.getState();
        expect(afterPass.history).toHaveLength(2);
        expect(afterPass.history[1].type).toBe('PASS');
        expect(afterPass.history[1].playerId).toBe('p2');
        expect(afterPass.history[1].moveNumber).toBe(2);

        // 3) EXCHANGE by p1
        withState((state) => {
            state.racks['p1'][0] = { id: 't3', letter: 'A', value: 1 };
            state.racks['p1'][1] = { id: 't4', letter: 'B', value: 3 };
            state.racks['p1'][2] = { id: 't5', letter: 'C', value: 3 };
        });
        const state3 = game.getState();
        const rack3 = state3.racks['p1'];
        const exchangeIds = [rack3[0].id, rack3[1].id, rack3[2].id];
        const exchangeResult = game.exchangeTiles('p1', exchangeIds);
        expect(exchangeResult.success).toBe(true);
        const afterExchange = game.getState();
        expect(afterExchange.history).toHaveLength(3);
        expect(afterExchange.history[2].type).toBe('EXCHANGE');
        expect(afterExchange.history[2].playerId).toBe('p1');
        expect(afterExchange.history[2].moveNumber).toBe(3);
        if (afterExchange.history[2].type === 'EXCHANGE') {
            expect(afterExchange.history[2].exchangedTiles).toBe(3);
        }
    });

    it('rejects move if dictionary check fails', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const rack = state.racks['p1'];
        mockCheckWord.mockResolvedValue(false);

        const placements: Placement[] = [
            { x: 7, y: 7, tile: rack[0] }
        ];

        const result = await game.placeMove('p1', placements, mockCheckWord);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid word');
    });

    interface WordChecker {
        (word: string): Promise<boolean>;
        getAllWords?: () => Set<string>;
    }

    // ... existing code ...

    it('detects game end when bag is empty and no players have valid moves', async () => {
        game.start('en', ['p1', 'p2']);
        withState((state) => {
            state.bag = [];
        });

        const checker: WordChecker = async () => false;
        checker.getAllWords = () => new Set<string>();

        const ended = await game.checkGameEnd(checker);
        expect(ended.ended).toBe(true);
        expect(ended.reason).toBe('no_moves_bag_empty');
    });

    describe('exchangeTiles edge cases', () => {
        it('rejects empty tileIds', () => {
            game.start('en', ['p1', 'p2']);
            const result = game.exchangeTiles('p1', []);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Choose tiles to exchange');
        });

        it('rejects tiles not in rack', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.racks['p1'] = [{ id: 'rack-1', letter: 'A', value: 1 }];
            });
            const rack = game.getState().racks['p1'];
            const result = game.exchangeTiles('p1', ['missing-id', rack[0].id]);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Tile not in rack');
        });

        it('fails when bag has fewer than 7 tiles', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.bag = [
                    { id: 'b1', letter: 'A', value: 1 },
                    { id: 'b2', letter: 'B', value: 3 },
                    { id: 'b3', letter: 'C', value: 3 },
                    { id: 'b4', letter: 'D', value: 2 },
                    { id: 'b5', letter: 'E', value: 1 },
                    { id: 'b6', letter: 'F', value: 4 }
                ];
            });
            const rack = game.getState().racks['p1'];
            const result = game.exchangeTiles('p1', [rack[0].id]);

            expect(result.success).toBe(false);
            expect(result.message).toBe('Not enough tiles in bag to exchange (need at least 7)');
        });
    });

    describe('exchangeTiles bag minimum (7 tiles)', () => {
        it('succeeds when bag has exactly 7 tiles', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.bag = [
                    { id: 'b1', letter: 'A', value: 1 },
                    { id: 'b2', letter: 'B', value: 3 },
                    { id: 'b3', letter: 'C', value: 3 },
                    { id: 'b4', letter: 'D', value: 2 },
                    { id: 'b5', letter: 'E', value: 1 },
                    { id: 'b6', letter: 'F', value: 4 },
                    { id: 'b7', letter: 'G', value: 2 }
                ];
            });
            const state = game.getState();
            const rack = state.racks['p1'];
            const result = game.exchangeTiles('p1', [rack[0].id]);
            expect(result.success).toBe(true);
        });

        it('fails when bag has 6 tiles', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.bag = [
                    { id: 'b1', letter: 'A', value: 1 },
                    { id: 'b2', letter: 'B', value: 3 },
                    { id: 'b3', letter: 'C', value: 3 },
                    { id: 'b4', letter: 'D', value: 2 },
                    { id: 'b5', letter: 'E', value: 1 },
                    { id: 'b6', letter: 'F', value: 4 }
                ];
            });
            const state = game.getState();
            const rack = state.racks['p1'];
            const result = game.exchangeTiles('p1', [rack[0].id]);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Not enough tiles in bag to exchange (need at least 7)');
        });

        it('fails when bag has 0 tiles', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.bag = [];
            });
            const state = game.getState();
            const rack = state.racks['p1'];
            const result = game.exchangeTiles('p1', [rack[0].id]);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Not enough tiles in bag to exchange (need at least 7)');
        });
    });

    describe('blank tile value validation in placeMove', () => {
        it('rejects blank tile with value > 0', async () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.racks['p1'] = [
                    { id: 'b1', letter: ' ', value: 0, blank: true },
                    { id: 't1', letter: 'A', value: 1 },
                    { id: 't2', letter: 'B', value: 3 },
                    { id: 't3', letter: 'C', value: 3 },
                    { id: 't4', letter: 'D', value: 2 },
                    { id: 't5', letter: 'E', value: 1 },
                    { id: 't6', letter: 'F', value: 4 }
                ];
            });
            void game.getState();

            const placements: Placement[] = [
                { x: 7, y: 7, tile: { id: 'b1', letter: 'Z', value: 10, blank: true } }
            ];

            const result = await game.placeMove('p1', placements, mockCheckWord);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Blank tiles must have value 0');
        });

        it('accepts blank tile with value = 0', async () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.racks['p1'] = [
                    { id: 'b1', letter: ' ', value: 0, blank: true },
                    { id: 't1', letter: 'A', value: 1 },
                    { id: 't2', letter: 'B', value: 3 },
                    { id: 't3', letter: 'C', value: 3 },
                    { id: 't4', letter: 'D', value: 2 },
                    { id: 't5', letter: 'E', value: 1 },
                    { id: 't6', letter: 'F', value: 4 }
                ];
            });
            void game.getState();

            const placements: Placement[] = [
                { x: 7, y: 7, tile: { id: 'b1', letter: 'A', value: 0, blank: true } },
                { x: 8, y: 7, tile: { id: 't1', letter: 'A', value: 1 } }
            ];

            const result = await game.placeMove('p1', placements, mockCheckWord);
            expect(result.success).toBe(true);
        });
    });

    describe('applyEndGameScoring', () => {
        it('subtracts rack tile values from each player score', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                // Manually set known scores and racks
                state.scores['p1'] = 30;
                state.scores['p2'] = 20;
                state.racks['p1'] = [{ id: 'a', letter: 'A', value: 1 }, { id: 'b', letter: 'B', value: 3 }];
                state.racks['p2'] = [{ id: 'c', letter: 'Q', value: 10 }];
            });
            const state = game.getState();

            game.applyEndGameScoring();

            expect(state.scores['p1']).toBe(26); // 30 - (1+3)
            expect(state.scores['p2']).toBe(10); // 20 - 10
        });

        it('can produce negative scores', () => {
            game.start('en', ['p1']);
            withState((state) => {
                state.scores['p1'] = 5;
                state.racks['p1'] = [
                    { id: 'a', letter: 'Q', value: 10 },
                    { id: 'b', letter: 'Z', value: 10 }
                ];
            });
            const state = game.getState();

            game.applyEndGameScoring();

            expect(state.scores['p1']).toBe(-15); // 5 - 20
        });

        it('empty rack gets going-out bonus', () => {
            game.start('en', ['p1', 'p2']);
            withState((state) => {
                state.scores['p1'] = 15;
                state.scores['p2'] = 10;
                state.racks['p1'] = [];
                state.racks['p2'] = [{ id: 'a', letter: 'E', value: 1 }];
            });
            const state = game.getState();

            game.applyEndGameScoring();

            expect(state.scores['p1']).toBe(16); // no penalty + bonus of 1 (opponent's tiles)
            expect(state.scores['p2']).toBe(9);  // 10 - 1
        });
    });
});
