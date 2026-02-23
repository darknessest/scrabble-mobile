// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { P2PCallbacks, P2PConnection } from '../network/p2p';
import type { GameState } from '../core/types';
import type { SessionMeta } from '../types';

// ─── Module mocks (must come before imports of the modules being mocked) ──────

vi.mock('../network/p2p', () => ({
  createHost: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('../network/qr', () => ({
  toQrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}));

vi.mock('../utils/appUtils', () => ({
  // Unwrap debounce so auto-build/apply tests fire synchronously
  debounce: (fn: (...args: unknown[]) => unknown) => fn,
  looksLikeEncodedSdp: vi.fn().mockReturnValue(true),
}));

import { createHost, createClient } from '../network/p2p';
import { looksLikeEncodedSdp } from '../utils/appUtils';
import { NetworkController } from './networkController';

const mockCreateHost = vi.mocked(createHost);
const mockCreateClient = vi.mocked(createClient);
const mockLooksLikeEncodedSdp = vi.mocked(looksLikeEncodedSdp);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockConnection(role: 'host' | 'client' = 'host'): P2PConnection {
  return {
    role,
    send: vi.fn(),
    close: vi.fn(),
    get dataChannelReady() { return true; },
  };
}

function makeLanguageSelect(value = 'en'): HTMLSelectElement {
  const sel = document.createElement('select');
  const opt = document.createElement('option');
  opt.value = value;
  sel.appendChild(opt);
  sel.value = value;
  return sel;
}

function makeFakeGameState(): GameState {
  return {
    sessionId: 'test', language: 'en', board: [], racks: {}, scores: {},
    bag: [], players: ['host', 'client'], currentPlayer: 'host',
    moveNumber: 1, history: [],
  } as unknown as GameState;
}

function makeFakeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    mode: 'host', language: 'en', isHost: true,
    localPlayerId: 'host', remotePlayerId: 'client', sessionId: 'test',
    ...overrides,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

let p2pStatus: HTMLSpanElement;
let offerText: HTMLTextAreaElement;
let offerQr: HTMLImageElement;
let answerText: HTMLTextAreaElement;
let hostOfferInput: HTMLTextAreaElement;
let clientAnswer: HTMLTextAreaElement;
let answerQr: HTMLImageElement;
let disconnectOverlay: HTMLDivElement;
let disconnectMessage: HTMLParagraphElement;
let appendLog: ReturnType<typeof vi.fn<(msg: string) => void>>;
let nc: NetworkController;

/** Callbacks captured from the last createHost / createClient call */
let capturedCallbacks: P2PCallbacks;
let mockConn: P2PConnection;
let mockApplyAnswer: ReturnType<typeof vi.fn<(answer: string) => Promise<void>>>;

beforeEach(() => {
  vi.clearAllMocks();

  p2pStatus = document.createElement('span');
  offerText = document.createElement('textarea');
  offerQr = document.createElement('img');
  answerText = document.createElement('textarea');
  hostOfferInput = document.createElement('textarea');
  clientAnswer = document.createElement('textarea');
  answerQr = document.createElement('img');
  disconnectOverlay = document.createElement('div');
  disconnectMessage = document.createElement('p');
  appendLog = vi.fn<(msg: string) => void>();

  nc = new NetworkController(
    p2pStatus, offerText, offerQr, answerText,
    hostOfferInput, clientAnswer, answerQr,
    disconnectOverlay, disconnectMessage, appendLog,
  );

  mockConn = makeMockConnection();
  mockApplyAnswer = vi.fn<(answer: string) => Promise<void>>().mockResolvedValue(undefined);

  mockCreateHost.mockImplementation(async (callbacks) => {
    capturedCallbacks = callbacks;
    return { connection: mockConn, offer: 'mock-offer-b64', applyAnswer: mockApplyAnswer };
  });
  mockCreateClient.mockImplementation(async (callbacks, _offer) => {
    capturedCallbacks = callbacks;
    return { connection: makeMockConnection('client'), answer: 'mock-answer-b64', applyAck: vi.fn() };
  });
});

/** Helper: puts nc into a "host with connection" state via buildHostOffer. */
async function setupHostWithConnection(): Promise<void> {
  nc.setMode('host');
  nc.setMeta(makeFakeMeta());
  nc.setCurrentState(makeFakeGameState());
  await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));
}

// ─── buildHostOffer ───────────────────────────────────────────────────────────

describe('NetworkController.buildHostOffer', () => {
  it('no-ops and logs when mode is not host', async () => {
    nc.setMode('solo');
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn());

    expect(mockCreateHost).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Host mode'));
  });

  it('no-ops and logs when meta.isHost is false', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta({ isHost: false }));
    nc.setCurrentState(makeFakeGameState());
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn());

    expect(mockCreateHost).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Host session'));
  });

  it('no-ops and logs when currentState is null', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    // currentState not set
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn());

    expect(mockCreateHost).not.toHaveBeenCalled();
  });

  it('calls createHost and populates offerText with the offer', async () => {
    await setupHostWithConnection();

    expect(mockCreateHost).toHaveBeenCalledOnce();
    expect(offerText.value).toBe('mock-offer-b64');
  });

  it('sets p2pStatus text and class to the waiting-for-answer state', async () => {
    await setupHostWithConnection();

    expect(p2pStatus.textContent).toBe('Offer ready');
    expect(p2pStatus.className).toBe('pill');
  });

  it('calls appendLog with offer-created message', async () => {
    await setupHostWithConnection();

    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Offer created'));
  });

  it('calls ensureLanguage with the selected language', async () => {
    const ensureLanguage = vi.fn().mockResolvedValue(undefined);
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());

    await nc.buildHostOffer(makeLanguageSelect('en'), ensureLanguage);

    expect(ensureLanguage).toHaveBeenCalledWith('en');
  });

  it('closes existing connection before creating a new one', async () => {
    await setupHostWithConnection();
    const firstConn = mockConn;

    // Second call — a new mock connection
    const secondConn = makeMockConnection();
    mockCreateHost.mockResolvedValueOnce({
      connection: secondConn, offer: 'offer2', applyAnswer: vi.fn(),
    });
    await setupHostWithConnection();

    expect(firstConn.close).toHaveBeenCalled();
  });
});

// ─── applyHostAnswer ──────────────────────────────────────────────────────────

describe('NetworkController.applyHostAnswer', () => {
  it('no-ops and logs when no offer has been created yet', async () => {
    await nc.applyHostAnswer();

    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('offer'));
    expect(mockApplyAnswer).not.toHaveBeenCalled();
  });

  it('no-ops and logs when answerText is empty', async () => {
    await setupHostWithConnection();
    answerText.value = '';

    await nc.applyHostAnswer();

    expect(mockApplyAnswer).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('answer'));
  });

  it('calls the stored applyAnswer function with the pasted answer text', async () => {
    await setupHostWithConnection();
    answerText.value = 'pasted-answer-b64';

    await nc.applyHostAnswer();

    expect(mockApplyAnswer).toHaveBeenCalledWith('pasted-answer-b64');
  });

  it('sets p2pStatus to Connecting… after applying answer', async () => {
    await setupHostWithConnection();
    answerText.value = 'pasted-answer-b64';

    await nc.applyHostAnswer();

    expect(p2pStatus.textContent).toBe('Connecting');
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Answer applied'));
  });
});

// ─── buildClientAnswer ────────────────────────────────────────────────────────

describe('NetworkController.buildClientAnswer', () => {
  it('no-ops and logs when hostOfferInput is empty', async () => {
    nc.setMode('client');
    hostOfferInput.value = '';

    await nc.buildClientAnswer();

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('offer'));
  });

  it('calls createClient with the pasted offer and populates clientAnswer', async () => {
    nc.setMode('client');
    hostOfferInput.value = 'host-offer-b64';

    await nc.buildClientAnswer();

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.any(Object),
      'host-offer-b64',
    );
    expect(clientAnswer.value).toBe('mock-answer-b64');
  });

  it('sets p2pStatus to the share-with-host state', async () => {
    nc.setMode('client');
    hostOfferInput.value = 'host-offer-b64';

    await nc.buildClientAnswer();

    expect(p2pStatus.textContent).toBe('Answer ready');
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Answer created'));
  });

  it('closes existing connection before creating a new one', async () => {
    nc.setMode('client');
    hostOfferInput.value = 'offer1';
    await nc.buildClientAnswer();
    const firstConn = vi.mocked(mockCreateClient).mock.results[0].value;

    // Second call
    hostOfferInput.value = 'offer2';
    await nc.buildClientAnswer();

    // The connection returned by the first call should have been closed
    expect((await firstConn).connection.close).toHaveBeenCalled();
  });
});

// ─── send ─────────────────────────────────────────────────────────────────────

describe('NetworkController.send', () => {
  it('delegates to connection.send()', async () => {
    await setupHostWithConnection();

    nc.send({ type: 'SYNC_STATE', state: {} as GameState, meta: makeFakeMeta(), labels: {} });

    expect(mockConn.send).toHaveBeenCalled();
  });

  it('adds sequence metadata and increments seq per peer', async () => {
    await setupHostWithConnection();

    nc.send({ type: 'ACTION_PASS', playerId: 'host' });
    nc.send({ type: 'ACTION_PASS', playerId: 'host' });

    const firstCall = vi.mocked(mockConn.send).mock.calls[0]?.[0] as { seq: number };
    const secondCall = vi.mocked(mockConn.send).mock.calls[1]?.[0] as { seq: number };

    expect(firstCall.seq).toBe(1);
    expect(secondCall.seq).toBe(2);
  });

  it('includes the latest acknowledged seq from peer in ack', async () => {
    await setupHostWithConnection();

    const sequence = nc['meta']?.messageSequence ?? { lastSentByPeer: {}, lastReceivedByPeer: {} };
    nc['meta']!.messageSequence = sequence;
    nc['meta']!.messageSequence.lastReceivedByPeer.client = 41;
    nc.send({ type: 'ACTION_PASS', playerId: 'host' });

    const payload = vi.mocked(mockConn.send).mock.calls[0]?.[0] as { ack: number };
    expect(payload.ack).toBe(41);
  });

    it('is a no-op when there is no connection', () => {
      // No setupHostWithConnection — connection is null
      expect(() => {
        nc.send({ type: 'REQUEST_SYNC' });
      }).not.toThrow();
    });

  it('requestSync sends a REQUEST_SYNC message', async () => {
    await setupHostWithConnection();

    nc.requestSync();

    await vi.waitFor(() => {
      expect(mockConn.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'REQUEST_SYNC' }));
    });
  });

  it('tracks outbound sequenced messages as pending and clears on ACK', async () => {
    await setupHostWithConnection();

    nc.send({ type: 'ACTION_PASS', playerId: 'host' });

    const tracked = nc['pendingOutgoingMessages'].get(1);
    expect(tracked).toBeDefined();

    nc.handleAck(1);
    expect(nc['pendingOutgoingMessages'].has(1)).toBe(false);
  });

  it('retries unacked messages with exponential backoff and gives up after max retries', async () => {
    vi.useFakeTimers();
    try {
      await setupHostWithConnection();
      vi.mocked(mockConn.send).mockClear();

      nc.send({ type: 'ACTION_PASS', playerId: 'host' });
      expect(mockConn.send).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(mockConn.send).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(2000);
      expect(mockConn.send).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(4000);
      expect(mockConn.send).toHaveBeenCalledTimes(4);

      vi.advanceTimersByTime(8000);
      expect(mockConn.send).toHaveBeenCalledTimes(5);

      vi.advanceTimersByTime(16000);
      expect(mockConn.send).toHaveBeenCalledTimes(6);

      vi.advanceTimersByTime(1);
      expect(mockConn.send).toHaveBeenCalledTimes(6);

      expect(appendLog).toHaveBeenCalledWith('Giving up on message seq=1 after 5 retries.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops retrying once ACK arrives', async () => {
    vi.useFakeTimers();
    try {
      await setupHostWithConnection();
      vi.mocked(mockConn.send).mockClear();

      nc.send({ type: 'ACTION_PASS', playerId: 'host' });
      expect(mockConn.send).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      nc.handleAck(1);
      vi.advanceTimersByTime(20_000);

      expect(mockConn.send).toHaveBeenCalledTimes(1);
      expect(nc['pendingOutgoingMessages'].has(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('buffers outgoing trackable messages while disconnected and flushes after reconnect', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    Object.defineProperty(mockConn, 'dataChannelReady', {
      configurable: true,
      get: () => false,
    });
    nc['isChannelConnected'] = false;

    nc.send({ type: 'ACTION_PASS', playerId: 'host' });
    expect(mockConn.send).not.toHaveBeenCalled();
    expect(nc['sendBuffer']).toHaveLength(1);

    Object.defineProperty(mockConn, 'dataChannelReady', {
      configurable: true,
      get: () => true,
    });
    nc['isChannelConnected'] = true;

    capturedCallbacks.onOpen!();

    expect(mockConn.send).toHaveBeenCalledTimes(1);
    expect(nc['sendBuffer']).toHaveLength(0);
  });
});

// ─── Connection open callback ─────────────────────────────────────────────────

describe('Connection open callback (onOpen)', () => {
  it('sets p2pStatus to "Connected" with pill-active class', async () => {
    await setupHostWithConnection();
    capturedCallbacks.onOpen!();

    expect(p2pStatus.textContent).toBe('Connected');
    expect(p2pStatus.className).toBe('pill active');
  });

  it('calls appendLog with "Data channel open."', async () => {
    await setupHostWithConnection();
    capturedCallbacks.onOpen!();

    expect(appendLog).toHaveBeenCalledWith('Data channel open.');
  });

  it('hides the disconnect overlay', async () => {
    await setupHostWithConnection();
    disconnectOverlay.style.display = ''; // simulate visible

    capturedCallbacks.onOpen!();

    expect(disconnectOverlay.style.display).toBe('none');
  });

  it('calls the registered onOpen callback', async () => {
    await setupHostWithConnection();
    const userOnOpen = vi.fn();
    nc.setOnOpen(userOnOpen);

    capturedCallbacks.onOpen!();

    expect(userOnOpen).toHaveBeenCalledTimes(1);
  });
});

// ─── Connection close / disconnect handling ───────────────────────────────────

describe('Connection close and disconnect handling', () => {
  it('sets p2pStatus to "Lost" with danger class', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    capturedCallbacks.onClose!();

    expect(p2pStatus.textContent).toBe('Lost');
    expect(p2pStatus.className).toBe('pill danger');
  });

  it('calls appendLog with connection-lost message', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    capturedCallbacks.onClose!();

    expect(appendLog).toHaveBeenCalledWith('P2P connection lost or failed.');
  });

  it('shows disconnect overlay when in host mode with active state', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    capturedCallbacks.onClose!();

    expect(disconnectOverlay.style.display).toBe('');
  });

  it('shows host-specific reconnect message in overlay', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    capturedCallbacks.onClose!();

    expect(disconnectMessage.textContent).toContain('Creating a new connection offer');
  });

  it('shows client-specific reconnect message in overlay', async () => {
    nc.setMode('client');
    nc.setMeta(makeFakeMeta({ mode: 'client', isHost: false, localPlayerId: 'client' }));
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    hostOfferInput.value = 'some-offer';
    await nc.buildClientAnswer();

    capturedCallbacks.onClose!();

    expect(disconnectMessage.textContent).toContain('scan');
  });

  it('calls the registered onClose callback', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    const userOnClose = vi.fn();
    nc.setOnClose(userOnClose);
    capturedCallbacks.onClose!();

    expect(userOnClose).toHaveBeenCalledTimes(1);
  });

  it('handleDisconnect is idempotent — does not fire twice', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    capturedCallbacks.onClose!();
    const logCallsAfterFirst = appendLog.mock.calls.length;

    capturedCallbacks.onClose!();
    expect(appendLog.mock.calls.length).toBe(logCallsAfterFirst); // no extra logs
  });

  it('does not show overlay when mode is solo even with active state', async () => {
    // Build a connection, then switch mode to solo before triggering close.
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));
    nc.setMode('solo'); // switch to solo AFTER connection is established

    // Start with overlay explicitly hidden so we can detect if code shows it.
    disconnectOverlay.style.display = 'none';

    capturedCallbacks.onClose!();

    // handleDisconnect skips showDisconnectOverlay when mode === 'solo'
    expect(disconnectOverlay.style.display).toBe('none');
  });
});

// ─── Error callback ───────────────────────────────────────────────────────────

describe('Error callback (onError)', () => {
  it('calls appendLog with the error description', async () => {
    await setupHostWithConnection();
    capturedCallbacks.onError!(new Error('test error'));

    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('P2P error'));
  });

  it('calls the registered onError callback', async () => {
    await setupHostWithConnection();
    const userOnError = vi.fn();
    nc.setOnError(userOnError);

    const err = new Error('boom');
    capturedCallbacks.onError!(err);

    expect(userOnError).toHaveBeenCalledWith(err);
  });
});

// ─── Connection state change callback ────────────────────────────────────────

describe('Connection state change callback (onConnectionStateChange)', () => {
  async function setupWithReconnectSpy() {
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));
    return nc;
  }

  it('"failed" state triggers handleDisconnect', async () => {
    await setupWithReconnectSpy();
    capturedCallbacks.onConnectionStateChange!('failed');
    expect(p2pStatus.textContent).toBe('Lost');
  });

  it('"disconnected" state triggers handleDisconnect', async () => {
    await setupWithReconnectSpy();
    capturedCallbacks.onConnectionStateChange!('disconnected');
    expect(p2pStatus.textContent).toBe('Lost');
  });

  it('"closed" state triggers handleDisconnect', async () => {
    await setupWithReconnectSpy();
    capturedCallbacks.onConnectionStateChange!('closed');
    expect(p2pStatus.textContent).toBe('Lost');
  });

  it('"connected" state does NOT trigger handleDisconnect', async () => {
    await setupWithReconnectSpy();
    capturedCallbacks.onConnectionStateChange!('connected');
    expect(p2pStatus.textContent).not.toBe('Lost');
  });

  it('calls the registered onConnectionStateChange callback', async () => {
    await setupWithReconnectSpy();
    const userCb = vi.fn();
    nc.setOnConnectionStateChange(userCb);

    capturedCallbacks.onConnectionStateChange!('connected');

    expect(userCb).toHaveBeenCalledWith('connected');
  });
});

// ─── Timer deadline preservation across disconnect/reconnect ──────────────────

describe('Timer deadline preservation', () => {
  it('captures remaining time when disconnect overlay shows with timer active', async () => {
    const futureDeadline = Date.now() + 30_000;
    nc.setMode('host');
    nc.setMeta(makeFakeMeta({ timerEnabled: true, turnDeadline: futureDeadline }));
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    // Disconnect — should capture remaining ≈ 30 s
    capturedCallbacks.onClose!();
    // Reconnect — should restore deadline to ~ now + remaining
    capturedCallbacks.onOpen!();

    const meta = nc['meta']!; // access private for assertion
    expect(meta.turnDeadline).toBeGreaterThan(Date.now());
    expect(meta.turnDeadline).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  it('does not restore timer deadline when timer is disabled', async () => {
    nc.setMode('host');
    nc.setMeta(makeFakeMeta({ timerEnabled: false, turnDeadline: Date.now() + 30_000 }));
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

    const originalDeadline = nc['meta']!.turnDeadline;
    capturedCallbacks.onClose!();
    capturedCallbacks.onOpen!();

    // With timerEnabled=false, deadline is not updated by hideDisconnectOverlay
    expect(nc['meta']!.turnDeadline).toBe(originalDeadline);
  });
});

// ─── triggerReconnect ─────────────────────────────────────────────────────────

describe('NetworkController.triggerReconnect', () => {
  it('is a no-op for solo mode', async () => {
    nc.setMode('solo');
    await nc.triggerReconnect();

    expect(appendLog).not.toHaveBeenCalled();
  });

  it('logs client-specific message and sets status to Disconnected in client mode', async () => {
    nc.setMode('client');
    nc.setMeta(makeFakeMeta({ mode: 'client', isHost: false, localPlayerId: 'client' }));
    hostOfferInput.value = 'some-offer';
    await nc.buildClientAnswer();

    // Reset the log to isolate triggerReconnect calls
    appendLog.mockClear();
    await nc.triggerReconnect();

    expect(p2pStatus.textContent).toBe('Disconnected');
    expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('re-scan'));
  });

  it('logs host-specific message in host mode', async () => {
    vi.useFakeTimers();
    try {
      nc.setMode('host');
      nc.setMeta(makeFakeMeta());
      nc.setCurrentState(makeFakeGameState());
      await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

      appendLog.mockClear();
      const reconnectPromise = nc.triggerReconnect();
      // The log fires synchronously before the 500ms await inside triggerReconnect
      expect(appendLog).toHaveBeenCalledWith(expect.stringContaining('Connection lost'));
      vi.runAllTimers(); // fast-forward past the 500ms delay
      await reconnectPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes existing connection before reconnecting', async () => {
    vi.useFakeTimers();
    try {
      nc.setMode('host');
      nc.setMeta(makeFakeMeta());
      nc.setCurrentState(makeFakeGameState());
      await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));
      const connBeforeReconnect = mockConn;

      // close() is called synchronously before the 500ms await
      const reconnectPromise = nc.triggerReconnect();
      expect(connBeforeReconnect.close).toHaveBeenCalled();
      vi.runAllTimers();
      await reconnectPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds a host offer automatically after disconnect delay', async () => {
    vi.useFakeTimers();
    try {
      nc.setMode('host');
      nc.setMeta(makeFakeMeta());
      nc.setCurrentState(makeFakeGameState());
      await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));

      const reconnectPromise = nc.triggerReconnect();
      vi.runAllTimers();
      await reconnectPromise;

      expect(mockCreateHost).toHaveBeenCalledTimes(2);
      expect(p2pStatus.textContent).toBe('Offer ready');
      expect(disconnectMessage.textContent).toContain('New offer ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to manual host reconnect guidance when no host setup context exists', async () => {
    vi.useFakeTimers();
    try {
      nc.setMode('host');
      const reconnectPromise = nc.triggerReconnect();
      vi.runAllTimers();
      await reconnectPromise;

      expect(appendLog).toHaveBeenCalledWith(
        expect.stringContaining('Could not recreate offer automatically')
      );
      expect(disconnectMessage.textContent).toContain('refresh');
      expect(mockCreateHost).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Auto-build client answer (setupAutoBuildClientAnswer) ────────────────────

describe('setupAutoBuildClientAnswer', () => {
  it('calls onBuild when a valid-looking offer is pasted into hostOfferInput', async () => {
    nc.setMode('client');
    const onBuild = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoBuildClientAnswer(onBuild);

    hostOfferInput.value = 'some-encoded-offer';
    hostOfferInput.dispatchEvent(new Event('input'));
    await Promise.resolve(); // flush micro-tasks

    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  it('does not call onBuild when mode is not client', async () => {
    nc.setMode('host');
    const onBuild = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoBuildClientAnswer(onBuild);

    hostOfferInput.value = 'some-encoded-offer';
    hostOfferInput.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(onBuild).not.toHaveBeenCalled();
  });

  it('does not call onBuild when offer does not look like encoded SDP', async () => {
    nc.setMode('client');
    mockLooksLikeEncodedSdp.mockReturnValueOnce(false);
    const onBuild = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoBuildClientAnswer(onBuild);

    hostOfferInput.value = 'not-an-offer';
    hostOfferInput.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(onBuild).not.toHaveBeenCalled();
  });

  it('does not call onBuild again for the same offer (dedup)', async () => {
    nc.setMode('client');
    const onBuild = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoBuildClientAnswer(onBuild);

    hostOfferInput.value = 'same-offer';
    hostOfferInput.dispatchEvent(new Event('input'));
    await Promise.resolve();

    hostOfferInput.dispatchEvent(new Event('input')); // same value again
    await Promise.resolve();

    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});

// ─── Auto-apply host answer (setupAutoApplyHostAnswer) ────────────────────────

describe('setupAutoApplyHostAnswer', () => {
  it('calls onApply when a valid-looking answer is pasted into answerText', async () => {
    await setupHostWithConnection(); // sets hostApplyAnswer
    const onApply = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoApplyHostAnswer(onApply);

    answerText.value = 'some-encoded-answer';
    answerText.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('does not call onApply when mode is not host', async () => {
    nc.setMode('client');
    const onApply = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoApplyHostAnswer(onApply);

    answerText.value = 'some-answer';
    answerText.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not call onApply before an offer has been created (no hostApplyAnswer)', async () => {
    nc.setMode('host');
    // No buildHostOffer — hostApplyAnswer is null
    const onApply = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoApplyHostAnswer(onApply);

    answerText.value = 'some-answer';
    answerText.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not call onApply again for the same answer (dedup)', async () => {
    await setupHostWithConnection();
    const onApply = vi.fn().mockResolvedValue(undefined);
    nc.setupAutoApplyHostAnswer(onApply);

    answerText.value = 'same-answer';
    answerText.dispatchEvent(new Event('input'));
    await Promise.resolve();

    answerText.dispatchEvent(new Event('input')); // same value
    await Promise.resolve();

    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

// ─── P2P status indicator state machine (game UX) ────────────────────────────

describe('P2P status indicator — full happy-path state machine', () => {
  it('reflects each stage of the host flow in order', async () => {
    // Stage 1: initial
    expect(p2pStatus.textContent).toBe('');

    // Stage 2: offer created
    nc.setMode('host');
    nc.setMeta(makeFakeMeta());
    nc.setCurrentState(makeFakeGameState());
    await nc.buildHostOffer(makeLanguageSelect(), vi.fn().mockResolvedValue(undefined));
    expect(p2pStatus.textContent).toBe('Offer ready');

    // Stage 3: answer applied → Connecting
    answerText.value = 'answer-token';
    await nc.applyHostAnswer();
    expect(p2pStatus.textContent).toBe('Connecting');

    // Stage 4: data channel opens → Connected
    capturedCallbacks.onOpen!();
    expect(p2pStatus.textContent).toBe('Connected');
    expect(p2pStatus.className).toBe('pill active');

    // Stage 5: connection drops → Connection lost
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    capturedCallbacks.onClose!();
    expect(p2pStatus.textContent).toBe('Lost');
    expect(p2pStatus.className).toBe('pill danger');
  });

  it('reflects each stage of the client flow in order', async () => {
    // Stage 1: initial
    expect(p2pStatus.textContent).toBe('');

    // Stage 2: answer created from pasted offer
    nc.setMode('client');
    hostOfferInput.value = 'host-offer';
    await nc.buildClientAnswer();
    expect(p2pStatus.textContent).toBe('Answer ready');

    // Stage 3: data channel opens → Connected
    capturedCallbacks.onOpen!();
    expect(p2pStatus.textContent).toBe('Connected');

    // Stage 4: connection drops in client mode → Connection lost
    nc.setMeta(makeFakeMeta({ mode: 'client', isHost: false, localPlayerId: 'client' }));
    nc.setCurrentState(makeFakeGameState());
    vi.spyOn(nc, 'triggerReconnect').mockResolvedValue(undefined);
    capturedCallbacks.onClose!();
    expect(p2pStatus.textContent).toBe('Lost');
  });
});

// ─── onLog callback ───────────────────────────────────────────────────────────

describe('onLog callback', () => {
  it('forwards P2P log messages to appendLog', async () => {
    await setupHostWithConnection();
    capturedCallbacks.onLog!('[host] iceGatheringState=complete');

    expect(appendLog).toHaveBeenCalledWith('[host] iceGatheringState=complete');
  });
});
