import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScrabbleGame } from './game';
import type { Placement } from './types';

// Mock crypto.randomUUID for deterministic testing
let uuidCounter = 0;
Object.defineProperty(global, 'crypto', {
    value: {
        randomUUID: () => `test-uuid-${uuidCounter++}`
    }
});

describe('ScrabbleGame', () => {
    let game: ScrabbleGame;
    const mockCheckWord = vi.fn().mockResolvedValue(true);

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

    it('accepts valid first move', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const rack = state.racks['p1'];

        // Force known letters into rack for predictable word
        rack[0] = { id: 't1', letter: 'H', value: 4 };
        rack[1] = { id: 't2', letter: 'I', value: 1 };

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
});

