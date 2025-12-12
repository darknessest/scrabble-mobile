const DB_NAME = 'scrabble-pwa';
const DB_VERSION = 2; // Incremented to support new dictionary schema
const DICT_STORE = 'dictionaries';
const SNAPSHOT_STORE = 'snapshots';

export interface DictionaryEntry {
  word: string;           // Uppercase word
  pos?: string[];         // Parts of speech: noun, verb, adj, etc.
  plural?: string;        // Plural form (if applicable)
  base?: string;          // Base/infinitive form
  forms?: string[];       // Other valid forms
}

export type DictionaryData = DictionaryEntry[] | string; // Support both old (string) and new (structured) format

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DICT_STORE)) {
        db.createObjectStore(DICT_STORE);
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDictionary(language: string, data: DictionaryData) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DICT_STORE, 'readwrite');
    // Store as JSON string for structured data, or plain string for legacy format
    const value = typeof data === 'string' ? data : JSON.stringify(data);
    tx.objectStore(DICT_STORE).put(value, language);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDictionary(language: string): Promise<DictionaryData | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORE, 'readonly');
    const req = tx.objectStore(DICT_STORE).get(language);
    req.onsuccess = () => {
      const result = req.result;
      if (!result) {
        resolve(null);
        return;
      }
      // Try to parse as JSON (new format), fall back to string (legacy format)
      if (typeof result === 'string') {
        try {
          const parsed = JSON.parse(result);
          if (Array.isArray(parsed)) {
            resolve(parsed as DictionaryEntry[]);
          } else {
            resolve(result); // Legacy string format
          }
        } catch {
          resolve(result); // Legacy string format
        }
      } else {
        resolve(result);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(key: string, data: unknown) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).put(JSON.stringify(data), key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSnapshot<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const req = tx.objectStore(SNAPSHOT_STORE).get(key);
    req.onsuccess = () => {
      if (req.result) {
        resolve(JSON.parse(req.result as string) as T);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearSnapshot(key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

