import type { BoardCell } from './types';

export const BOARD_SIZE = 15;

export function inBounds(v: number): boolean {
  return v >= 0 && v < BOARD_SIZE;
}

export function boardHasAnyTiles(board: BoardCell[][]): boolean {
  return board.some((row) => row.some((cell) => cell.tile !== null));
}

export type Anchor = { x: number; y: number };

export function computeAnchors(board: BoardCell[][]): Anchor[] {
  if (!boardHasAnyTiles(board)) return [{ x: 7, y: 7 }];

  const anchors: Anchor[] = [];
  const seen = new Set<string>();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x].tile) continue;
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      ];
      const touches = neighbors.some(([nx, ny]) => inBounds(nx) && inBounds(ny) && board[ny][nx].tile);
      if (!touches) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ x, y });
    }
  }
  return anchors;
}
