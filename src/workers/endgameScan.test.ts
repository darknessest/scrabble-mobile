import { describe, it, expect } from 'vitest';
import type { GameState, Tile } from '../core/types';
import { __testing } from './endgameScan.worker';

function makeTile(letter: string, opts?: { blank?: boolean }): Tile {
  return {
    id: `t-${letter}-${Math.random().toString(16).slice(2)}`,
    letter,
    value: 0,
    blank: opts?.blank
  };
}

function emptyBoard(): GameState['board'] {
  return Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => ({ tile: null })));
}

function makeState(params: {
  board?: GameState['board'];
  language?: GameState['language'];
  players?: string[];
  racks?: Record<string, Tile[]>;
}): GameState {
  const players = params.players ?? ['p1'];
  const racks = params.racks ?? { p1: [] };
  return {
    board: params.board ?? emptyBoard(),
    bag: [],
    racks,
    scores: Object.fromEntries(players.map((p) => [p, 0])),
    currentPlayer: players[0],
    players,
    language: params.language ?? 'en',
    moveNumber: 0,
    lastMove: null,
    history: [],
    sessionId: 'test'
  };
}

describe('endgameScan (trie backtracking)', () => {
  it('finds a first move on an empty board that covers center', () => {
    const state = makeState({
      board: emptyBoard(),
      racks: { p1: [makeTile('H'), makeTile('I')] }
    });
    const words = new Set(['HI']);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterToIndex = __testing.buildLetterToIndex(alphabet);
    const root = __testing.buildTrie(words, letterToIndex);
    const cross = __testing.computeCrossMasks(state.board, alphabet, letterToIndex, words, 2);

    const anchors = [{ x: 7, y: 7 }];
    const hasAny = __testing.hasAnyValidMoveFast(state, 'p1', anchors, true, root, letterToIndex, cross, alphabet.length, 2);
    expect(hasAny).toBe(true);
  });

  it('does not allow single-letter words when minLength=2', () => {
    const state = makeState({
      board: emptyBoard(),
      racks: { p1: [makeTile('A')] }
    });
    const words = new Set(['A']);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterToIndex = __testing.buildLetterToIndex(alphabet);
    const root = __testing.buildTrie(words, letterToIndex);
    const cross = __testing.computeCrossMasks(state.board, alphabet, letterToIndex, words, 2);

    const anchors = [{ x: 7, y: 7 }];
    const hasAny = __testing.hasAnyValidMoveFast(state, 'p1', anchors, true, root, letterToIndex, cross, alphabet.length, 2);
    expect(hasAny).toBe(false);
  });

  it('finds a move that extends an existing tile (fixed prefix before anchor)', () => {
    const board = emptyBoard();
    board[7][7].tile = makeTile('H'); // existing
    const state = makeState({
      board,
      racks: { p1: [makeTile('I')] }
    });
    const words = new Set(['HI']);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterToIndex = __testing.buildLetterToIndex(alphabet);
    const root = __testing.buildTrie(words, letterToIndex);
    const cross = __testing.computeCrossMasks(state.board, alphabet, letterToIndex, words, 2);

    // Anchor is the empty cell right of H.
    const anchors = [{ x: 8, y: 7 }];
    const hasAny = __testing.hasAnyValidMoveFast(state, 'p1', anchors, false, root, letterToIndex, cross, alphabet.length, 2);
    expect(hasAny).toBe(true);
  });

  it('respects cross-checks for perpendicular words', () => {
    const board = emptyBoard();
    // Existing H so we try to play "HI" by placing I at (7,7) next to it.
    board[7][6].tile = makeTile('H');
    // Vertical neighbors at (7,7) will form A?T.
    board[6][7].tile = makeTile('A');
    board[8][7].tile = makeTile('T');
    const state = makeState({
      board,
      racks: { p1: [makeTile('I')] }
    });

    // Primary word "HI" is valid, but cross word "AIT" is NOT present => should be rejected.
    const words = new Set(['HI']);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterToIndex = __testing.buildLetterToIndex(alphabet);
    const root = __testing.buildTrie(words, letterToIndex);
    const cross = __testing.computeCrossMasks(state.board, alphabet, letterToIndex, words, 2);

    const anchors = [{ x: 7, y: 7 }];
    const hasAny = __testing.hasAnyValidMoveFast(state, 'p1', anchors, false, root, letterToIndex, cross, alphabet.length, 2);
    expect(hasAny).toBe(false);
  });

  it('supports blanks as wildcards', () => {
    const board = emptyBoard();
    board[7][7].tile = makeTile('H');
    const state = makeState({
      board,
      racks: { p1: [makeTile(' ', { blank: true })] }
    });

    const words = new Set(['HI']);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterToIndex = __testing.buildLetterToIndex(alphabet);
    const root = __testing.buildTrie(words, letterToIndex);
    const cross = __testing.computeCrossMasks(state.board, alphabet, letterToIndex, words, 2);

    const anchors = [{ x: 8, y: 7 }];
    const hasAny = __testing.hasAnyValidMoveFast(state, 'p1', anchors, false, root, letterToIndex, cross, alphabet.length, 2);
    expect(hasAny).toBe(true);
  });
});

