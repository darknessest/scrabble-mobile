import { ScrabbleGame } from './game';
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
    testRejectsTilesNotInRack,
    testExchangeKeepsCounts,
    testWordValidation,
    testBlankTileHandling
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

function makeRack(letters: string[]): Tile[] {
  return letters.map((letter) => ({
    id: crypto.randomUUID(),
    letter,
    value: 1
  }));
}

function appendLog(message: string) {
  const now = new Date().toLocaleTimeString();
  logEl.textContent = `[${now}] ${message}\n${logEl.textContent}`;
}
