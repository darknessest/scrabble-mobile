import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DictionaryData, DictionaryEntry } from '../storage/indexedDb';

// Mock indexedDb before importing dictionaryService
vi.mock('../storage/indexedDb', () => ({
  loadDictionary: vi.fn(),
  saveDictionary: vi.fn()
}));

// Import after mock setup
const indexedDbMock = await import('../storage/indexedDb');
const loadDictionary = vi.mocked(indexedDbMock.loadDictionary);
const saveDictionary = vi.mocked(indexedDbMock.saveDictionary);

// Need to dynamically import the module under test to get fresh state per test
let mod: typeof import('./dictionaryService');

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();

  // Re-mock after reset
  vi.mock('../storage/indexedDb', () => ({
    loadDictionary: vi.fn(),
    saveDictionary: vi.fn()
  }));

  // Fresh import
  mod = await import('./dictionaryService');
  mod.clearMemoryCache();
  loadDictionary.mockReset();
  saveDictionary.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleEntries: DictionaryEntry[] = [
  { word: 'CAT', pos: ['noun'], plural: 'CATS' },
  { word: 'DOG', pos: ['noun'], plural: 'DOGS' },
  { word: 'PLAY', pos: ['verb'], forms: ['PLAYS', 'PLAYED', 'PLAYING'] },
  { word: 'HI', pos: ['interjection'] }
];

describe('ensureDictionary', () => {
  it('returns available from indexeddb when stored as structured entries', async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    const status = await mod.ensureDictionary('en');
    expect(status.available).toBe(true);
    expect(status.source).toBe('indexeddb');
    expect(status.words).toBeGreaterThan(0);
  });

  it('returns available from memory on second call', async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    await mod.ensureDictionary('en');
    const status = await mod.ensureDictionary('en');
    expect(status.source).toBe('memory');
  });

  it('returns not available when no stored data', async () => {
    loadDictionary.mockResolvedValue(null);
    const status = await mod.ensureDictionary('en');
    expect(status.available).toBe(false);
  });

  it('handles legacy string format', async () => {
    loadDictionary.mockResolvedValue('APPLE\nBANANA\nCHERRY\n' as DictionaryData);
    const status = await mod.ensureDictionary('en');
    expect(status.available).toBe(true);
    expect(status.source).toBe('indexeddb');
  });
});

describe('hasWord', () => {
  beforeEach(async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    await mod.ensureDictionary('en');
  });

  it('finds a word that exists', async () => {
    expect(await mod.hasWord('CAT', 'en')).toBe(true);
  });

  it('is case-insensitive', async () => {
    expect(await mod.hasWord('cat', 'en')).toBe(true);
    expect(await mod.hasWord('Cat', 'en')).toBe(true);
  });

  it('finds plural forms from entries', async () => {
    expect(await mod.hasWord('CATS', 'en')).toBe(true);
    expect(await mod.hasWord('DOGS', 'en')).toBe(true);
  });

  it('finds verb forms from entries', async () => {
    expect(await mod.hasWord('PLAYS', 'en')).toBe(true);
    expect(await mod.hasWord('PLAYED', 'en')).toBe(true);
  });

  it('returns false for unknown words', async () => {
    expect(await mod.hasWord('XYZZY', 'en')).toBe(false);
  });
});

describe('min-length filtering', () => {
  beforeEach(async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    await mod.ensureDictionary('en');
  });

  it('hasWord returns true for short dictionary words (min-length check in game engine)', async () => {
    expect(await mod.hasWord('HI', 'en')).toBe(true);
  });

  it('accepts words in dictionary regardless of length', async () => {
    expect(await mod.hasWord('CAT', 'en')).toBe(true);
  });
});

describe('getDictionaryWordSet', () => {
  it('returns word set after loading', async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    const set = await mod.getDictionaryWordSet('en');
    expect(set).not.toBeNull();
    expect(set!.has('CAT')).toBe(true);
    expect(set!.has('CATS')).toBe(true);
  });

  it('returns null when dictionary unavailable', async () => {
    loadDictionary.mockResolvedValue(null);
    const set = await mod.getDictionaryWordSet('en');
    expect(set).toBeNull();
  });
});

describe('clearMemoryCache', () => {
  it('clears cached data', async () => {
    loadDictionary.mockResolvedValue(sampleEntries as DictionaryData);
    await mod.ensureDictionary('en');
    mod.clearMemoryCache();

    // After clear, next call should hit indexeddb again
    loadDictionary.mockResolvedValue(null);
    const status = await mod.ensureDictionary('en');
    expect(status.available).toBe(false);
  });
});
