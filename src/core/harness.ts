import { ScrabbleGame } from './game';
import { buildBag } from './tiles';
import type { Placement, Tile } from './types';
import { ensureDictionary, hasWord } from '../dictionary/dictionaryService';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const resultsEl = document.querySelector<HTMLDivElement>('#results')!;
const logEl = document.querySelector<HTMLPreElement>('#log')!;
const runBtn = document.querySelector<HTMLButtonElement>('#run-tests')!;

runBtn.addEventListener('click', () => {
  runTests();
});

async function runSuite() {
  appendLog('Loading real dictionary...');

  try {
    const dictStatus = await ensureDictionary('en');
    if (!dictStatus.available) {
      appendLog('❌ Dictionary not available - trying to download...');
      // Try to trigger download
      try {
        const downloadStatus = await import('../dictionary/dictionaryService').then(m => m.downloadDictionary('en'));
        if (downloadStatus.available) {
          appendLog(`✅ Dictionary downloaded (${downloadStatus.words} words)`);
        } else {
          throw new Error('Download failed');
        }
      } catch (downloadErr) {
        appendLog(`❌ Dictionary download failed: ${String(downloadErr)}`);
        appendLog('Falling back to test dictionary...');
        // Fallback to test dictionary
        const testWords = new Set(['A', 'AT', 'CAT', 'DOG', 'RUN', 'BAT', 'HAT', 'MAT', 'RAT', 'SAT']);
        return { dict: async (word: string) => testWords.has(word.toUpperCase()), isReal: false };
      }
    } else {
      appendLog(`✅ Dictionary ready (${dictStatus.words} words, source: ${dictStatus.source})`);
    }
    return { dict: (word: string) => hasWord(word, 'en'), isReal: true };
  } catch (err) {
    appendLog(`❌ Dictionary initialization failed: ${String(err)}`);
    appendLog('Falling back to test dictionary...');
    // Fallback to test dictionary
    const testWords = new Set(['A', 'AT', 'CAT', 'DOG', 'RUN', 'BAT', 'HAT', 'MAT', 'RAT', 'SAT']);
    return { dict: async (word: string) => testWords.has(word.toUpperCase()), isReal: false };
  }
}

async function runTests() {
  const dictResult = await runSuite();
  const { dict, isReal } = dictResult;

  const tests: Array<(dict: (word: string) => Promise<boolean>, isReal: boolean) => Promise<TestResult>> = [
    testRackUpdatesAfterMove,
    testRackStopsRefillWhenBagEmpty,
    testBagDistributionMatchesRules,
    testRejectsTilesNotInRack,
    testExchangeKeepsCounts,
    testWordValidation,
    testIntersectionValidatesAllWords,
    testBlankTileHandling,
    testPassOnEmptyBoardKeepsFirstMoveRules,
    testSoloModePlayerRotation
  ];

  appendLog('Running core checks...');
  const results: TestResult[] = [];
  for (const test of tests) {
    try {
      const res = await test(dict, isReal);
      results.push(res);
      appendLog(`${res.passed ? '✅' : '❌'} ${res.name}${res.details ? ` — ${res.details}` : ''}`);
    } catch (err) {
      const errorResult: TestResult = {
        name: 'Unknown test',
        passed: false,
        details: `Error: ${String(err)}`
      };
      results.push(errorResult);
      appendLog(`❌ ${errorResult.name} — ${errorResult.details}`);
    }
  }
  renderResults(results);
  renderResults(results);
}

function renderResults(results: TestResult[]) {
  resultsEl.innerHTML = results
    .map(
      (res) => `
        <div class="card">
          <h3 class="${res.passed ? 'pass' : 'fail'}">${res.passed ? 'Pass' : 'Fail'}</h3>
          <p>${res.name}</p>
          ${res.details ? `<p class="hint">${res.details}</p>` : ''}
        </div>
      `
    )
    .join('');
}

async function testRackUpdatesAfterMove(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);
  const rack: Tile[] = makeRack(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const bag: Tile[] = makeRack(['H', 'I', 'J', 'K']);

  state.racks.p1 = [...rack];
  state.racks.p2 = [];
  state.bag = [...bag];

  const placements: Placement[] = [{ x: 7, y: 7, tile: rack[0] }];
  const result = await game.placeMove('p1', placements, async () => true); // Allow any single letter for basic test
  const updated = game.getState();

  const rackIds = updated.racks.p1.map((t) => t.id);
  const placedRemoved = !rackIds.includes(rack[0].id);
  const rackFull = updated.racks.p1.length === 7;
  const boardHasTile = updated.board[7][7].tile?.id === rack[0].id;
  const bagShrankByOne = updated.bag.length === bag.length - 1;

  const passed = Boolean(result.success && placedRemoved && rackFull && boardHasTile && bagShrankByOne);
  return {
    name: 'Rack is updated and refilled after a move',
    passed,
    details: passed
      ? 'Placed tile leaves the rack, rack refills to 7, board keeps the tile.'
      : 'Rack or bag counts went wrong after placing a tile.'
  };
}

async function testRackStopsRefillWhenBagEmpty(
  _dict: (word: string) => Promise<boolean>,
  _isReal: boolean
): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);
  const rack: Tile[] = makeRack(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const bag: Tile[] = makeRack(['H', 'I']); // Only two tiles left to draw

  state.racks.p1 = [...rack];
  state.racks.p2 = [];
  state.bag = [...bag];

  const placements: Placement[] = [
    { x: 7, y: 7, tile: rack[0] },
    { x: 8, y: 7, tile: rack[1] },
    { x: 9, y: 7, tile: rack[2] }
  ];

  const result = await game.placeMove('p1', placements, async () => true);
  const updated = game.getState();

  const rackIds = new Set(updated.racks.p1.map((t) => t.id));
  const placedRemoved = placements.every((p) => !rackIds.has(p.tile.id));
  const drewFromBag = bag.every((tile) => rackIds.has(tile.id));
  const rackCountCorrect = updated.racks.p1.length === rack.length - placements.length + bag.length;
  const bagEmpty = updated.bag.length === 0;

  const passed = Boolean(result.success && placedRemoved && drewFromBag && rackCountCorrect && bagEmpty);
  return {
    name: 'Rack refills only with available bag tiles',
    passed,
    details: passed
      ? 'Placed tiles leave the rack, only remaining bag tiles are drawn, bag hits zero.'
      : 'Refill ignored bag limits or failed to draw remaining tiles.'
  };
}

async function testBagDistributionMatchesRules(
  _dict: (word: string) => Promise<boolean>,
  _isReal: boolean
): Promise<TestResult> {
  const bag = buildBag('en');
  const counts = countLetters(bag);

  const expected: Record<string, number> = {
    A: 9,
    B: 2,
    C: 2,
    D: 4,
    E: 12,
    F: 2,
    G: 3,
    H: 2,
    I: 9,
    J: 1,
    K: 1,
    L: 4,
    M: 2,
    N: 6,
    O: 8,
    P: 2,
    Q: 1,
    R: 6,
    S: 4,
    T: 6,
    U: 4,
    V: 2,
    W: 2,
    X: 1,
    Y: 2,
    Z: 1,
    ' ': 2
  };

  const totalExpected = Object.values(expected).reduce((sum, n) => sum + n, 0);
  const matchesSpec = Object.entries(expected).every(([letter, count]) => counts[letter] === count);
  const noExtraLetters = Object.keys(counts).every((letter) => expected[letter] !== undefined);
  const passed = matchesSpec && noExtraLetters && bag.length === totalExpected;

  return {
    name: 'Bag respects English Scrabble letter limits',
    passed,
    details: passed
      ? 'Bag contains 100 tiles with the exact per-letter counts.'
      : 'Bag counts deviate from official distribution.'
  };
}

async function testRejectsTilesNotInRack(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  const game = new ScrabbleGame();
  game.start('en', ['a', 'b']);

  const rogueTile: Tile = { id: crypto.randomUUID(), letter: 'Z', value: 10 };
  const result = await game.placeMove(
    'a',
    [
      {
        x: 7,
        y: 7,
        tile: rogueTile
      }
    ],
    async () => true // Allow any word for this test
  );

  const passed = !result.success && result.message === 'Tile not in rack';
  return {
    name: 'Move validation rejects tiles not owned by player',
    passed,
    details: passed ? 'Guard catches mismatched tile IDs.' : 'Unexpectedly accepted a rogue tile.'
  };
}

async function testExchangeKeepsCounts(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);
  const rack: Tile[] = makeRack(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const bag: Tile[] = makeRack(['H', 'I', 'J', 'K', 'L', 'M']);

  state.racks.p1 = [...rack];
  state.racks.p2 = [];
  state.bag = [...bag];

  const toSwap = [rack[0].id, rack[1].id, rack[2].id];
  const result = game.exchangeTiles('p1', toSwap);
  const updated = game.getState();

  const rackLengthStable = updated.racks.p1.length === rack.length;
  const bagSameSize = updated.bag.length === bag.length;
  const rackIds = new Set(updated.racks.p1.map((t) => t.id));
  const rackHasDuplicates = rackIds.size !== updated.racks.p1.length;

  const passed = Boolean(result.success && rackLengthStable && bagSameSize && !rackHasDuplicates);
  return {
    name: 'Exchange keeps rack size and bag size stable',
    passed,
    details: passed
      ? 'Rack stays the same length and bag does not leak tiles.'
      : 'Rack or bag counts broke during exchange.'
  };
}

async function testWordValidation(dict: (word: string) => Promise<boolean>, isReal: boolean): Promise<TestResult> {
  // Use different test words based on dictionary type
  const testWords = isReal
    ? { valid: ['CAT', 'DOG'], invalid: ['XZQ', 'QZX'] }  // Real dictionary words
    : { valid: ['AT'], invalid: ['XZ'] };                // Test dictionary words

  // Test valid word
  const game1 = new ScrabbleGame();
  const state1 = game1.start('en', ['p1', 'p2']);

  // Create tiles for the valid word
  const validTiles: Tile[] = [];
  const validPlacements: Placement[] = [];
  let x = 7;
  for (const letter of testWords.valid[0]) {
    const tile = { id: `${letter}${x}`, letter, value: 1 };
    validTiles.push(tile);
    validPlacements.push({ x, y: 7, tile });
    x++;
  }
  state1.racks.p1 = validTiles;
  state1.racks.p2 = [];

  const validResult = await game1.placeMove('p1', validPlacements, dict);

  // Test invalid word with separate game instance
  const game2 = new ScrabbleGame();
  const state2 = game2.start('en', ['p1', 'p2']);

  // Create tiles for the invalid word
  const invalidTiles: Tile[] = [];
  const invalidPlacements: Placement[] = [];
  x = 7;
  for (const letter of testWords.invalid[0]) {
    const tile = { id: `${letter}${x}`, letter, value: 1 };
    invalidTiles.push(tile);
    invalidPlacements.push({ x, y: 7, tile });
    x++;
  }
  state2.racks.p1 = invalidTiles;
  state2.racks.p2 = [];

  const invalidResult = await game2.placeMove('p1', invalidPlacements, dict);

  const passed = validResult.success && !invalidResult.success;
  return {
    name: `Word validation with ${isReal ? 'real' : 'test'} dictionary`,
    passed,
    details: passed
      ? `Dictionary parsing works correctly (${isReal ? 'real' : 'test'} dictionary).`
      : `Valid "${testWords.valid[0]}": ${validResult.success}, Invalid "${testWords.invalid[0]}": ${invalidResult.success}`
  };
}

async function testIntersectionValidatesAllWords(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  // Board setup:
  //   Horizontal: C _ T  (place A to form CAT)
  //   Vertical:   R _ N  (place A to form RAN)
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);

  const c: Tile = { id: 'c1', letter: 'C', value: 3 };
  const t: Tile = { id: 't1', letter: 'T', value: 1 };
  const r: Tile = { id: 'r1', letter: 'R', value: 1 };
  const n: Tile = { id: 'n1', letter: 'N', value: 1 };
  const a: Tile = { id: 'a1', letter: 'A', value: 1 };

  // Seed board with existing tiles (bypassing move rules; this is a harness test).
  state.board[7][6].tile = c; // (6,7)
  state.board[7][8].tile = t; // (8,7)
  state.board[6][7].tile = r; // (7,6)
  state.board[8][7].tile = n; // (7,8)

  state.racks.p1 = [a];
  state.racks.p2 = [];
  state.currentPlayer = 'p1';

  const allowed = new Set(['CAT', 'RAN']);
  const resultOk = await game.placeMove('p1', [{ x: 7, y: 7, tile: a }], async (w: string) => allowed.has(w.toUpperCase()));

  // Reset and try with a dictionary that rejects one of the formed words.
  const game2 = new ScrabbleGame();
  const state2 = game2.start('en', ['p1', 'p2']);
  state2.board[7][6].tile = c;
  state2.board[7][8].tile = t;
  state2.board[6][7].tile = r;
  state2.board[8][7].tile = n;
  state2.racks.p1 = [a];
  state2.racks.p2 = [];
  state2.currentPlayer = 'p1';

  const allowedOnlyCat = new Set(['CAT']);
  const resultBad = await game2.placeMove(
    'p1',
    [{ x: 7, y: 7, tile: a }],
    async (w: string) => allowedOnlyCat.has(w.toUpperCase())
  );

  const words = resultOk.words ?? [];
  const okHasBoth = resultOk.success && words.includes('CAT') && words.includes('RAN');
  const badRejected = !resultBad.success && (resultBad.message ?? '').includes('Invalid word');

  const passed = okHasBoth && badRejected;
  return {
    name: 'Validates all words formed at an intersection (both directions)',
    passed,
    details: passed
      ? 'Intersection placement validates both horizontal and vertical words.'
      : `ok=${resultOk.success ? 'success' : `fail(${resultOk.message})`}, words=${JSON.stringify(words)}, bad=${resultBad.success ? 'success' : `fail(${resultBad.message})`}`
  };
}

async function testBlankTileHandling(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);
  const blankTile: Tile = { id: 'blank1', letter: ' ', value: 0, blank: true };
  const regularTile: Tile = { id: 'reg1', letter: 'A', value: 1 };

  // Assign a letter to the blank tile (simulating UI interaction)
  const assignedBlank: Tile = { ...blankTile, letter: 'B', value: 0 };

  state.racks.p1 = [regularTile, assignedBlank];
  state.racks.p2 = [];

  const placements: Placement[] = [
    { x: 7, y: 7, tile: regularTile },
    { x: 8, y: 7, tile: assignedBlank }
  ];

  const result = await game.placeMove('p1', placements, async () => true); // Allow the word for blank tile test
  const updated = game.getState();

  const blankPlaced = updated.board[7][8]?.tile?.id === 'blank1';
  const blankHasLetter = updated.board[7][8]?.tile?.letter === 'B';
  const blankWorthZero = updated.board[7][8]?.tile?.value === 0;

  const passed = Boolean(result.success && blankPlaced && blankHasLetter && blankWorthZero);
  return {
    name: 'Blank tiles can be assigned letters and placed',
    passed,
    details: passed
      ? 'Blank tile assignment and placement works correctly.'
      : 'Blank tile handling failed.'
  };
}

async function testPassOnEmptyBoardKeepsFirstMoveRules(
  _dict: (word: string) => Promise<boolean>,
  _isReal: boolean
): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1', 'p2']);

  const p2Tile: Tile = { id: 'p2t1', letter: 'A', value: 1 };
  state.racks.p1 = [];
  state.racks.p2 = [p2Tile];

  const passResult = game.passTurn('p1');
  if (!passResult.success) {
    return { name: 'Pass on empty board keeps first-move rules', passed: false, details: 'Pass failed unexpectedly' };
  }

  // Still an empty board: next player should be allowed to make the first placement,
  // and it should only be required to cover center (not "connect to existing tiles").
  const ok = await game.placeMove('p2', [{ x: 7, y: 7, tile: p2Tile }], async () => true);
  const bad = await game.placeMove('p1', [{ x: 0, y: 0, tile: { id: 'p1t1', letter: 'A', value: 1 } }], async () => true);

  const passed =
    ok.success &&
    !bad.success &&
    bad.message === 'First move must cover center' &&
    game.getState().board[7][7].tile?.id === 'p2t1';

  return {
    name: 'Pass on empty board keeps first-move rules',
    passed,
    details: passed
      ? 'After a pass on an empty board, the next player can open at center (no connection required).'
      : `Unexpected results: ok=${ok.success ? 'success' : `fail(${ok.message})`}, bad=${bad.success ? 'success' : `fail(${bad.message})`}`
  };
}

async function testSoloModePlayerRotation(_dict: (word: string) => Promise<boolean>, _isReal: boolean): Promise<TestResult> {
  const game = new ScrabbleGame();
  const state = game.start('en', ['p1']);

  const rack = state.racks.p1;
  if (!rack || rack.length < 2) {
    return { name: 'Solo Mode Rotation', passed: false, details: 'Rack initialization failed' };
  }

  // Force first move with fake tiles to ensure we have enough
  // We can't easily rely on random rack having vowels/consonants for a real word, but we mock the dictionary.
  // We do need to ensure the rack has tiles.

  // Let's just use the first two tiles from the rack.
  const t1 = rack[0];
  const t2 = rack[1];

  const placements: Placement[] = [
    { x: 7, y: 7, tile: t1 },
    { x: 8, y: 7, tile: t2 }
  ];

  // Fake word check
  const result = await game.placeMove('p1', placements, async () => true);

  const updated = game.getState();
  const currentPlayer = updated.currentPlayer;

  const passed = result.success && currentPlayer === 'p1';

  return {
    name: 'Solo mode rotates back to single player',
    passed,
    details: passed ? 'Player remains p1 after move' : `Current player became ${currentPlayer}`
  };
}

function makeRack(letters: string[]): Tile[] {
  return letters.map((letter) => ({
    id: crypto.randomUUID(),
    letter,
    value: 1
  }));
}

function countLetters(tiles: Tile[]): Record<string, number> {
  return tiles.reduce<Record<string, number>>((acc, tile) => {
    acc[tile.letter] = (acc[tile.letter] ?? 0) + 1;
    return acc;
  }, {});
}

function appendLog(message: string) {
  const now = new Date().toLocaleTimeString();
  logEl.textContent = `[${now}] ${message}\n${logEl.textContent}`;
}
