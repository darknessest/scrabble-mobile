import { buildPremiumMap } from './boardLayout';
import { buildBag } from './tiles';
import type {
  BoardCell,
  GameState,
  Language,
  MoveResult,
  Placement,
  Premium,
  Tile
} from './types';

export const BOARD_SIZE = 15;
const premiumMap = buildPremiumMap();

export type WordChecker = (word: string, language: Language) => Promise<boolean>;

export class ScrabbleGame {
  private state: GameState | null = null;

  start(language: Language, players: string[]): GameState {
    const bag = buildBag(language);
    const racks: Record<string, Tile[]> = {};
    const scores: Record<string, number> = {};
    players.forEach((id) => {
      racks[id] = drawTiles(bag, 7);
      scores[id] = 0;
    });
    this.state = {
      board: createBoard(),
      bag,
      racks,
      scores,
      currentPlayer: players[0],
      players,
      language,
      moveNumber: 0,
      sessionId: crypto.randomUUID()
    };
    return this.state;
  }

  resume(snapshot: GameState) {
    this.state = structuredClone(snapshot);
  }

  getState(): GameState {
    if (!this.state) {
      throw new Error('Game not started');
    }
    return this.state;
  }

  async placeMove(
    playerId: string,
    placements: Placement[],
    checkWord: WordChecker
  ): Promise<MoveResult> {
    const state = this.getState();
    if (state.currentPlayer !== playerId) {
      return { success: false, message: 'Not your turn' };
    }
    if (placements.length === 0) {
      return { success: false, message: 'Place at least one tile' };
    }
    if (!placements.every((p) => inBounds(p.x) && inBounds(p.y))) {
      return { success: false, message: 'Placement outside board' };
    }
    if (!playerHasTiles(state.racks[playerId], placements.map((p) => p.tile.id))) {
      return { success: false, message: 'Tile not in rack' };
    }
    if (!placements.every((p) => state.board[p.y][p.x].tile === null)) {
      return { success: false, message: 'Cell already occupied' };
    }
    const orientation = inferOrientation(state.board, placements);
    if (!orientation) {
      return { success: false, message: 'Tiles must align in a row or column' };
    }
    if (state.moveNumber === 0 && !placements.some((p) => p.x === 7 && p.y === 7)) {
      return { success: false, message: 'First move must cover center' };
    }
    if (state.moveNumber > 0 && !touchesExisting(state.board, placements)) {
      return { success: false, message: 'Move must connect to existing tiles' };
    }
    if (!isContiguous(state.board, placements, orientation)) {
      return { success: false, message: 'Tiles must form a contiguous line' };
    }

    let scoreResult: { words: string[]; score: number };
    try {
      scoreResult = await computeScore(
        state.board,
        placements,
        orientation,
        state.language,
        checkWord
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid move';
      return { success: false, message };
    }
    if (scoreResult.words.length === 0) {
      return { success: false, message: 'No valid word formed' };
    }

    // Apply placements
    placements.forEach((p) => {
      state.board[p.y][p.x].tile = p.tile;
    });

    // Update rack
    const { remaining } = removeTiles(state.racks[playerId], placements.map((p) => p.tile.id));
    state.racks[playerId] = remaining;
    const tilesNeeded = Math.max(0, 7 - state.racks[playerId].length);
    if (tilesNeeded > 0) {
      state.racks[playerId].push(...drawTiles(state.bag, tilesNeeded));
    }

    // Update scores and turn
    state.scores[playerId] += scoreResult.score;
    state.moveNumber += 1;
    state.currentPlayer = nextPlayer(state.players, playerId);

    return { success: true, scoreDelta: scoreResult.score };
  }

  passTurn(playerId: string): MoveResult {
    const state = this.getState();
    if (state.currentPlayer !== playerId) {
      return { success: false, message: 'Not your turn' };
    }
    state.currentPlayer = nextPlayer(state.players, playerId);
    state.moveNumber += 1;
    return { success: true };
  }

  exchangeTiles(playerId: string, tileIds: string[]): MoveResult {
    const state = this.getState();
    if (state.currentPlayer !== playerId) {
      return { success: false, message: 'Not your turn' };
    }
    if (tileIds.length === 0) {
      return { success: false, message: 'Choose tiles to exchange' };
    }
    if (state.bag.length < tileIds.length) {
      return { success: false, message: 'Not enough tiles in bag' };
    }
    if (!playerHasTiles(state.racks[playerId], tileIds)) {
      return { success: false, message: 'Tile not in rack' };
    }
    const { removed, remaining } = removeTiles(state.racks[playerId], tileIds);
    state.racks[playerId] = remaining;
    state.bag.push(...removed);
    shuffleInPlace(state.bag);
    const drawCount = Math.min(removed.length, Math.max(0, 7 - state.racks[playerId].length));
    if (drawCount > 0) {
      state.racks[playerId].push(...drawTiles(state.bag, drawCount));
    }
    state.moveNumber += 1;
    state.currentPlayer = nextPlayer(state.players, playerId);
    return { success: true };
  }
}

function createBoard(): BoardCell[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ tile: null }))
  );
}

function drawTiles(bag: Tile[], count: number): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i += 1) {
    const tile = bag.pop();
    if (tile) tiles.push(tile);
  }
  return tiles;
}

function playerHasTiles(rack: Tile[], tileIds: string[]): boolean {
  const counts: Record<string, number> = {};
  rack.forEach((t) => {
    counts[t.id] = (counts[t.id] ?? 0) + 1;
  });
  return tileIds.every((id) => {
    const available = counts[id] ?? 0;
    if (available <= 0) return false;
    counts[id] = available - 1;
    return true;
  });
}

function removeTiles(rack: Tile[], tileIds: string[]): { removed: Tile[]; remaining: Tile[] } {
  const remaining = [...rack];
  const removed: Tile[] = [];
  tileIds.forEach((id) => {
    const idx = remaining.findIndex((t) => t.id === id);
    if (idx >= 0) {
      removed.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  });
  return { removed, remaining };
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function inBounds(v: number) {
  return v >= 0 && v < BOARD_SIZE;
}

type Orientation = 'row' | 'col';

function inferOrientation(board: BoardCell[][], placements: Placement[]): Orientation | null {
  if (placements.length === 1) {
    const [placement] = placements;
    const { x, y } = placement;
    const left = inBounds(x - 1) && board[y][x - 1].tile;
    const right = inBounds(x + 1) && board[y][x + 1].tile;
    const up = inBounds(y - 1) && board[y - 1][x].tile;
    const down = inBounds(y + 1) && board[y + 1][x].tile;
    const horizontalNeighbor = Boolean(left || right);
    const verticalNeighbor = Boolean(up || down);

    if (horizontalNeighbor && !verticalNeighbor) return 'row';
    if (verticalNeighbor && !horizontalNeighbor) return 'col';
    if (horizontalNeighbor && verticalNeighbor) return 'row';
    return 'row';
  }

  const sameRow = placements.every((p) => p.y === placements[0].y);
  const sameCol = placements.every((p) => p.x === placements[0].x);
  if (sameRow) return 'row';
  if (sameCol) return 'col';
  return null;
}

function touchesExisting(board: BoardCell[][], placements: Placement[]): boolean {
  return placements.some(({ x, y }) => {
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];
    return neighbors.some(([nx, ny]) => inBounds(nx) && inBounds(ny) && board[ny][nx].tile);
  });
}

function isContiguous(
  board: BoardCell[][],
  placements: Placement[],
  orientation: Orientation
): boolean {
  const coords = placements.map((p) => (orientation === 'row' ? p.x : p.y));
  const constant = orientation === 'row' ? placements[0].y : placements[0].x;
  const min = Math.min(...coords);
  const max = Math.max(...coords);
  for (let i = min; i <= max; i += 1) {
    const x = orientation === 'row' ? i : constant;
    const y = orientation === 'row' ? constant : i;
    const occupied = board[y][x].tile !== null || placements.some((p) => p.x === x && p.y === y);
    if (!occupied) return false;
  }
  return true;
}

async function computeScore(
  board: BoardCell[][],
  placements: Placement[],
  orientation: Orientation,
  language: Language,
  checkWord: WordChecker
): Promise<{ words: string[]; score: number }> {
  const tempBoard = board.map((row) => row.map((cell) => ({ ...cell })));
  placements.forEach((p) => {
    tempBoard[p.y][p.x].tile = p.tile;
  });

  const placementKeys = new Set(placements.map((p) => `${p.x},${p.y}`));

  const mainCells = collectWord(tempBoard, placements[0], orientation);
  const mainWord = mainCells.map((c) => c.tile.letter).join('');

  const crossResults = placements.map((p) => {
    const cells = collectWord(tempBoard, p, flip(orientation));
    const word = cells.map((c) => c.tile.letter).join('');
    return { word, cells };
  });

  const crossWords = crossResults.filter((c) => c.word.length > 1);
  const allWords = [mainWord, ...crossWords.map((c) => c.word)];

  for (const word of allWords) {
    const valid = await checkWord(word, language);
    if (!valid) {
      throw new Error(`Invalid word: ${word}`);
    }
  }

  let totalScore = 0;
  totalScore += scoreCells(mainCells, placementKeys, true);
  crossWords.forEach((c) => {
    totalScore += scoreCells(c.cells, placementKeys, false);
  });

  return { words: allWords, score: totalScore };
}

function collectWord(
  board: BoardCell[][],
  startPlacement: Placement,
  orientation: Orientation
): Array<{ x: number; y: number; tile: Tile; premium?: Premium }> {
  let x = startPlacement.x;
  let y = startPlacement.y;

  while (true) {
    const nx = orientation === 'row' ? x - 1 : x;
    const ny = orientation === 'row' ? y : y - 1;
    if (!inBounds(nx) || !inBounds(ny) || !board[ny][nx].tile) break;
    x = nx;
    y = ny;
  }

  const cells: Array<{ x: number; y: number; tile: Tile; premium?: Premium }> = [];
  while (inBounds(x) && inBounds(y) && board[y][x].tile) {
    cells.push({
      x,
      y,
      tile: board[y][x].tile as Tile,
      premium: premiumMap.get(`${x},${y}`)
    });
    if (orientation === 'row') x += 1;
    else y += 1;
  }
  return cells;
}

function flip(orientation: Orientation): Orientation {
  return orientation === 'row' ? 'col' : 'row';
}

function scoreCells(
  cells: Array<{ x: number; y: number; tile: Tile; premium?: Premium }>,
  placementKeys: Set<string>,
  isMain: boolean
): number {
  let total = 0;
  let wordMultiplier = 1;

  cells.forEach((cell) => {
    const isNew = placementKeys.has(`${cell.x},${cell.y}`);
    const letterValue = cell.tile.value;

    if (isNew) {
      if (cell.premium === 'DL') total += letterValue * 2;
      else if (cell.premium === 'TL') total += letterValue * 3;
      else total += letterValue;

      if (cell.premium === 'DW' || cell.premium === 'CENTER') wordMultiplier *= 2;
      if (cell.premium === 'TW') wordMultiplier *= 3;
    } else {
      total += letterValue;
    }
  });

  if (placementKeys.size === 7 && isMain) {
    total += 50;
  }

  return total * wordMultiplier;
}

function nextPlayer(players: string[], current: string): string {
  const idx = players.indexOf(current);
  const next = (idx + 1) % players.length;
  return players[next];
}

