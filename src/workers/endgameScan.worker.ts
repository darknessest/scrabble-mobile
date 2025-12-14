import type { GameState, Language } from '../core/types';
import { getDictionaryWordSet, setMinWordLength, type DictionaryKey } from '../dictionary/dictionaryService';

type RussianVariant = 'full' | 'strict' | undefined;

type EndgameScanRequest = {
  type: 'ENDGAME_SCAN_REQUEST';
  requestId: string;
  state: GameState;
  language: Language;
  russianVariant?: RussianVariant;
  minLength: number;
};

type EndgameScanResponse =
  | {
    type: 'ENDGAME_SCAN_RESPONSE';
    requestId: string;
    allStuck: boolean;
    reason?: 'dictionary_unavailable';
  }
  | {
    type: 'ENDGAME_SCAN_RESPONSE';
    requestId: string;
    allStuck: false;
    reason: 'error';
    error: string;
  };

const BOARD_SIZE = 15;

function inBounds(v: number) {
  return v >= 0 && v < BOARD_SIZE;
}

function boardHasAnyTiles(board: GameState['board']): boolean {
  return board.some((row) => row.some((cell) => cell.tile !== null));
}

type Anchor = { x: number; y: number };

function computeAnchors(board: GameState['board']): Anchor[] {
  if (!boardHasAnyTiles(board)) return [{ x: 7, y: 7 }];

  const anchors: Anchor[] = [];
  const seen = new Set<string>();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x].tile) continue;
      const touches =
        (inBounds(x + 1) && board[y][x + 1].tile) ||
        (inBounds(x - 1) && board[y][x - 1].tile) ||
        (inBounds(y + 1) && board[y + 1][x].tile) ||
        (inBounds(y - 1) && board[y - 1][x].tile);
      if (!touches) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ x, y });
    }
  }
  return anchors;
}

type Orientation = 'row' | 'col';

function buildPrimaryWord(
  board: GameState['board'],
  word: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  orientation: Orientation
): string {
  const left: string[] = [];
  if (orientation === 'row') {
    let x = startX - 1;
    const y = startY;
    while (inBounds(x) && board[y][x].tile) {
      left.push(board[y][x].tile!.letter);
      x -= 1;
    }
    left.reverse();

    const right: string[] = [];
    x = endX + 1;
    while (inBounds(x) && board[y][x].tile) {
      right.push(board[y][x].tile!.letter);
      x += 1;
    }
    return `${left.join('')}${word}${right.join('')}`;
  }

  // col
  let y = startY - 1;
  const x = startX;
  while (inBounds(y) && board[y][x].tile) {
    left.push(board[y][x].tile!.letter);
    y -= 1;
  }
  left.reverse();

  const right: string[] = [];
  y = endY + 1;
  while (inBounds(y) && board[y][x].tile) {
    right.push(board[y][x].tile!.letter);
    y += 1;
  }
  return `${left.join('')}${word}${right.join('')}`;
}

function buildCrossWord(
  board: GameState['board'],
  x: number,
  y: number,
  placedLetter: string,
  orientation: Orientation
): string {
  // If primary is row, cross is col. If primary is col, cross is row.
  if (orientation === 'row') {
    const up: string[] = [];
    let cy = y - 1;
    while (inBounds(cy) && board[cy][x].tile) {
      up.push(board[cy][x].tile!.letter);
      cy -= 1;
    }
    up.reverse();

    const down: string[] = [];
    cy = y + 1;
    while (inBounds(cy) && board[cy][x].tile) {
      down.push(board[cy][x].tile!.letter);
      cy += 1;
    }

    return `${up.join('')}${placedLetter}${down.join('')}`;
  }

  const left: string[] = [];
  let cx = x - 1;
  while (inBounds(cx) && board[y][cx].tile) {
    left.push(board[y][cx].tile!.letter);
    cx -= 1;
  }
  left.reverse();

  const right: string[] = [];
  cx = x + 1;
  while (inBounds(cx) && board[y][cx].tile) {
    right.push(board[y][cx].tile!.letter);
    cx += 1;
  }

  return `${left.join('')}${placedLetter}${right.join('')}`;
}

function rackCountsForPlayer(state: GameState, playerId: string): { counts: Map<string, number>; blanks: number } {
  const rack = state.racks[playerId] ?? [];
  const counts = new Map<string, number>();
  let blanks = 0;
  for (const t of rack) {
    if (t.blank) blanks += 1;
    const letter = t.letter;
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return { counts, blanks };
}

function hasAnyValidMove(
  state: GameState,
  playerId: string,
  wordSet: Set<string>,
  minLength: number
): boolean {
  const rack = state.racks[playerId] ?? [];
  if (rack.length === 0) return false;

  const boardIsEmpty = !boardHasAnyTiles(state.board);
  const anchors = computeAnchors(state.board);
  const { counts: rackCounts, blanks: rackBlanks } = rackCountsForPlayer(state, playerId);

  // Iterate over the full dictionary; keep the inner checks very cheap.
  for (const raw of wordSet) {
    const word = raw.trim().toUpperCase();
    const len = word.length;
    if (len < minLength) continue;
    if (len > BOARD_SIZE) continue;

    for (const anchor of anchors) {
      for (const orientation of ['row', 'col'] as const) {
        for (let idx = 0; idx < len; idx += 1) {
          const startX = orientation === 'row' ? anchor.x - idx : anchor.x;
          const startY = orientation === 'row' ? anchor.y : anchor.y - idx;
          const endX = orientation === 'row' ? startX + len - 1 : startX;
          const endY = orientation === 'row' ? startY : startY + len - 1;

          if (!inBounds(startX) || !inBounds(startY) || !inBounds(endX) || !inBounds(endY)) continue;

          // Quick first-move safety.
          if (boardIsEmpty) {
            const coversCenter =
              orientation === 'row'
                ? startY === 7 && startX <= 7 && endX >= 7
                : startX === 7 && startY <= 7 && endY >= 7;
            if (!coversCenter) continue;
          }

          // Count required letters for empty cells (existing tiles must match).
          const needed = new Map<string, number>();
          let placedCount = 0;
          let mismatch = false;

          for (let i = 0; i < len; i += 1) {
            const x = orientation === 'row' ? startX + i : startX;
            const y = orientation === 'row' ? startY : startY + i;
            const existing = state.board[y][x].tile;
            const letter = word[i];

            if (existing) {
              if (existing.letter !== letter) {
                mismatch = true;
                break;
              }
              continue;
            }

            placedCount += 1;
            needed.set(letter, (needed.get(letter) ?? 0) + 1);
          }

          if (mismatch) continue;
          if (placedCount === 0) continue;

          // Check rack sufficiency (letters beyond rack can be covered by blanks).
          let blanksNeeded = 0;
          for (const [letter, n] of needed) {
            const avail = rackCounts.get(letter) ?? 0;
            if (n > avail) blanksNeeded += n - avail;
            if (blanksNeeded > rackBlanks) break;
          }
          if (blanksNeeded > rackBlanks) continue;

          // Validate the primary word as computeScore() would see it (including any existing extensions).
          const primary = buildPrimaryWord(state.board, word, startX, startY, endX, endY, orientation);
          if (primary.length < minLength) continue;
          if (!wordSet.has(primary)) continue;

          // Validate cross-words created by newly placed tiles.
          // Mirrors collectFormedWords(): only validate secondary words of length > 1.
          let crossOk = true;
          for (let i = 0; i < len; i += 1) {
            const x = orientation === 'row' ? startX + i : startX;
            const y = orientation === 'row' ? startY : startY + i;
            if (state.board[y][x].tile) continue; // not placed

            const cross = buildCrossWord(state.board, x, y, word[i], orientation);
            if (cross.length > 1) {
              if (cross.length < minLength || !wordSet.has(cross)) {
                crossOk = false;
                break;
              }
            }
          }

          if (!crossOk) continue;

          return true;
        }
      }
    }
  }

  return false;
}

async function runScan(req: EndgameScanRequest): Promise<EndgameScanResponse> {
  try {
    setMinWordLength(req.minLength);

    const dictKey: DictionaryKey =
      req.language === 'ru' && req.russianVariant === 'strict' ? 'ru-strict' : req.language;

    const wordSet = await getDictionaryWordSet(dictKey);
    if (!wordSet) {
      return { type: 'ENDGAME_SCAN_RESPONSE', requestId: req.requestId, allStuck: false, reason: 'dictionary_unavailable' };
    }

    for (const playerId of req.state.players) {
      const hasAny = hasAnyValidMove(req.state, playerId, wordSet, req.minLength);
      if (hasAny) {
        return { type: 'ENDGAME_SCAN_RESPONSE', requestId: req.requestId, allStuck: false };
      }
    }

    return { type: 'ENDGAME_SCAN_RESPONSE', requestId: req.requestId, allStuck: true };
  } catch (err) {
    return {
      type: 'ENDGAME_SCAN_RESPONSE',
      requestId: req.requestId,
      allStuck: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

self.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as EndgameScanRequest;
  if (!data || data.type !== 'ENDGAME_SCAN_REQUEST') return;
  void runScan(data).then((res) => {
    (self as unknown as Worker).postMessage(res);
  });
});
