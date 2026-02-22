const DB_NAME = 'scrabble-pwa';
import type { LogEntry } from '../types';

const DB_VERSION = 3;
const DICT_STORE = 'dictionaries';
const SNAPSHOT_STORE = 'snapshots';
const OPERATION_LOG_STORE = 'operationLog';
const OPERATION_LOG_LIMIT = 1000;
let dbConnection: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

type PersistedLogEntry = LogEntry & { id: string };

function makeLogId(sessionId: string, seq: number): string {
  return `${sessionId}:${seq}`;
}

export interface DictionaryEntry {
  word: string;           // Uppercase word
  pos?: string[];         // Parts of speech: noun, verb, adj, etc.
  plural?: string;        // Plural form (if applicable)
  base?: string;          // Base/infinitive form
  forms?: string[];       // Other valid forms
}

export type DictionaryData = DictionaryEntry[] | string; // Support both old (string) and new (structured) format

function resetConnection() {
  dbConnection = null;
  openingDb = null;
}

function setupConnection(db: IDBDatabase) {
  db.onversionchange = () => {
    db.close();
    resetConnection();
  };
}

function openDb(): Promise<IDBDatabase> {
  if (dbConnection) {
    return Promise.resolve(dbConnection);
  }
  if (openingDb) {
    return openingDb;
  }

  openingDb = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DICT_STORE)) {
        db.createObjectStore(DICT_STORE);
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE);
      }
      if (!db.objectStoreNames.contains(OPERATION_LOG_STORE)) {
        db.createObjectStore(OPERATION_LOG_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      dbConnection = request.result;
      setupConnection(dbConnection);
      openingDb = null;
      resolve(dbConnection);
    };
    request.onerror = () => {
      openingDb = null;
      reject(request.error);
    };
    request.onblocked = () => {
      openingDb = null;
      reject(request.error);
    };
  });

  return openingDb;
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
    tx.objectStore(SNAPSHOT_STORE).put(data, key);
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
        if (typeof req.result === 'string') {
          try {
            resolve(JSON.parse(req.result) as T);
          } catch {
            resolve(null);
          }
        } else {
          resolve(req.result as T);
        }
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

export async function appendLogEntry(entry: Omit<LogEntry, 'seq' | 'timestamp'>): Promise<LogEntry> {
  const db = await openDb();
  const sessionEntries = await getLogsForSession(db, entry.sessionId);
  const nextSeq = sessionEntries.length > 0 ? sessionEntries[sessionEntries.length - 1].seq + 1 : 0;

  const log: PersistedLogEntry = {
    ...entry,
    seq: nextSeq,
    timestamp: Date.now(),
    id: makeLogId(entry.sessionId, nextSeq)
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OPERATION_LOG_STORE, 'readwrite');
    const req = tx.objectStore(OPERATION_LOG_STORE).put(log);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  await trimLog(entry.sessionId);

  const { id: _, ...result } = log;
  return result;
}

export async function getLogSince(sessionId: string, seq: number): Promise<LogEntry[]> {
  const logs = await getLogsForSession(await openDb(), sessionId);
  return logs.filter((log) => log.seq > seq);
}

export async function trimLog(sessionId: string): Promise<void> {
  const db = await openDb();
  const logs = await getLogsForSession(db, sessionId);
  const dropCount = Math.max(0, logs.length - OPERATION_LOG_LIMIT);
  if (dropCount === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OPERATION_LOG_STORE, 'readwrite');
    const store = tx.objectStore(OPERATION_LOG_STORE);
    for (const log of logs.slice(0, dropCount)) {
      store.delete(makeLogId(sessionId, log.seq));
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLogsForSession(db: IDBDatabase, sessionId: string): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OPERATION_LOG_STORE, 'readonly');
    const req = tx.objectStore(OPERATION_LOG_STORE).getAll();
    req.onsuccess = () => {
      const result = (req.result as Array<PersistedLogEntry | LogEntry>).filter((entry) => entry.sessionId === sessionId);
      const logs = result
        .map((entry) => {
          if ('id' in entry) {
            const { id: _, ...rest } = entry as PersistedLogEntry;
            return rest;
          }
          return entry as LogEntry;
        })
        .sort((a, b) => a.seq - b.seq);
      resolve(logs);
    };
    req.onerror = () => reject(req.error);
  });
}
