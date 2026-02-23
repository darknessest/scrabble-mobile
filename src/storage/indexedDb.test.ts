import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeKey = string | number;

type FakeRequest<T = unknown> = {
  result: T;
  error: unknown;
  onsuccess: ((event: { target: FakeRequest<T> }) => void) | null;
  onerror: ((event: { target: FakeRequest<T> }) => void) | null;
};

type FakeStoreData = {
  keyPath: string | null;
  records: Map<FakeKey, unknown>;
};

type FakeDatabaseData = {
  name: string;
  version: number;
  stores: Map<string, FakeStoreData>;
};

class FakeObjectStore {
  private readonly store: FakeStoreData;
  private readonly transaction: FakeTransaction | null;

  constructor(store: FakeStoreData, transaction: FakeTransaction | null = null) {
    this.store = store;
    this.transaction = transaction;
  }

  private makeKey(value: Record<string, unknown>, keyOverride?: FakeKey): FakeKey {
    if (this.store.keyPath) {
      const keyValue = value[this.store.keyPath] as unknown;
      if (typeof keyValue === 'string' || typeof keyValue === 'number') {
        return keyValue;
      }
    }

    if (keyOverride === undefined) {
      throw new Error('No key provided');
    }

    return keyOverride;
  }

  put(value: unknown, key?: FakeKey): FakeRequest<FakeKey> {
    return createRequest(
      () => {
        const resolvedKey = this.makeKey(value as Record<string, unknown>, key);
        this.store.records.set(resolvedKey, structuredClone(value));
        return resolvedKey;
      },
      () => this.transaction?.complete()
    );
  }

  get(key: FakeKey): FakeRequest<unknown> {
    return createRequest(
      () => {
        const value = this.store.records.get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      () => this.transaction?.complete()
    );
  }

  delete(key: FakeKey): FakeRequest<void> {
    return createRequest(
      () => {
        this.store.records.delete(key);
      },
      () => this.transaction?.complete()
    );
  }

  getAll(): FakeRequest<unknown[]> {
    return createRequest(
      () => {
        return Array.from(this.store.records.values(), (value) => structuredClone(value));
      },
      () => this.transaction?.complete()
    );
  }
}

class FakeTransaction {
  private readonly database: FakeDatabaseData;
  private hasCompleted = false;
  private _oncomplete: ((event: { target: FakeTransaction }) => void) | null = null;
  private _onerror: ((event: { target: FakeTransaction }) => void) | null = null;

  constructor(database: FakeDatabaseData, onComplete?: () => void) {
    this.database = database;
    this._oncomplete = onComplete ? (() => onComplete()) : null;
  }

  get oncomplete(): ((event: { target: FakeTransaction }) => void) | null {
    return this._oncomplete;
  }

  set oncomplete(handler: ((event: { target: FakeTransaction }) => void) | null) {
    this._oncomplete = handler;
    if (this.hasCompleted && handler) {
      handler({ target: this });
    }
  }

  get onerror(): ((event: { target: FakeTransaction }) => void) | null {
    return this._onerror;
  }

  set onerror(handler: ((event: { target: FakeTransaction }) => void) | null) {
    this._onerror = handler;
  }

  complete(): void {
    this.hasCompleted = true;
    this._oncomplete?.({ target: this });
  }

  fail(): void {
    this._onerror?.({ target: this });
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.database.stores.get(name);
    if (!store) {
      throw new Error(`Store ${name} does not exist`);
    }

    return new FakeObjectStore(store, this);
  }
}

class FakeDatabase {
  private readonly data: FakeDatabaseData;

  constructor(data: FakeDatabaseData) {
    this.data = data;
    this.name = data.name;
    this.version = data.version;
  }

  name: string;
  version: number;

  objectStoreNames = {
    contains: (storeName: string) => this.data.stores.has(storeName)
  };

  onversionchange: (() => void) | null = null;

  close(): void {
    this.onversionchange?.();
  }

  createObjectStore(storeName: string, options?: IDBObjectStoreParameters): FakeObjectStore {
    const keyPath = typeof options?.keyPath === 'string' ? options.keyPath : null;
    const storeData: FakeStoreData = {
      keyPath,
      records: new Map()
    };
    this.data.stores.set(storeName, storeData);
    return new FakeObjectStore(storeData);
  }

  deleteObjectStore(storeName: string): void {
    this.data.stores.delete(storeName);
  }

  transaction(storeNames: string | readonly string[], _mode: IDBTransactionMode): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.data.stores.has(name)) {
        throw new Error(`Store ${name} does not exist`);
      }
    }

    const tx = new FakeTransaction(this.data, () => tx.oncomplete?.({ target: tx }));
    return tx;
  }
}

function createRequest<T>(executor: () => T, onSuccess?: () => void): FakeRequest<T> {
  const request: FakeRequest<T> = {
    result: undefined as unknown as T,
    error: null,
    onsuccess: null,
    onerror: null
  };

  queueMicrotask(() => {
    try {
      request.result = executor();
      request.onsuccess?.({ target: request });
      onSuccess?.();
    } catch (err) {
      request.error = err;
      request.onerror?.({ target: request });
    }
  });

  return request;
}

function createFakeIndexedDbRuntime() {
  const databases = new Map<string, FakeDatabaseData>();
  const initialVersion = 0;

  function getOrCreateDatabase(name: string): FakeDatabaseData {
    const existing = databases.get(name);
    if (existing) {
      return existing;
    }

    const created: FakeDatabaseData = {
      name,
      version: initialVersion,
      stores: new Map()
    };
    databases.set(name, created);
    return created;
  }

  function resetDatabase(name: string): void {
    const database = getOrCreateDatabase(name);
    database.version = initialVersion;
    database.stores.clear();
  }

  function createLegacyDatabase(name: string): void {
    const database = getOrCreateDatabase(name);
    database.version = 2;
    database.stores.clear();
    database.stores.set('dictionaries', { keyPath: null, records: new Map() });
    database.stores.set('snapshots', { keyPath: null, records: new Map() });
  }

  return {
    open: (name: string, version: number): IDBOpenDBRequest => {
      const databaseData = getOrCreateDatabase(name);
      const existingVersion = databaseData.version;
      const facade = new FakeDatabase(databaseData);

    const request = {
      result: null as unknown as IDBDatabase,
      error: null as unknown,
      onsuccess: null as null | ((event: { target: FakeRequest<IDBDatabase> }) => void),
      onerror: null as null | ((event: { target: FakeRequest<IDBDatabase> }) => void),
      onupgradeneeded: null as null | ((event: { target: FakeRequest<IDBDatabase> }) => void),
      onblocked: null as null | (() => void),
      onversionchange: null as null | (() => void)
    };

    queueMicrotask(() => {
      request.result = facade as unknown as IDBDatabase;
      if (existingVersion < version) {
        databaseData.version = version;
        (facade as unknown as { version: number }).version = version;
        request.onupgradeneeded?.({ target: request as unknown as FakeRequest<IDBDatabase> });
      }
      request.onsuccess?.({ target: request as unknown as FakeRequest<IDBDatabase> });
    });

      return request as unknown as IDBOpenDBRequest;
    },
    deleteDatabase: (name: string): IDBRequest<null> => {
      const request = {
        result: null as null,
        error: null as unknown,
        onsuccess: null as null | ((event: { target: FakeRequest<null> }) => void),
        onerror: null as null | ((event: { target: FakeRequest<null> }) => void)
      };

      queueMicrotask(() => {
        databases.delete(name);
        request.onsuccess?.({ target: request as unknown as FakeRequest<null> });
      });

      return request as unknown as IDBRequest<null>;
    },
    resetDatabase,
    createLegacyDatabase,
    getStoreData: (name: string, storeName: string) => getOrCreateDatabase(name).stores.get(storeName)
  };
}

let fakeIndexedDb = createFakeIndexedDbRuntime();

function installFakeIndexedDb(): void {
  fakeIndexedDb = createFakeIndexedDbRuntime();
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: fakeIndexedDb
  });
}

beforeEach(() => {
  vi.resetModules();
  installFakeIndexedDb();
  fakeIndexedDb.resetDatabase('scrabble-pwa');
});

async function loadStorageModule() {
  return import('./indexedDb');
}

describe('operationLog storage', () => {
  it('appends log entries and reads deltas by session', async () => {
    const storage = await loadStorageModule();

    await storage.appendLogEntry({
      sessionId: 'session-a',
      playerId: 'p1',
      type: 'MOVE',
      action: {
        placements: [{ x: 7, y: 7, tile: { id: 'tile-1', letter: 'A', value: 1 } }]
      }
    });
    await storage.appendLogEntry({
      sessionId: 'session-a',
      playerId: 'p2',
      type: 'PASS',
      action: {}
    });
    await storage.appendLogEntry({
      sessionId: 'session-b',
      playerId: 'p1',
      type: 'EXCHANGE',
      action: { tileIds: ['t-1', 't-2'] }
    });

    const sessionEntries = await storage.getLogSince('session-a', 0);
    expect(sessionEntries).toHaveLength(1);
    expect(sessionEntries[0].seq).toBe(1);
    expect(sessionEntries[0].type).toBe('PASS');
    expect(sessionEntries[0].playerId).toBe('p2');
    expect(sessionEntries[0].action).toEqual({});
  });

  it('keeps only the latest 1000 log entries per session', async () => {
    const storage = await loadStorageModule();

    for (let i = 0; i < 1005; i++) {
      await storage.appendLogEntry({
        sessionId: 'session-a',
        playerId: `p-${i % 2}`,
        type: i % 2 === 0 ? 'PASS' : 'MOVE',
        action: i % 2 === 0
          ? {}
          : { placements: [{ x: i, y: 0, tile: { id: `t${i}`, letter: 'A', value: 1 } }] }
      });
    }

    const all = await storage.getLogSince('session-a', -1);
    expect(all).toHaveLength(1000);
    expect(all[0].seq).toBe(5);
    expect(all[all.length - 1].seq).toBe(1004);
  });

  it('handles upgrade from a legacy database without operationLog', async () => {
    fakeIndexedDb.createLegacyDatabase('scrabble-pwa');
    const storage = await loadStorageModule();

    await storage.appendLogEntry({
      sessionId: 'session-legacy',
      playerId: 'p1',
      type: 'PASS',
      action: {}
    });

    const upgradeEntries = await storage.getLogSince('session-legacy', -1);
    expect(upgradeEntries).toHaveLength(1);
    expect(upgradeEntries[0].seq).toBe(0);
    expect(fakeIndexedDb.getStoreData('scrabble-pwa', 'operationLog')).toBeDefined();
  });
});

describe('snapshot storage', () => {
  it('stores session snapshots and lists them', async () => {
    const storage = await loadStorageModule();
    const payload = { foo: 'bar' };

    const key = await storage.saveSessionSnapshot('session-a', payload);
    const snapshots = await storage.listSnapshots('session-a');

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].key).toBe(key);
    expect(snapshots[0].savedAt).toBeGreaterThan(0);

    const stored = await storage.loadSnapshot<{ foo: string }>(key);
    expect(stored).toEqual(payload);
  });

  it('prunes older snapshots beyond the retention limit', async () => {
    const storage = await loadStorageModule();
    const nowSpy = vi.spyOn(Date, 'now');
    let counter = 0;
    nowSpy.mockImplementation(() => counter++);

    const recordedKeys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const key = await storage.saveSessionSnapshot('session-b', { iteration: i });
      recordedKeys.push(key);
    }

    nowSpy.mockRestore();

    const snapshots = await storage.listSnapshots('session-b');

    expect(snapshots).toHaveLength(5);
    expect(snapshots.map((item) => item.key)).toEqual(recordedKeys.slice(-5).reverse());
    expect(snapshots.every((item, index) =>
      index === snapshots.length - 1 ? true : item.savedAt >= snapshots[index + 1].savedAt
    )).toBe(true);
  });

  it('deletes snapshots by key', async () => {
    const storage = await loadStorageModule();
    const key = await storage.saveSessionSnapshot('session-c', { shouldDelete: true });

    await storage.deleteSnapshot(key);

    const snapshots = await storage.listSnapshots('session-c');
    expect(snapshots).toHaveLength(0);
    const loaded = await storage.loadSnapshot(key);
    expect(loaded).toBeNull();
  });

  it('stores schemaVersion and checksum with snapshots', async () => {
    const storage = await loadStorageModule();
    const key = await storage.saveSessionSnapshot('session-meta', { value: 1 });

    const store = fakeIndexedDb.getStoreData('scrabble-pwa', 'snapshots');
    const record = store?.records.get(key) as
      | { schemaVersion?: number; checksum?: string }
      | undefined;

    expect(record?.schemaVersion).toBe(3);
    expect(record?.checksum).toEqual(expect.any(String));
    expect(record?.checksum?.length).toBe(8);
  });

  it('returns null and deletes corrupted snapshots', async () => {
    const storage = await loadStorageModule();
    const key = await storage.saveSessionSnapshot('session-corrupt', { value: 'ok' });

    const store = fakeIndexedDb.getStoreData('scrabble-pwa', 'snapshots');
    const record = store?.records.get(key) as
      | { key: string; payload: unknown; savedAt: number; checksum: string; schemaVersion: number; sessionId?: string }
      | undefined;

    if (!record || !store) {
      throw new Error('snapshot record missing');
    }

    store.records.set(key, { ...record, checksum: 'deadbeef' });

    const loaded = await storage.loadSnapshot(key);
    expect(loaded).toBeNull();

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    const afterDelete = await storage.loadSnapshot(key);
    expect(afterDelete).toBeNull();
  });

  it('loads latest valid snapshot when last-session is unavailable', async () => {
    const storage = await loadStorageModule();
    const key = await storage.saveSessionSnapshot('session-fallback', { turn: 9 });
    await storage.deleteSnapshot('last-session');

    const loaded = await storage.loadMostRecentSnapshot<{ turn: number }>();

    expect(loaded).toEqual({ turn: 9 });
    const snapshots = await storage.listSnapshots('session-fallback');
    expect(snapshots[0]?.key).toBe(key);
  });
});
