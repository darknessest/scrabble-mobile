import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScrabbleGame, type WordChecker } from './game';
import type { Placement, Tile } from './types';

// Mock crypto.randomUUID
let uuidCounter = 0;
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => `endgame-uuid-${uuidCounter++}`
  }
});

function makeTile(id: string, letter: string, value: number): Tile {
  return { id, letter, value };
}

describe('ScrabbleGame Endgame', () => {
  let game: ScrabbleGame;
  const mockCheckWord: WordChecker = Object.assign(
    vi.fn().mockResolvedValue(true),
    { getAllWords: undefined as WordChecker['getAllWords'] }
  );

  beforeEach(() => {
    uuidCounter = 0;
    game = new ScrabbleGame();
    (mockCheckWord as ReturnType<typeof vi.fn>).mockClear();
    (mockCheckWord as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  describe('rack_empty_bag_empty game end', () => {
    it('game ends when player empties rack with empty bag via placeMove', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Place an initial word so the board is not empty
      state.board[7][7].tile = makeTile('existing-H', 'H', 4);
      state.board[7][8].tile = makeTile('existing-I', 'I', 1);

      // Empty the bag
      state.bag.length = 0;

      // Give p1 exactly 2 tiles that will be placed
      const tileA = makeTile('go-out-1', 'A', 1);
      const tileT = makeTile('go-out-2', 'T', 1);
      state.racks['p1'] = [tileA, tileT];

      // Give p2 some remaining tiles
      state.racks['p2'] = [makeTile('p2-tile-1', 'X', 8), makeTile('p2-tile-2', 'Z', 10)];

      // Place tiles extending from existing word: H I at (7,7)-(7,8)
      // Place A T at (7,9)-(7,10) to form "HIAT"
      const placements: Placement[] = [
        { x: 9, y: 7, tile: tileA },
        { x: 10, y: 7, tile: tileT }
      ];

      const result = await game.placeMove('p1', placements, mockCheckWord);

      expect(result.success).toBe(true);
      expect(result.gameEnded).toBeDefined();
      expect(result.gameEnded!.reason).toBe('rack_empty_bag_empty');
    });

    it('awards going-out bonus correctly', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Set up board with existing word
      state.board[7][7].tile = makeTile('existing-C', 'C', 3);
      state.board[7][8].tile = makeTile('existing-A', 'A', 1);

      // Empty bag
      state.bag.length = 0;

      // P1 has exactly 2 tiles to place (uses them all)
      const tileT = makeTile('p1-T', 'T', 1);
      const tileS = makeTile('p1-S', 'S', 1);
      state.racks['p1'] = [tileT, tileS];

      // P2 has tiles worth 15 points total
      state.racks['p2'] = [
        makeTile('p2-1', 'Q', 10),
        makeTile('p2-2', 'E', 1),
        makeTile('p2-3', 'H', 4)
      ];

      // Set initial scores
      state.scores['p1'] = 50;
      state.scores['p2'] = 40;

      // Place T S at (7,9)-(7,10) extending "CA" to "CATS"
      const placements: Placement[] = [
        { x: 9, y: 7, tile: tileT },
        { x: 10, y: 7, tile: tileS }
      ];

      const result = await game.placeMove('p1', placements, mockCheckWord);

      expect(result.success).toBe(true);
      expect(result.gameEnded).toBeDefined();
      expect(result.gameEnded!.reason).toBe('rack_empty_bag_empty');

      const finalScores = result.gameEnded!.finalScores;

      // P2's penalty: Q(10) + E(1) + H(4) = 15
      // P2 final: 40 - 15 = 25
      expect(finalScores['p2']).toBe(25);

      // P1 gets move score + going-out bonus (15 from P2's tiles)
      // P1's rack is empty so no penalty, and they get the 15 bonus
      // The exact move score depends on premium squares, but the bonus should be included.
      // P1 final = 50 + scoreDelta + 15 (bonus)
      // We check that the bonus is at least applied: finalScores['p1'] > 50 + scoreDelta
      const scoreDelta = result.scoreDelta!;
      expect(finalScores['p1']).toBe(50 + scoreDelta + 15);
    });

    it('records history entry before game-end check', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      state.board[7][7].tile = makeTile('existing-A', 'A', 1);

      state.bag.length = 0;

      const tileB = makeTile('p1-B', 'B', 3);
      state.racks['p1'] = [tileB];
      state.racks['p2'] = [makeTile('p2-1', 'X', 8)];

      const placements: Placement[] = [
        { x: 8, y: 7, tile: tileB }
      ];

      await game.placeMove('p1', placements, mockCheckWord);

      // History should have the MOVE entry recorded
      const lastEntry = state.history[state.history.length - 1];
      expect(lastEntry.type).toBe('MOVE');
      expect(lastEntry.playerId).toBe('p1');
    });
  });

  describe('applyEndGameScoring', () => {
    it('awards bonus to the player with an empty rack', () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // P1 has empty rack (went out)
      state.racks['p1'] = [];
      // P2 has tiles worth 12 points
      state.racks['p2'] = [
        makeTile('r1', 'Q', 10),
        makeTile('r2', 'A', 1),
        makeTile('r3', 'E', 1)
      ];

      state.scores['p1'] = 100;
      state.scores['p2'] = 80;

      game.applyEndGameScoring();

      // P2 loses 12 points: 80 - 12 = 68
      expect(state.scores['p2']).toBe(68);
      // P1 gains 12 points (bonus): 100 + 12 = 112
      expect(state.scores['p1']).toBe(112);
    });

    it('only deducts penalties when no player has empty rack (four_passes case)', () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Both players have tiles remaining
      state.racks['p1'] = [
        makeTile('r1', 'A', 1),
        makeTile('r2', 'B', 3)
      ];
      state.racks['p2'] = [
        makeTile('r3', 'Q', 10),
        makeTile('r4', 'Z', 10)
      ];

      state.scores['p1'] = 100;
      state.scores['p2'] = 80;

      game.applyEndGameScoring();

      // P1 loses 4 points (A=1, B=3): 100 - 4 = 96
      expect(state.scores['p1']).toBe(96);
      // P2 loses 20 points (Q=10, Z=10): 80 - 20 = 60
      expect(state.scores['p2']).toBe(60);
      // No bonus awarded to anyone
    });
  });

  describe('checkGameEnd', () => {
    it('detects rack_empty_bag_empty condition', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Empty bag
      state.bag.length = 0;

      // P1 has empty rack
      state.racks['p1'] = [];
      // P2 still has tiles
      state.racks['p2'] = [makeTile('r1', 'A', 1)];

      const result = await game.checkGameEnd(mockCheckWord);

      expect(result.ended).toBe(true);
      expect(result.reason).toBe('rack_empty_bag_empty');
    });

    it('does not trigger rack_empty_bag_empty when bag is not empty', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Bag has tiles
      state.bag = [makeTile('bag-1', 'A', 1)];

      // P1 has empty rack
      state.racks['p1'] = [];
      state.racks['p2'] = [makeTile('r1', 'B', 3)];

      const result = await game.checkGameEnd(mockCheckWord);

      expect(result.ended).toBe(false);
    });

    it('still detects four_passes before rack_empty_bag_empty', async () => {
      game.start('en', ['p1', 'p2']);
      const state = game.getState();

      // Set up four consecutive passes
      state.history = [
        { type: 'PASS', moveNumber: 1, playerId: 'p1', timestamp: 1 },
        { type: 'PASS', moveNumber: 2, playerId: 'p2', timestamp: 2 },
        { type: 'PASS', moveNumber: 3, playerId: 'p1', timestamp: 3 },
        { type: 'PASS', moveNumber: 4, playerId: 'p2', timestamp: 4 }
      ];

      // Also set up rack_empty_bag_empty condition
      state.bag.length = 0;
      state.racks['p1'] = [];

      const result = await game.checkGameEnd(mockCheckWord);

      // four_passes should be detected first
      expect(result.ended).toBe(true);
      expect(result.reason).toBe('four_passes');
    });
  });
});
