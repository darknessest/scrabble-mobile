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
  const path = FILE_MAP[language];
  const response = await fetch(path);
  if (!response.ok) {
    return { language, available: false };
  }
  const text = await response.text();
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

