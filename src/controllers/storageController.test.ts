import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock indexedDb before importing StorageController
vi.mock('../storage/indexedDb', () => ({
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  clearSnapshot: vi.fn()
}));

import { StorageController } from './storageController';
import { saveSnapshot, loadSnapshot, clearSnapshot } from '../storage/indexedDb';
import type { SnapshotPayload } from '../types';
import type { GameState } from '../core/types';

const mockedSave = vi.mocked(saveSnapshot);
const mockedLoad = vi.mocked(loadSnapshot);
const mockedClear = vi.mocked(clearSnapshot);

function makeBtn(): HTMLButtonElement {
  return { disabled: true } as unknown as HTMLButtonElement;
}
function makeP(): HTMLParagraphElement {
  return { textContent: '' } as unknown as HTMLParagraphElement;
}

function makeFakeState(): GameState {
  return {
    sessionId: 's1',
    language: 'en',
    board: [],
    racks: {},
    scores: { p1: 0 },
    bag: [],
    players: ['p1'],
    currentPlayer: 'p1',
    moveNumber: 1,
    consecutivePasses: 0,
    moveHistory: [],
    history: []
  } as unknown as GameState;
}

function makeFakeSnapshot(): SnapshotPayload {
  return {
    state: makeFakeState(),
    meta: {
      mode: 'solo',
      language: 'en',
      isHost: true,
      localPlayerId: 'p1',
      sessionId: 's1'
    },
    labels: { p1: 'Alice' }
  };
}

let resumeBtn: HTMLButtonElement;
let clearBtn: HTMLButtonElement;
let note: HTMLParagraphElement;
let ctrl: StorageController;

beforeEach(() => {
  vi.clearAllMocks();
  resumeBtn = makeBtn();
  clearBtn = makeBtn();
  note = makeP();
  ctrl = new StorageController(resumeBtn, clearBtn, note);
});

describe('persistSnapshot', () => {
  it('saves to indexedDb and enables buttons', async () => {
    mockedSave.mockResolvedValue(undefined);
    const state = makeFakeState();
    const meta = makeFakeSnapshot().meta;
    const labels = { p1: 'Alice' };

    await ctrl.persistSnapshot(state, meta, labels);

    expect(mockedSave).toHaveBeenCalledWith('last-session', {
      version: 1,
      state,
      meta,
      labels
    });
    expect(resumeBtn.disabled).toBe(false);
    expect(clearBtn.disabled).toBe(false);
    expect(note.textContent).toContain('Alice');
  });

  it('skips when state is null', async () => {
    await ctrl.persistSnapshot(null, makeFakeSnapshot().meta, {});
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('skips when meta is null', async () => {
    await ctrl.persistSnapshot(makeFakeState(), null, {});
    expect(mockedSave).not.toHaveBeenCalled();
  });
});

describe('checkSavedSnapshot', () => {
  it('loads snapshot and enables buttons', async () => {
    const snap = makeFakeSnapshot();
    mockedLoad.mockResolvedValue(snap);

    await ctrl.checkSavedSnapshot();

    expect(ctrl.getPendingSnapshot()).toBe(snap);
    expect(resumeBtn.disabled).toBe(false);
    expect(clearBtn.disabled).toBe(false);
    expect(note.textContent).toContain('solo');
  });

  it('returns null when nothing is saved', async () => {
    mockedLoad.mockResolvedValue(null);

    await ctrl.checkSavedSnapshot();

    expect(ctrl.getPendingSnapshot()).toBeNull();
  });
});

describe('clearSavedSnapshot', () => {
  it('clears indexedDb and disables buttons', async () => {
    mockedSave.mockResolvedValue(undefined);
    mockedClear.mockResolvedValue(undefined);

    // Persist first to have something
    await ctrl.persistSnapshot(makeFakeState(), makeFakeSnapshot().meta, { p1: 'Alice' });
    expect(ctrl.getPendingSnapshot()).not.toBeNull();

    await ctrl.clearSavedSnapshot();

    expect(mockedClear).toHaveBeenCalledWith('last-session');
    expect(ctrl.getPendingSnapshot()).toBeNull();
    expect(resumeBtn.disabled).toBe(true);
    expect(clearBtn.disabled).toBe(true);
    expect(note.textContent).toBe('');
  });
});

describe('getPendingSnapshot', () => {
  it('returns null initially', () => {
    expect(ctrl.getPendingSnapshot()).toBeNull();
  });

  it('returns snapshot after persist', async () => {
    mockedSave.mockResolvedValue(undefined);
    const state = makeFakeState();
    const meta = makeFakeSnapshot().meta;
    await ctrl.persistSnapshot(state, meta, { p1: 'Alice' });

    const snap = ctrl.getPendingSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.state).toBe(state);
    expect(snap!.meta).toBe(meta);
  });
});
