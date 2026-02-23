import type { LogEntry, SnapshotListItem } from '../types';
import { computeChecksum } from '../utils/checksum';
const DB_NAME = 'scrabble-pwa';

const DB_VERSION = 3;
const DICT_STORE = 'dictionaries';
const SNAPSHOT_STORE = 'snapshots';
const OPERATION_LOG_STORE = 'operationLog';
const OPERATION_LOG_LIMIT = 1000;
const LAST_SESSION_KEY = 'last-session';
const SNAPSHOT_RETENTION = 5;
const SNAPSHOT_KEY_SEPARATOR = ':';
const SNAPSHOT_SCHEMA_VERSION = 3;
let dbConnection: IDBDatabase | null = null;
let openingDb: Promise<IDBDatabase> | null = null;

type PersistedLogEntry = LogEntry & { id: string };
type SnapshotRecord = {
  key: string;
  payload: unknown;
  savedAt: number;
  schemaVersion: number;
  checksum: string;
  sessionId?: string;
};

type LegacySnapshotRecord = {
  key: string;
  payload: unknown;
  savedAt: number;
  sessionId?: string;
};

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

function getSessionIdFromKey(key: string): string | undefined {
  const lastSeparator = key.lastIndexOf(SNAPSHOT_KEY_SEPARATOR);
  if (lastSeparator <= 0) {
    return undefined;
  }
  const timestampPart = key.slice(lastSeparator + 1);
  if (!timestampPart) {
    return undefined;
  }
  const timestamp = Number(timestampPart);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return key.slice(0, lastSeparator);
}

function createSnapshotRecord(key: string, payload: unknown): SnapshotRecord {
  const serializedPayload = JSON.stringify(payload);
  return {
    key,
    payload,
    savedAt: Date.now(),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    checksum: computeChecksum(serializedPayload),
    sessionId: getSessionIdFromKey(key)
  };
}

function isSnapshotRecord(value: unknown): value is SnapshotRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    'payload' in value &&
    'savedAt' in value &&
    'checksum' in value
  );
}

function isLegacySnapshotRecord(value: unknown): value is LegacySnapshotRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    'payload' in value &&
    'savedAt' in value
  );
}

function verifySnapshotRecord(record: SnapshotRecord): boolean {
  const expectedChecksum = computeChecksum(JSON.stringify(record.payload));
  return expectedChecksum === record.checksum;
}

function makeSessionSnapshotKey(sessionId: string, timestamp: number = Date.now()): string {
  return `${sessionId}${SNAPSHOT_KEY_SEPARATOR}${timestamp}`;
}

export async function saveSnapshot(key: string, data: unknown): Promise<void> {
  const db = await openDb();
  const record = createSnapshotRecord(key, data);
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).put(record, key);
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
      const stored = req.result;
      if (!stored) {
        resolve(null);
        return;
      }
      if (isSnapshotRecord(stored)) {
        if (typeof stored.schemaVersion === 'number' && stored.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
          console.warn(
            `[indexedDb] Snapshot schemaVersion mismatch for key ${key}: ` +
            `expected ${SNAPSHOT_SCHEMA_VERSION}, got ${stored.schemaVersion}`
          );
        }
        if (!verifySnapshotRecord(stored)) {
          console.warn(`[indexedDb] Corrupted snapshot detected for key ${key}; deleting.`);
          void deleteSnapshot(key);
          resolve(null);
          return;
        }
        resolve(stored.payload as T);
        return;
      }
      if (isLegacySnapshotRecord(stored)) {
        resolve(stored.payload as T);
        return;
      }
      if (typeof stored === 'string') {
        try {
          resolve(JSON.parse(stored) as T);
        } catch {
          resolve(null);
        }
        return;
      }
      resolve(stored as T);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSnapshot(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSnapshot(key: string): Promise<void> {
  return deleteSnapshot(key);
}

async function getSnapshotStoreRecords(): Promise<SnapshotRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const req = tx.objectStore(SNAPSHOT_STORE).getAll();
    req.onsuccess = () => {
      const raw = req.result as unknown[];
      const normalizedRecords = raw
        .map((value) => {
          if (isSnapshotRecord(value)) {
            return value;
          }
          if (isLegacySnapshotRecord(value)) {
            const migrated = createSnapshotRecord(value.key, value.payload);
            migrated.savedAt = value.savedAt;
            migrated.sessionId = value.sessionId;
            return migrated;
          }
          return null;
        })
        .filter((record): record is SnapshotRecord => record !== null);
      resolve(normalizedRecords);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listSnapshots(sessionId: string): Promise<SnapshotListItem[]> {
  const records = await getSnapshotStoreRecords();
  return records
    .filter((record) => record.sessionId === sessionId)
    .map(({ key, savedAt, checksum }) => ({ key, savedAt, checksum }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadMostRecentSnapshot<T>(): Promise<T | null> {
  const records = await getSnapshotStoreRecords();
  const candidates = records
    .filter((record) => typeof record.sessionId === 'string')
    .sort((a, b) => b.savedAt - a.savedAt);

  for (const candidate of candidates) {
    const loaded = await loadSnapshot<T>(candidate.key);
    if (loaded) {
      return loaded;
    }
  }

  return null;
}

async function pruneSessionSnapshots(sessionId: string): Promise<void> {
  const snapshots = await listSnapshots(sessionId);
  if (snapshots.length <= SNAPSHOT_RETENTION) {
    return;
  }
  const toDelete = snapshots.slice(SNAPSHOT_RETENTION);
  for (const snapshot of toDelete) {
    await deleteSnapshot(snapshot.key);
  }
}

export async function saveSessionSnapshot(sessionId: string, payload: unknown): Promise<string> {
  const lastSessionPayload =
    payload && typeof payload === 'object'
      ? {
        ...(payload as Record<string, unknown>),
        schemaVersion: SNAPSHOT_SCHEMA_VERSION
      }
      : payload;

  await saveSnapshot(LAST_SESSION_KEY, lastSessionPayload);
  const key = makeSessionSnapshotKey(sessionId);
  await saveSnapshot(key, payload);
  await pruneSessionSnapshots(sessionId);
  return key;
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
