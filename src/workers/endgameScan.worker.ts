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

const EN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const RU_ALPHABET = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

function alphabetFor(language: DictionaryKey): string {
  return language === 'en' ? EN_ALPHABET : RU_ALPHABET;
}

function buildLetterToIndex(alphabet: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < alphabet.length; i += 1) {
    map.set(alphabet[i], i);
  }
  return map;
}

function bitForIndex(i: number): bigint {
  return 1n << BigInt(i);
}

function allLettersMask(alphabetLen: number): bigint {
  // (1<<n)-1, but in BigInt.
  return (1n << BigInt(alphabetLen)) - 1n;
}

type TrieNode = {
  children: Map<number, TrieNode>;
  end: boolean;
};

function newTrieNode(): TrieNode {
  return { children: new Map<number, TrieNode>(), end: false };
}

function buildTrie(wordSet: Iterable<string>, letterToIndex: Map<string, number>): TrieNode {
  const root = newTrieNode();

  outer: for (const raw of wordSet) {
    const w = raw.trim().toUpperCase();
    if (!w) continue;
    // Words longer than 15 cannot be placed on the board; skipping reduces trie size.
    if (w.length > BOARD_SIZE) continue;

    let node = root;
    for (let i = 0; i < w.length; i += 1) {
      const idx = letterToIndex.get(w[i]);
      if (idx === undefined) continue outer;
      const next = node.children.get(idx) ?? newTrieNode();
      node.children.set(idx, next);
      node = next;
    }
    node.end = true;
  }

  return root;
}

type CrossMasks = {
  // Masks for placing a tile at [y][x] when primary direction is row/col.
  row: bigint[][];
  col: bigint[][];
};

function computeCrossMasks(
  board: GameState['board'],
  alphabet: string,
  letterToIndex: Map<string, number>,
  wordSet: Set<string>,
  minLength: number
): CrossMasks {
  const alphaLen = alphabet.length;
  const all = allLettersMask(alphaLen);

  const row: bigint[][] = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0n));
  const col: bigint[][] = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0n));

  const computeMaskAt = (x: number, y: number, primary: Orientation): bigint => {
    if (board[y][x].tile) return 0n;

    // primary=row => cross is vertical; primary=col => cross is horizontal.
    const dx = primary === 'row' ? 0 : 1;
    const dy = primary === 'row' ? 1 : 0;

    const up: string[] = [];
    let cx = x - dx;
    let cy = y - dy;
    while (inBounds(cx) && inBounds(cy) && board[cy][cx].tile) {
      up.push(board[cy][cx].tile!.letter);
      cx -= dx;
      cy -= dy;
    }
    up.reverse();

    const down: string[] = [];
    cx = x + dx;
    cy = y + dy;
    while (inBounds(cx) && inBounds(cy) && board[cy][cx].tile) {
      down.push(board[cy][cx].tile!.letter);
      cx += dx;
      cy += dy;
    }

    // No perpendicular neighbors => cross-word is length 1 and is not validated (same as collectFormedWords()).
    if (up.length === 0 && down.length === 0) return all;

    const prefix = up.join('');
    const suffix = down.join('');
    const totalLen = prefix.length + 1 + suffix.length;
    if (totalLen < minLength) return 0n;

    let mask = 0n;
    for (let i = 0; i < alphaLen; i += 1) {
      const letter = alphabet[i];
      const cross = `${prefix}${letter}${suffix}`;
      if (wordSet.has(cross)) mask |= bitForIndex(i);
    }
    return mask;
  };

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y][x].tile) continue;
      row[y][x] = computeMaskAt(x, y, 'row');
      col[y][x] = computeMaskAt(x, y, 'col');
    }
  }

  // Ensure masks are never referencing unknown letters: `letterToIndex` is used only to build trie/rack.
  // Cross masks are based on `alphabet` indices, so they are consistent by construction.
  void letterToIndex;
  return { row, col };
}

function rackCountsForPlayer(
  state: GameState,
  playerId: string,
  letterToIndex: Map<string, number>,
  alphabetLen: number
): { counts: Uint8Array; blanks: number } {
  const rack = state.racks[playerId] ?? [];
  const counts = new Uint8Array(alphabetLen);
  let blanks = 0;
  for (const t of rack) {
    if (t.blank) blanks += 1;
    if (t.blank) continue;
    const idx = letterToIndex.get(t.letter);
    if (idx === undefined) continue;
    counts[idx] += 1;
  }
  return { counts, blanks };
}

function fixedPrefixBeforeAnchor(
  board: GameState['board'],
  anchor: Anchor,
  orientation: Orientation,
  letterToIndex: Map<string, number>
): { startX: number; startY: number; letters: number[] } | null {
  const letters: number[] = [];
  if (orientation === 'row') {
    let x = anchor.x - 1;
    const y = anchor.y;
    while (inBounds(x) && board[y][x].tile) {
      const idx = letterToIndex.get(board[y][x].tile!.letter);
      if (idx === undefined) return null;
      letters.push(idx);
      x -= 1;
    }
    letters.reverse();
    return { startX: x + 1, startY: y, letters };
  }

  // col
  const x = anchor.x;
  let y = anchor.y - 1;
  while (inBounds(y) && board[y][x].tile) {
    const idx = letterToIndex.get(board[y][x].tile!.letter);
    if (idx === undefined) return null;
    letters.push(idx);
    y -= 1;
  }
  letters.reverse();
  return { startX: x, startY: y + 1, letters };
}

function traverseFixedPrefix(root: TrieNode, fixed: number[]): TrieNode | null {
  let node: TrieNode | null = root;
  for (const idx of fixed) {
    const next = node.children.get(idx);
    if (!next) return null;
    node = next;
  }
  return node;
}

function hasAnyMoveRow(
  state: GameState,
  playerId: string,
  anchors: Anchor[],
  boardIsEmpty: boolean,
  root: TrieNode,
  letterToIndex: Map<string, number>,
  crossMasksRow: bigint[][],
  alphabetLen: number,
  minLength: number
): boolean {
  const rack = state.racks[playerId] ?? [];
  if (rack.length === 0) return false;

  const { counts, blanks: initialBlanks } = rackCountsForPlayer(state, playerId, letterToIndex, alphabetLen);
  const board = state.board;

  const extendRight = (
    x: number,
    y: number,
    node: TrieNode,
    wordLen: number,
    blanks: number,
    usedRack: boolean,
    anchorX: number
  ): boolean => {
    if (x >= BOARD_SIZE) return usedRack && node.end && wordLen >= minLength;
    const cell = board[y][x].tile;
    if (cell) {
      const idx = letterToIndex.get(cell.letter);
      if (idx === undefined) return false;
      const next = node.children.get(idx);
      if (!next) return false;
      return extendRight(x + 1, y, next, wordLen + 1, blanks, usedRack, anchorX);
    }
    if (x !== anchorX && usedRack && node.end && wordLen >= minLength) return true;
    const mask = crossMasksRow[y][x];
    for (const [idx, next] of node.children) {
      if ((mask & bitForIndex(idx)) === 0n) continue;
      if (counts[idx] > 0) {
        counts[idx] -= 1;
        if (extendRight(x + 1, y, next, wordLen + 1, blanks, true, anchorX)) return true;
        counts[idx] += 1;
      } else if (blanks > 0) {
        if (extendRight(x + 1, y, next, wordLen + 1, blanks - 1, true, anchorX)) return true;
      }
    }
    return false;
  };

  const fillLeft = (
    x: number,
    endXExclusive: number,
    y: number,
    node: TrieNode,
    blanks: number,
    fixedAfter: number[],
    anchorX: number,
    lenSoFar: number
  ): boolean => {
    if (x === endXExclusive) {
      const afterFixed = traverseFixedPrefix(node, fixedAfter);
      if (!afterFixed) return false;
      return extendRight(anchorX, y, afterFixed, lenSoFar + fixedAfter.length, blanks, false, anchorX);
    }
    const mask = crossMasksRow[y][x];
    for (const [idx, next] of node.children) {
      if ((mask & bitForIndex(idx)) === 0n) continue;
      if (counts[idx] > 0) {
        counts[idx] -= 1;
        if (fillLeft(x + 1, endXExclusive, y, next, blanks, fixedAfter, anchorX, lenSoFar + 1)) return true;
        counts[idx] += 1;
      } else if (blanks > 0) {
        if (fillLeft(x + 1, endXExclusive, y, next, blanks - 1, fixedAfter, anchorX, lenSoFar + 1)) return true;
      }
    }
    return false;
  };

  for (const anchor of anchors) {
    const y = anchor.y;

    // Fixed run of existing tiles immediately to the left of the anchor must be part of the word.
    const fixed = fixedPrefixBeforeAnchor(board, anchor, 'row', letterToIndex);
    if (!fixed) continue;
    const fixedLetters = fixed.letters;
    const fixedStartX = fixed.startX;

    // Count how many empty squares are immediately before the fixed run (potential left extension).
    let leftLimit = 0;
    let x = fixedStartX - 1;
    while (inBounds(x) && board[y][x].tile === null) {
      leftLimit += 1;
      x -= 1;
    }

    // Choose the actual word start among those empty squares (or at fixedStartX).
    for (let usedLeft = 0; usedLeft <= leftLimit; usedLeft += 1) {
      const startX = fixedStartX - usedLeft;
      // If there is a tile immediately before startX, the word would extend further left;
      // that move will be found when scanning the leftmost newly placed tile as an anchor.
      if (inBounds(startX - 1) && board[y][startX - 1].tile) continue;

      // First move safety (empty board): must cover center.
      if (boardIsEmpty) {
        // With empty board, fixedStartX is 7 and fixedLetters is empty.
        // The word covers center iff startX <= 7 and it extends at least to 7.
        // Since anchor is at (7,7), startX <= 7 always; extension happens via extendRight.
      }

      // Reset per-start choice (counts are mutated in recursion).
      // We keep counts in a single array; recursion restores changes, so no full clone needed here.
      const blanks = initialBlanks;
      if (fillLeft(startX, fixedStartX, y, root, blanks, fixedLetters, anchor.x, 0)) return true;
    }
  }

  return false;
}

function hasAnyMoveCol(
  state: GameState,
  playerId: string,
  anchors: Anchor[],
  boardIsEmpty: boolean,
  root: TrieNode,
  letterToIndex: Map<string, number>,
  crossMasksCol: bigint[][],
  alphabetLen: number,
  minLength: number
): boolean {
  const rack = state.racks[playerId] ?? [];
  if (rack.length === 0) return false;

  const { counts, blanks: initialBlanks } = rackCountsForPlayer(state, playerId, letterToIndex, alphabetLen);
  const board = state.board;

  const extendDown = (
    x: number,
    y: number,
    node: TrieNode,
    wordLen: number,
    blanks: number,
    usedRack: boolean,
    anchorY: number
  ): boolean => {
    if (y >= BOARD_SIZE) return usedRack && node.end && wordLen >= minLength;
    const cell = board[y][x].tile;
    if (cell) {
      const idx = letterToIndex.get(cell.letter);
      if (idx === undefined) return false;
      const next = node.children.get(idx);
      if (!next) return false;
      return extendDown(x, y + 1, next, wordLen + 1, blanks, usedRack, anchorY);
    }
    if (y !== anchorY && usedRack && node.end && wordLen >= minLength) return true;
    const mask = crossMasksCol[y][x];
    for (const [idx, next] of node.children) {
      if ((mask & bitForIndex(idx)) === 0n) continue;
      if (counts[idx] > 0) {
        counts[idx] -= 1;
        if (extendDown(x, y + 1, next, wordLen + 1, blanks, true, anchorY)) return true;
        counts[idx] += 1;
      } else if (blanks > 0) {
        if (extendDown(x, y + 1, next, wordLen + 1, blanks - 1, true, anchorY)) return true;
      }
    }
    return false;
  };

  const fillUp = (
    y: number,
    endYExclusive: number,
    x: number,
    node: TrieNode,
    blanks: number,
    fixedAfter: number[],
    anchorY: number,
    lenSoFar: number
  ): boolean => {
    if (y === endYExclusive) {
      const afterFixed = traverseFixedPrefix(node, fixedAfter);
      if (!afterFixed) return false;
      return extendDown(x, anchorY, afterFixed, lenSoFar + fixedAfter.length, blanks, false, anchorY);
    }
    const mask = crossMasksCol[y][x];
    for (const [idx, next] of node.children) {
      if ((mask & bitForIndex(idx)) === 0n) continue;
      if (counts[idx] > 0) {
        counts[idx] -= 1;
        if (fillUp(y + 1, endYExclusive, x, next, blanks, fixedAfter, anchorY, lenSoFar + 1)) return true;
        counts[idx] += 1;
      } else if (blanks > 0) {
        if (fillUp(y + 1, endYExclusive, x, next, blanks - 1, fixedAfter, anchorY, lenSoFar + 1)) return true;
      }
    }
    return false;
  };

  for (const anchor of anchors) {
    const x = anchor.x;

    const fixed = fixedPrefixBeforeAnchor(board, anchor, 'col', letterToIndex);
    if (!fixed) continue;
    const fixedLetters = fixed.letters;
    const fixedStartY = fixed.startY;

    let upLimit = 0;
    let y = fixedStartY - 1;
    while (inBounds(y) && board[y][x].tile === null) {
      upLimit += 1;
      y -= 1;
    }

    for (let usedUp = 0; usedUp <= upLimit; usedUp += 1) {
      const startY = fixedStartY - usedUp;
      if (inBounds(startY - 1) && board[startY - 1][x].tile) continue;

      const blanks = initialBlanks;
      if (fillUp(startY, fixedStartY, x, root, blanks, fixedLetters, anchor.y, 0)) return true;
    }
  }

  return false;
}

function hasAnyValidMoveFast(
  state: GameState,
  playerId: string,
  anchors: Anchor[],
  boardIsEmpty: boolean,
  root: TrieNode,
  letterToIndex: Map<string, number>,
  crossMasks: CrossMasks,
  alphabetLen: number,
  minLength: number
): boolean {
  // Try both orientations; early exit on the first found move.
  if (hasAnyMoveRow(state, playerId, anchors, boardIsEmpty, root, letterToIndex, crossMasks.row, alphabetLen, minLength)) return true;
  if (hasAnyMoveCol(state, playerId, anchors, boardIsEmpty, root, letterToIndex, crossMasks.col, alphabetLen, minLength)) return true;
  return false;
}

type TrieCacheEntry = {
  root: TrieNode;
  alphabet: string;
  alphabetLen: number;
  letterToIndex: Map<string, number>;
  wordSetRef: Set<string>;
};

const trieCache: Partial<Record<string, TrieCacheEntry>> = {};

async function runScan(req: EndgameScanRequest): Promise<EndgameScanResponse> {
  try {
    setMinWordLength(req.minLength);

    const dictKey: DictionaryKey =
      req.language === 'ru' && req.russianVariant === 'strict' ? 'ru-strict' : req.language;

    const wordSet = await getDictionaryWordSet(dictKey);
    if (!wordSet) {
      return { type: 'ENDGAME_SCAN_RESPONSE', requestId: req.requestId, allStuck: false, reason: 'dictionary_unavailable' };
    }

    const cached = trieCache[dictKey];
    const alphabet = alphabetFor(dictKey);
    const letterToIndex = cached?.letterToIndex ?? buildLetterToIndex(alphabet);
    const alphabetLen = alphabet.length;

    let root: TrieNode;
    if (!cached || cached.wordSetRef !== wordSet) {
      root = buildTrie(wordSet, letterToIndex);
      trieCache[dictKey] = { root, alphabet, alphabetLen, letterToIndex, wordSetRef: wordSet };
    } else {
      root = cached.root;
    }

    const anchors = computeAnchors(req.state.board);
    const boardIsEmpty = !boardHasAnyTiles(req.state.board);
    const crossMasks = computeCrossMasks(req.state.board, alphabet, letterToIndex, wordSet, req.minLength);

    for (const playerId of req.state.players) {
      const hasAny = hasAnyValidMoveFast(
        req.state,
        playerId,
        anchors,
        boardIsEmpty,
        root,
        letterToIndex,
        crossMasks,
        alphabetLen,
        req.minLength
      );
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

// Allow importing this module in tests (Node) without a global `self`.
if (typeof self !== 'undefined' && typeof (self as unknown as Worker).addEventListener === 'function') {
  self.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as EndgameScanRequest;
    if (!data || data.type !== 'ENDGAME_SCAN_REQUEST') return;
    void runScan(data).then((res) => {
      (self as unknown as Worker).postMessage(res);
    });
  });
}

// Test-only hooks (kept tiny and pure; not used by runtime code).
export const __testing = {
  buildLetterToIndex,
  buildTrie,
  computeCrossMasks,
  hasAnyValidMoveFast
};
