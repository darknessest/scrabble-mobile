import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScrabbleGame } from './game';
import type { Placement } from './types';

// Mock crypto.randomUUID
let uuidCounter = 0;
Object.defineProperty(global, 'crypto', {
    value: {
        randomUUID: () => `test-uuid-${uuidCounter++}`
    }
});

describe('ScrabbleGame Integration', () => {
    let game: ScrabbleGame;
    const mockCheckWord = vi.fn().mockResolvedValue(true);

    beforeEach(() => {
        uuidCounter = 0;
        game = new ScrabbleGame();
        mockCheckWord.mockClear();
        mockCheckWord.mockResolvedValue(true);
    });

    it('plays a short game with scoring and bonuses', async () => {
        // 1. Start game
        game.start('en', ['p1', 'p2']);

        // 2. Player 1 places "HI" on center (Vertical)
        // H(4) I(1) = 5. Center is DW => 10 points.
        let state = game.getState();
        let rack = state.racks['p1'];
        // Hack rack to ensure letters
        rack[0] = { id: 't1', letter: 'H', value: 4 };
        rack[1] = { id: 't2', letter: 'I', value: 1 };

        let placements: Placement[] = [
            { x: 7, y: 7, tile: rack[0] }, // H
            { x: 7, y: 8, tile: rack[1] }  // I
        ];

        let result = await game.placeMove('p1', placements, mockCheckWord);
        expect(result.success).toBe(true);
        expect(result.scoreDelta).toBe(10);
        expect(game.getState().scores['p1']).toBe(10);
        expect(game.getState().currentPlayer).toBe('p2');

        // 3. Player 2 places "IT" horizontally using the 'I' from "HI"
        // I(1) T(1) = 2 points.
        // 'I' is at (7,8). Player 2 adds 'T' at (8,8).
        state = game.getState();
        rack = state.racks['p2'];
        rack[0] = { id: 't3', letter: 'T', value: 1 };

        placements = [
            { x: 8, y: 8, tile: rack[0] }
        ];

        result = await game.placeMove('p2', placements, mockCheckWord);
        expect(result.success).toBe(true);
        expect(result.words).toContain('IT');
        // 'T' is on (8,8) which is DL (Double Letter).
        // T(1)*2 + I(1) = 3 points.
        expect(result.scoreDelta).toBe(3);
        expect(game.getState().scores['p2']).toBe(3);
    });

    it('awards 50 point bonus for using all 7 tiles', async () => {
        game.start('en', ['p1']);
        const state = game.getState();
        const rack = state.racks['p1'];

        // Assume rack has 7 tiles. We'll hack them to be 1-point letters.
        rack.forEach((t) => {
            t.letter = 'A';
            t.value = 1;
        });

        // Place all 7 tiles horizontally across center
        // 7 tiles * 1 point = 7 points.
        // Center is DW => 14 points.
        // Bingo bonus => +50 points.
        // Total => 64 points.
        const placements: Placement[] = rack.map((tile, i) => ({
            x: 4 + i, // 4,5,6,7,8,9,10 (covers 7,7)
            y: 7,
            tile
        }));

        const result = await game.placeMove('p1', placements, mockCheckWord);

        expect(result.success).toBe(true);
        expect(result.scoreDelta).toBe(64);
    });

    it('handles parallel placements creating multiple words', async () => {
        game.start('en', ['p1', 'p2']);
        let state = game.getState();

        // 1. P1 places "FAST" Horizontal at 7,7
        const rack1 = state.racks['p1'];
        // Hack letters
        const letters1 = ['F', 'A', 'S', 'T'];
        letters1.forEach((l, i) => { rack1[i].letter = l; rack1[i].value = 1; }); // simplified values

        let placements: Placement[] = letters1.map((_, i) => ({
            x: 7 + i, y: 7, tile: rack1[i]
        }));

        await game.placeMove('p1', placements, mockCheckWord);

        // 2. P2 places "ACE" Horizontal at 7,8 (directly below F, A, S of FAST)
        // This should form:
        // Main: ACE
        // Cross: FA, AC, SE
        state = game.getState();
        const rack2 = state.racks['p2'];
        const letters2 = ['A', 'C', 'E'];
        letters2.forEach((l, i) => { rack2[i].letter = l; rack2[i].value = 1; });

        placements = letters2.map((_, i) => ({
            x: 7 + i, y: 8, tile: rack2[i]
        }));

        const result = await game.placeMove('p2', placements, mockCheckWord);

        expect(result.success).toBe(true);
        expect(result.words).toContain('ACE');
        expect(result.words).toContain('FA');
        expect(result.words).toContain('AC');
        expect(result.words).toContain('SE');
        expect(result.words).toHaveLength(4);
    });

    it('enforces validation using a real dictionary logic', async () => {
        game.start('en', ['p1', 'p2']);
        const state = game.getState();
        const rack = state.racks['p1'];

        // Define a small dictionary
        const validWords = new Set(['HELLO', 'HE', 'WE', 'DO']);
        const realDictCheck = async (word: string) => validWords.has(word);

        // 1. Try to place "HELLO" - should succeed
        const letters = ['H', 'E', 'L', 'L', 'O'];
        letters.forEach((l, i) => { rack[i].letter = l; rack[i].value = 1; });

        let placements: Placement[] = letters.map((_, i) => ({
            x: 7, y: 7 + i, tile: rack[i] // Vertical at 7,7
        }));

        let result = await game.placeMove('p1', placements, realDictCheck);
        expect(result.success).toBe(true);
        expect(result.words).toEqual(['HELLO']);

        // 2. Try to place "XYZ" - should fail
        // Reset game state for simplicity or continue
        // Let's reset to ensure clean board or just continue if we can form invalid word
        // Actually, let's just create a new game or use P2

        // Reuse P1, it's fine, simulated next turn with hacks
        // But P1 just played, so it's P2's turn.
        // Let's force P1 turn back or use P2.
        const p2Rack = game.getState().racks['p2'];
        p2Rack[0].letter = 'X';
        p2Rack[1].letter = 'Y';
        p2Rack[2].letter = 'Z';

        // Try to place XYZ off the H in HELLO (H is at 7,7)
        // Place Y Z at 8,7 and 9,7 -> H Y Z
        placements = [
            { x: 8, y: 7, tile: p2Rack[1] },
            { x: 9, y: 7, tile: p2Rack[2] }
        ];
        // This creates "H" + "Y" + "Z" = "HYZ" horizontally?
        // Wait, H is at 7,7.
        // If we place Y at 8,7 and Z at 9,7.
        // Main word is HYZ? No, because H is existing.
        // Yes, HYZ.

        result = await game.placeMove('p2', placements, realDictCheck);
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid word');
    });
});
