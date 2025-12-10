import type { Language } from '../core/types';
import { loadDictionary, saveDictionary } from '../storage/indexedDb';

type StatusSource = 'memory' | 'indexeddb' | 'fetched';

export interface DictionaryStatus {
  language: Language;
  available: boolean;
  source?: StatusSource;
  words?: number;
}

const memoryCache: Partial<Record<Language, Set<string>>> = {};

const BASE = import.meta.env.BASE_URL ?? '/';
const FILE_MAP: Record<Language, string> = {
  en: `${BASE}dicts/en-basic.txt`,
  ru: `${BASE}dicts/ru-basic.txt`
};

// Lightweight, permissive frequency lists (top 50k) from hermitdave/FrequencyWords (MIT).
// These are fetched on-demand and cached locally for offline validation.
const REMOTE_MAP: Record<Language, string> = {
  en: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
  ru: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_50k.txt'
};

function normalize(word: string) {
  return word.trim().toUpperCase();
}

export async function ensureDictionary(language: Language): Promise<DictionaryStatus> {
  if (memoryCache[language]) {
    return { language, available: true, source: 'memory', words: memoryCache[language]!.size };
  }

  const stored = await loadDictionary(language);
  if (stored) {
    memoryCache[language] = toSet(stored);
    return { language, available: true, source: 'indexeddb', words: memoryCache[language]!.size };
  }

  return { language, available: false };
}

export async function downloadDictionary(language: Language): Promise<DictionaryStatus> {
  // Try remote first (larger, more complete), then fall back to bundled basic list.
  const remote = REMOTE_MAP[language];
  const local = FILE_MAP[language];

  const text = await fetchFirstAvailable([remote, local]);
  if (!text) {
    return { language, available: false };
  }

  memoryCache[language] = toSet(text);
  await saveDictionary(language, text);
  return { language, available: true, source: 'fetched', words: memoryCache[language]!.size };
}

export async function hasWord(word: string, language: Language): Promise<boolean> {
  const status = await ensureDictionary(language);
  if (!status.available || !memoryCache[language]) return false;
  return memoryCache[language]!.has(normalize(word));
}

export function clearMemoryCache() {
  (['en', 'ru'] as Language[]).forEach((lang) => delete memoryCache[lang]);
}

function toSet(data: string) {
  const set = new Set<string>();
  data
    .split('\n')
    .map(normalize)
    .filter(Boolean)
    .forEach((w) => set.add(w));
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

