import { describe, it, expect } from 'vitest';
import type { BoardCell } from './types';
import { inBounds, boardHasAnyTiles, computeAnchors, BOARD_SIZE } from './boardUtils';

function makeEmptyBoard(): BoardCell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ tile: null }))
  );
}

describe('inBounds', () => {
  it('accepts values within [0, 14] and rejects outside values', () => {
    expect(inBounds(-1)).toBe(false);
    expect(inBounds(0)).toBe(true);
    expect(inBounds(14)).toBe(true);
    expect(inBounds(15)).toBe(false);
  });
});

describe('boardHasAnyTiles', () => {
  it('returns false for an empty board', () => {
    expect(boardHasAnyTiles(makeEmptyBoard())).toBe(false);
  });

  it('returns true when any cell contains a tile', () => {
    const board = makeEmptyBoard();
    board[7][7].tile = { id: 't1', letter: 'A', value: 1 };
    expect(boardHasAnyTiles(board)).toBe(true);
  });
});

describe('computeAnchors', () => {
  it('returns center anchor for an empty board', () => {
    expect(computeAnchors(makeEmptyBoard())).toEqual([{ x: 7, y: 7 }]);
  });

  it('returns adjacent empty cells around a single center tile', () => {
    const board = makeEmptyBoard();
    board[7][7].tile = { id: 't1', letter: 'A', value: 1 };

    expect(computeAnchors(board)).toEqual(
      expect.arrayContaining([
        { x: 6, y: 7 },
        { x: 8, y: 7 },
        { x: 7, y: 6 },
        { x: 7, y: 8 }
      ])
    );
    expect(computeAnchors(board)).toHaveLength(4);
  });

  it('does not include out-of-bounds anchors for corner tiles', () => {
    const board = makeEmptyBoard();
    board[0][0].tile = { id: 't1', letter: 'A', value: 1 };

    const anchors = computeAnchors(board);
    expect(anchors).toEqual(expect.arrayContaining([{ x: 1, y: 0 }, { x: 0, y: 1 }]));
    expect(anchors).toHaveLength(2);
  });
});
