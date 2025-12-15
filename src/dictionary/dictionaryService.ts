import type { Language } from '../core/types';
import { loadDictionary, saveDictionary, type DictionaryEntry, type DictionaryData } from '../storage/indexedDb';

type StatusSource = 'memory' | 'indexeddb' | 'fetched';

export interface DictionaryStatus {
  language: Language;
  available: boolean;
  source?: StatusSource;
  words?: number;
}

export interface WordInfo {
  word: string;
  pos?: string[];
  plural?: string;
  base?: string;
  forms?: string[];
}

// Cache for word sets (for fast lookup) and full entries (for metadata)
// Using string keys to support both Language ('en', 'ru') and variants ('ru-strict')
const memoryCache: Partial<Record<string, Set<string>>> = {};
const entryCache: Partial<Record<string, Map<string, DictionaryEntry>>> = {};

const BASE = import.meta.env.BASE_URL ?? '/';

// GitHub repository for dictionary assets
// Can be set via VITE_GITHUB_REPO environment variable during build
// Format: owner/repo-name (e.g., 'darknessest/scrabble-wpa')
// If not set, defaults to 'darknessest/scrabble-wpa'
// The workflow automatically uses the current repository
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || 'darknessest/scrabble-wpa';
const ASSETS_BRANCH = 'assets';
const DEFAULT_ASSETS_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${ASSETS_BRANCH}/dicts`;

const envDictBase = normalizeBaseUrl(import.meta.env.VITE_DICT_BASE);
const envStrictDictBase = normalizeBaseUrl(import.meta.env.VITE_DICT_STRICT_BASE);
const envMockDictBase = normalizeBaseUrl(import.meta.env.VITE_DICT_MOCK_BASE);
const useMockDicts = import.meta.env.VITE_USE_DICT_MOCKS === 'true';

// Allow overriding dictionary hosts for local dev (e.g., Vite dev server middleware)
const DICT_BASE = useMockDicts && envMockDictBase ? envMockDictBase : envDictBase ?? DEFAULT_ASSETS_BASE;
const STRICT_DICT_BASE =
  useMockDicts && envMockDictBase ? envMockDictBase : envStrictDictBase ?? DICT_BASE;

// Primary source: compressed dictionaries
const COMPRESSED_FILE_MAP: Record<Language, string> = {
  en: `${DICT_BASE}/en.json.gz`,
  ru: `${DICT_BASE}/ru.json.gz`
};

// Fallback: uncompressed dictionaries
const FILE_MAP: Record<Language, string> = {
  en: `${DICT_BASE}/en.json`,
  ru: `${DICT_BASE}/ru.json`
};

// Strict Russian dictionary (nominative+plural only for nouns, base forms for others)
const RU_STRICT_COMPRESSED = `${STRICT_DICT_BASE}/ru-strict.json.gz`;
const RU_STRICT_FILE = `${STRICT_DICT_BASE}/ru-strict.json`;

// Legacy fallback: local bundled files
const LEGACY_FILE_MAP: Record<Language, string> = {
  en: `${BASE}dicts/en-basic.txt`,
  ru: `${BASE}dicts/ru-basic.txt`
};

// Lightweight, permissive frequency lists (top 50k) from hermitdave/FrequencyWords (MIT).
// These are fetched on-demand and cached locally for offline validation.
const REMOTE_MAP: Record<Language, string> = {
  en: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
  ru: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt'
};

// Minimal word length (inclusive); users can adjust via UI.
const DEFAULT_MIN_LENGTH = 2;
let minLength = DEFAULT_MIN_LENGTH;

function normalizeBaseUrl(value?: string) {
  if (!value) return undefined;
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalize(word: string) {
  return word.trim().toUpperCase();
}

export function setMinWordLength(length: number) {
  minLength = Math.max(1, Math.floor(length));
}

export type DictionaryKey = Language | 'ru-strict';

async function ensureDictionaryByKey(key: DictionaryKey): Promise<DictionaryStatus> {
  if (key === 'ru-strict') return await ensureDictionaryStrict();
  return await ensureDictionary(key);
}

export async function ensureDictionary(language: Language): Promise<DictionaryStatus> {
  if (memoryCache[language]) {
    return { language, available: true, source: 'memory', words: memoryCache[language]!.size };
  }

  const stored = await loadDictionary(language);
  if (stored) {
    if (Array.isArray(stored)) {
      // New structured format
      const entries = stored as DictionaryEntry[];
      const wordSet = new Set<string>();
      const entryMap = new Map<string, DictionaryEntry>();

      for (const entry of entries) {
        const word = normalize(entry.word);
        wordSet.add(word);
        entryMap.set(word, entry);

        // Also add plural and base forms to the word set for lookup
        if (entry.plural) {
          wordSet.add(normalize(entry.plural));
        }
        if (entry.base) {
          wordSet.add(normalize(entry.base));
        }
        if (entry.forms) {
          entry.forms.forEach(form => wordSet.add(normalize(form)));
        }
      }

      memoryCache[language] = wordSet;
      entryCache[language] = entryMap;
    } else {
      // Legacy string format
      memoryCache[language] = toSet(stored as string);
    }
    return { language, available: true, source: 'indexeddb', words: memoryCache[language]!.size };
  }

  return { language, available: false };
}

/**
 * Decompress gzip data using browser's DecompressionStream API
 * Requires: Chrome 80+, Firefox 113+, Safari 16.4+, Edge 80+
 */
async function decompressGzip(compressedData: ArrayBuffer): Promise<string> {
  // Check if DecompressionStream is available
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream API not supported in this browser');
  }

  const stream = new DecompressionStream('gzip');
  const blob = new Blob([compressedData]);
  const decompressedStream = blob.stream().pipeThrough(stream);
  const decompressedArrayBuffer = await new Response(decompressedStream).arrayBuffer();
  return new TextDecoder().decode(decompressedArrayBuffer);
}

/**
 * Fetch and decompress dictionary from compressed source
 */
async function fetchCompressedDictionary(url: string): Promise<DictionaryEntry[] | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const compressedData = await response.arrayBuffer();
    const decompressed = await decompressGzip(compressedData);
    const json = JSON.parse(decompressed);

    if (Array.isArray(json)) {
      return json as DictionaryEntry[];
    }
  } catch (error) {
    console.warn(`Failed to fetch/decompress ${url}:`, error);
  }
  return null;
}

/**
 * Download strict Russian dictionary (nominative+plural only for nouns, base forms for others)
 */
export async function downloadDictionaryStrict(): Promise<DictionaryStatus> {
  // Try sources in order: compressed -> uncompressed
  let data: DictionaryData | null = null;
  data = await fetchCompressedDictionary(RU_STRICT_COMPRESSED);

  // Fall back to uncompressed JSON
  if (!data) {
    try {
      const jsonRes = await fetch(RU_STRICT_FILE);
      if (jsonRes.ok) {
        const json = await jsonRes.json();
        if (Array.isArray(json)) {
          data = json as DictionaryEntry[];
        }
      }
    } catch {
      // Continue to fallback
    }
  }

  if (!data) {
    return { language: 'ru', available: false };
  }

  // Process and cache
  if (Array.isArray(data)) {
    const entries = data as DictionaryEntry[];
    const wordSet = new Set<string>();
    const entryMap = new Map<string, DictionaryEntry>();

    for (const entry of entries) {
      const word = normalize(entry.word);
      wordSet.add(word);
      entryMap.set(word, entry);

      if (entry.plural) wordSet.add(normalize(entry.plural));
      if (entry.base) wordSet.add(normalize(entry.base));
      if (entry.forms) {
        entry.forms.forEach(form => wordSet.add(normalize(form)));
      }
    }

    memoryCache['ru-strict'] = wordSet;
    entryCache['ru-strict'] = entryMap;
  }

  await saveDictionary('ru-strict', data);
  return { language: 'ru', available: true, source: 'fetched', words: memoryCache['ru-strict']!.size };
}

export async function downloadDictionary(language: Language): Promise<DictionaryStatus> {
  // Try sources in order: compressed -> uncompressed -> legacy -> remote
  const compressedUrl = COMPRESSED_FILE_MAP[language];
  const jsonUrl = FILE_MAP[language];
  const legacyUrl = LEGACY_FILE_MAP[language];
  const remote = REMOTE_MAP[language];

  // Try compressed JSON first (smallest download)
  let data: DictionaryData | null = null;
  data = await fetchCompressedDictionary(compressedUrl);

  // Fall back to uncompressed JSON
  if (!data) {
    try {
      const jsonRes = await fetch(jsonUrl);
      if (jsonRes.ok) {
        const json = await jsonRes.json();
        if (Array.isArray(json)) {
          data = json as DictionaryEntry[];
        }
      }
    } catch {
      // Continue to fallback
    }
  }

  // Fall back to legacy text format
  if (!data) {
    const text = await fetchFirstAvailable([legacyUrl, remote]);
    if (text) {
      data = text;
    }
  }

  if (!data) {
    return { language, available: false };
  }

  // Process and cache
  if (Array.isArray(data)) {
    // New structured format
    const entries = data as DictionaryEntry[];
    const wordSet = new Set<string>();
    const entryMap = new Map<string, DictionaryEntry>();

    for (const entry of entries) {
      const word = normalize(entry.word);
      wordSet.add(word);
      entryMap.set(word, entry);

      if (entry.plural) wordSet.add(normalize(entry.plural));
      if (entry.base) wordSet.add(normalize(entry.base));
      if (entry.forms) {
        entry.forms.forEach(form => wordSet.add(normalize(form)));
      }
    }

    memoryCache[language] = wordSet;
    entryCache[language] = entryMap;
  } else {
    // Legacy format
    memoryCache[language] = toSet(data as string);
  }

  await saveDictionary(language, data);
  return { language, available: true, source: 'fetched', words: memoryCache[language]!.size };
}

export async function hasWord(word: string, language: Language): Promise<boolean> {
  const status = await ensureDictionary(language);
  const norm = normalize(word);
  if (norm.length < minLength) return false;

  if (!status.available) {
    // For Russian, check strict version as fallback
    if (language === 'ru') {
      const strictStatus = await ensureDictionaryStrict();
      if (strictStatus.available && memoryCache['ru-strict']) {
        return memoryCache['ru-strict'].has(norm);
      }
    }
    return false;
  }

  // Check primary dictionary
  if (memoryCache[language]?.has(norm)) {
    return true;
  }

  // For Russian, also check strict version as fallback
  if (language === 'ru' && memoryCache['ru-strict']?.has(norm)) {
    return true;
  }

  return false;
}

/**
 * Returns the in-memory normalized word set for a language (or null if unavailable).
 * Intended for advanced features (e.g. endgame "any valid move left" scans).
 *
 * Note: The returned Set is the internal cache. Treat it as read-only.
 */
export async function getDictionaryWordSet(language: DictionaryKey): Promise<Set<string> | null> {
  const status = await ensureDictionaryByKey(language);
  if (!status.available) return null;
  return memoryCache[language] ?? null;
}

/**
 * Get detailed information about a word (POS, plural forms, etc.)
 */
export async function getWordInfo(word: string, language: Language): Promise<WordInfo | null> {
  await ensureDictionary(language);
  const norm = normalize(word);

  if (!memoryCache[language]?.has(norm)) {
    return null;
  }

  const entryMap = entryCache[language];
  if (entryMap) {
    const entry = entryMap.get(norm);
    if (entry) {
      return {
        word: entry.word,
        pos: entry.pos,
        plural: entry.plural,
        base: entry.base,
        forms: entry.forms,
      };
    }
  }

  // Fallback: return basic info if structured data not available
  return { word: norm };
}

export function clearMemoryCache() {
  (['en', 'ru'] as Language[]).forEach((lang) => {
    delete memoryCache[lang];
    delete entryCache[lang];
  });
  // Also clear strict version
  delete memoryCache['ru-strict'];
  delete entryCache['ru-strict'];
}

/**
 * Check if strict Russian dictionary is available
 */
export async function ensureDictionaryStrict(): Promise<DictionaryStatus> {
  if (memoryCache['ru-strict']) {
    return { language: 'ru', available: true, source: 'memory', words: memoryCache['ru-strict']!.size };
  }

  const stored = await loadDictionary('ru-strict');
  if (stored) {
    if (Array.isArray(stored)) {
      const entries = stored as DictionaryEntry[];
      const wordSet = new Set<string>();
      const entryMap = new Map<string, DictionaryEntry>();

      for (const entry of entries) {
        const word = normalize(entry.word);
        wordSet.add(word);
        entryMap.set(word, entry);

        if (entry.plural) wordSet.add(normalize(entry.plural));
        if (entry.base) wordSet.add(normalize(entry.base));
        if (entry.forms) {
          entry.forms.forEach(form => wordSet.add(normalize(form)));
        }
      }

      memoryCache['ru-strict'] = wordSet;
      entryCache['ru-strict'] = entryMap;
    } else {
      memoryCache['ru-strict'] = toSet(stored as string);
    }
    return { language: 'ru', available: true, source: 'indexeddb', words: memoryCache['ru-strict']!.size };
  }

  return { language: 'ru', available: false };
}

function toSet(data: string) {
  const set = new Set<string>();
  data
    .split('\n')
    .map(extractWord)
    .filter(Boolean)
    .forEach((w) => set.add(w as string));
  return set;
}

async function fetchFirstAvailable(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text?.length) return text;
    } catch {
      // ignore and try next
    }
  }
  return null;
}

function extractWord(line: string): string | null {
  // frequency files look like: "word 12345"
  const raw = line.trim().split(/\s+/)[0];
  if (!raw) return null;
  // keep letters (Latin/Cyrillic); drop punctuation/numbers.
  const cleaned = raw.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  if (!cleaned) return null;
  return cleaned.toUpperCase();
}

