import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHost, createClient } from './p2p';
import type { P2PCallbacks } from './p2p';

// Types for mocks
type EventListener = (evt: Event) => void;

class MockEventTarget {
  listeners: Record<string, EventListener[]> = {};

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: { type: string;[key: string]: unknown }) {
    const listeners = this.listeners[event.type] || [];
    // @ts-expect-error - Mock event handling
    listeners.forEach((l) => l(event));

    // Call on<event> handler if it exists
    const handlerName = `on${event.type}`;
    // @ts-expect-error - dynamic handler access
    if (typeof this[handlerName] === 'function') {
      // @ts-expect-error - dynamic handler access
      this[handlerName](event);
    }
  }
}

class MockRTCDataChannel extends MockEventTarget {
  label: string;
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';

  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: Event) => void) | null = null;

  constructor(label: string) {
    super();
    this.label = label;
  }

  send(_data: string) {
    // No-op for mock, unless we want to simulate loopback
  }

  close() {
    this.readyState = 'closed';
    this.dispatchEvent({ type: 'close' });
  }

  // Helper to simulate open
  simulateOpen() {
    this.readyState = 'open';
    this.dispatchEvent({ type: 'open' });
  }
}

class MockRTCPeerConnection extends MockEventTarget {
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'new';
  connectionState: 'new' | 'checking' | 'connected' | 'failed' | 'disconnected' | 'closed' = 'new';
  iceConnectionState: 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed' = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onicegatheringstatechange: ((ev: Event) => void) | null = null;
  onconnectionstatechange: ((ev: Event) => void) | null = null;
  oniceconnectionstatechange: ((ev: Event) => void) | null = null;
  ondatachannel: ((ev: { channel: MockRTCDataChannel }) => void) | null = null;
  onicecandidate: ((ev: Event) => void) | null = null;

  createdChannels: MockRTCDataChannel[] = [];

  constructor(_config: RTCConfiguration) {
    super();
  }

  createDataChannel(label: string, _options?: RTCDataChannelInit) {
    const channel = new MockRTCDataChannel(label);
    this.createdChannels.push(channel);
    return channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
    // Simulate ICE gathering completing shortly after setting local description
    setTimeout(() => {
      this.iceGatheringState = 'complete';
      this.dispatchEvent({ type: 'icegatheringstatechange' });
      // Also signal end of candidates
      if (this.onicecandidate) {
        this.onicecandidate({} as Event);
      }
    }, 10);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
  }

  close() {
    this.connectionState = 'closed';
    this.dispatchEvent({ type: 'connectionstatechange' });
    this.createdChannels.forEach(ch => ch.close());
  }

  // Helper for tests to simulate incoming data channel
  simulateDataChannel(channel: MockRTCDataChannel) {
    if (this.ondatachannel) {
      this.ondatachannel({ channel });
    }
  }
}

// Helper to access the last created PC
let createdPCs: MockRTCPeerConnection[] = [];

describe('P2P Network', () => {
  beforeEach(() => {
    createdPCs = [];
    // @ts-expect-error - Mocking global RTCPeerConnection
    global.RTCPeerConnection = class extends MockRTCPeerConnection {
      constructor(config: RTCConfiguration) {
        super(config);
        createdPCs.push(this);
      }
    };
    // @ts-expect-error - Mocking global RTCDataChannel
    global.RTCDataChannel = MockRTCDataChannel;

    // Ensure btoa/atob if missing (Node environment usually has them now, but to be safe)
    if (!global.btoa) {
      global.btoa = (str) => Buffer.from(str).toString('base64');
    }
    if (!global.atob) {
      global.atob = (str) => Buffer.from(str, 'base64').toString('utf8');
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Host creates an offer and initializes', async () => {
    const callbacks = {
      onMessage: vi.fn(),
      onLog: vi.fn(),
    };

    const host = await createHost(callbacks);

    expect(createdPCs.length).toBe(1);
    const pc = createdPCs[0];

    expect(pc.localDescription).toBeTruthy();
    expect(host.offer).toBeTruthy();
    // Offer should be base64 encoded JSON of the description
    const decoded = JSON.parse(atob(host.offer));
    expect(decoded.type).toBe('offer');
    expect(decoded.sdp).toBe('mock-offer-sdp');

    expect(pc.createdChannels.length).toBe(1);
    expect(pc.createdChannels[0].label).toBe('scrabble-data');
  });

  it('Client accepts offer and creates answer', async () => {
    const callbacks = { onMessage: vi.fn() };

    // Create a mock offer string
    const offerObj = { type: 'offer', sdp: 'mock-remote-sdp' };
    const offerStr = btoa(JSON.stringify(offerObj));

    const client = await createClient(callbacks, offerStr);

    expect(createdPCs.length).toBe(1);
    const pc = createdPCs[0];

    expect(pc.remoteDescription).toEqual(offerObj);
    expect(pc.localDescription).toBeTruthy();
    expect(client.answer).toBeTruthy();

    const decodedAnswer = JSON.parse(atob(client.answer));
    expect(decodedAnswer.type).toBe('answer');
  });

  it('Host applies answer', async () => {
    const callbacks = { onMessage: vi.fn() };
    const host = await createHost(callbacks);
    const pc = createdPCs[0];

    const answerObj = { type: 'answer', sdp: 'mock-remote-answer' };
    const answerStr = btoa(JSON.stringify(answerObj));

    await host.applyAnswer(answerStr);

    expect(pc.remoteDescription).toEqual(answerObj);
  });

  it('Detects disconnection via onConnectionStateChange', async () => {
    const callbacks = {
      onMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onLog: vi.fn()
    };

    await createHost(callbacks);
    const pc = createdPCs[0];

    // Simulate connection state change to 'failed'
    pc.connectionState = 'failed';
    pc.dispatchEvent({ type: 'connectionstatechange' });

    expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith('failed');

    // Simulate connection state change to 'disconnected'
    pc.connectionState = 'disconnected';
    pc.dispatchEvent({ type: 'connectionstatechange' });

    expect(callbacks.onConnectionStateChange).toHaveBeenCalledWith('disconnected');
  });

  it('Cleanly closes connection', async () => {
    const callbacks = { onMessage: vi.fn() };
    const host = await createHost(callbacks);
    const pc = createdPCs[0];
    const channel = pc.createdChannels[0];

    // Spy on close methods
    const pcCloseSpy = vi.spyOn(pc, 'close');
    const channelCloseSpy = vi.spyOn(channel, 'close');

    host.connection.close();

    expect(pcCloseSpy).toHaveBeenCalled();
    expect(channelCloseSpy).toHaveBeenCalled();
    expect(pc.connectionState).toBe('closed');
  });

  // ─── Data channel callbacks ───────────────────────────────────────────────

  describe('Data channel callbacks', () => {
    it('onOpen fires when channel opens', async () => {
      const onOpen = vi.fn();
      await createHost({ onMessage: vi.fn(), onOpen });
      const channel = createdPCs[0].createdChannels[0];

      channel.simulateOpen();

      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('onClose fires when channel closes', async () => {
      const onClose = vi.fn();
      await createHost({ onMessage: vi.fn(), onClose });
      const channel = createdPCs[0].createdChannels[0];

      channel.simulateOpen();
      channel.close();

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('onError fires when channel emits an error event', async () => {
      const onError = vi.fn();
      await createHost({ onMessage: vi.fn(), onError });
      const channel = createdPCs[0].createdChannels[0];

      channel.dispatchEvent({ type: 'error', detail: 'boom' });

      expect(onError).toHaveBeenCalled();
    });

    it('onMessage fires with parsed JSON when data arrives', async () => {
      const onMessage = vi.fn();
      await createHost({ onMessage });
      const channel = createdPCs[0].createdChannels[0];

      const payload = { type: 'SYNC_STATE', move: 5 };
      channel.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);

      expect(onMessage).toHaveBeenCalledWith(payload);
    });

    it('onError fires when incoming message contains invalid JSON', async () => {
      const onError = vi.fn();
      await createHost({ onMessage: vi.fn(), onError });
      const channel = createdPCs[0].createdChannels[0];

      channel.onmessage?.({ data: '{not valid json' } as MessageEvent);

      expect(onError).toHaveBeenCalled();
    });
  });

  // ─── send() behaviour ─────────────────────────────────────────────────────

  describe('send() behavior', () => {
    it('sends JSON-stringified data when channel is open', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      const channel = createdPCs[0].createdChannels[0];
      channel.simulateOpen();

      const sendSpy = vi.spyOn(channel, 'send');
      host.connection.send({ type: 'ACTION_PASS', playerId: 'client' });

      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ACTION_PASS', playerId: 'client' })
      );
    });

    it('silently drops message when channel is still connecting', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      const channel = createdPCs[0].createdChannels[0];
      // channel.readyState is 'connecting' — not open yet
      const sendSpy = vi.spyOn(channel, 'send');

      host.connection.send({ hello: 'world' });

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('silently drops message after channel closes', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      const channel = createdPCs[0].createdChannels[0];
      channel.simulateOpen();
      channel.close();

      const sendSpy = vi.spyOn(channel, 'send');
      host.connection.send({ hello: 'world' });

      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  // ─── dataChannelReady getter ──────────────────────────────────────────────

  describe('dataChannelReady getter', () => {
    it('is false when channel is connecting', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      expect(host.connection.dataChannelReady).toBe(false);
    });

    it('is true when channel is open', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      createdPCs[0].createdChannels[0].simulateOpen();
      expect(host.connection.dataChannelReady).toBe(true);
    });

    it('is false after channel is closed', async () => {
      const host = await createHost({ onMessage: vi.fn() });
      const channel = createdPCs[0].createdChannels[0];
      channel.simulateOpen();
      channel.close();
      expect(host.connection.dataChannelReady).toBe(false);
    });
  });

  // ─── Client ondatachannel wiring ──────────────────────────────────────────

  describe('Client ondatachannel wiring', () => {
    async function makeClientWithIncomingChannel() {
      const offerStr = btoa(JSON.stringify({ type: 'offer', sdp: 'mock-sdp' }));
      const onMessage = vi.fn();
      const client = await createClient({ onMessage }, offerStr);
      const clientPc = createdPCs[0];
      const incoming = new MockRTCDataChannel('scrabble-data');
      return { client, clientPc, incoming, onMessage };
    }

    it('wires onMessage callback via ondatachannel event', async () => {
      const { clientPc, incoming, onMessage } = await makeClientWithIncomingChannel();
      clientPc.simulateDataChannel(incoming);

      const payload = { type: 'HELLO' };
      incoming.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);

      expect(onMessage).toHaveBeenCalledWith(payload);
    });

    it('dataChannelReady becomes true when incoming channel opens', async () => {
      const { client, clientPc, incoming } = await makeClientWithIncomingChannel();
      expect(client.connection.dataChannelReady).toBe(false);

      clientPc.simulateDataChannel(incoming);
      incoming.simulateOpen();

      expect(client.connection.dataChannelReady).toBe(true);
    });

    it('send() delivers via the incoming data channel when open', async () => {
      const { client, clientPc, incoming } = await makeClientWithIncomingChannel();
      clientPc.simulateDataChannel(incoming);
      incoming.simulateOpen();

      const sendSpy = vi.spyOn(incoming, 'send');
      client.connection.send({ type: 'REQUEST_SYNC' });

      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'REQUEST_SYNC' }));
    });
  });

  // ─── SDP encode/decode error handling ────────────────────────────────────

  describe('SDP encode/decode error handling', () => {
    it('throws a descriptive error when offer is not valid base64', async () => {
      await expect(
        createClient({ onMessage: vi.fn() }, '!!!not-base64!!!')
      ).rejects.toThrow('Invalid connection data');
    });

    it('throws a descriptive error when base64 decodes to non-JSON', async () => {
      const notJson = btoa('this is definitely not JSON');
      await expect(
        createClient({ onMessage: vi.fn() }, notJson)
      ).rejects.toThrow('Invalid connection data');
    });
  });

  // ─── Logging callbacks ────────────────────────────────────────────────────

  describe('Logging callbacks', () => {
    it('onLog fires with [host] prefix for host-side events', async () => {
      const onLog = vi.fn();
      await createHost({ onMessage: vi.fn(), onLog });
      const pc = createdPCs[0];

      pc.iceGatheringState = 'gathering';
      pc.dispatchEvent({ type: 'icegatheringstatechange' });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('[host]'));
    });

    it('onLog fires with [client] prefix for client-side events', async () => {
      const onLog = vi.fn();
      const offerStr = btoa(JSON.stringify({ type: 'offer', sdp: 'sdp' }));
      await createClient({ onMessage: vi.fn(), onLog }, offerStr);
      const pc = createdPCs[0];

      pc.iceGatheringState = 'gathering';
      pc.dispatchEvent({ type: 'icegatheringstatechange' });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('[client]'));
    });

    it('onLog is called when ICE gathering completes (null candidate event)', async () => {
      const onLog = vi.fn();
      // createHost triggers ICE gathering — the log fires during the await
      await createHost({ onMessage: vi.fn(), onLog });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('ICE gathering complete'));
    });

    it('onLog reports connectionState changes', async () => {
      const onLog = vi.fn();
      await createHost({ onMessage: vi.fn(), onLog });
      const pc = createdPCs[0];

      pc.connectionState = 'connected';
      pc.dispatchEvent({ type: 'connectionstatechange' });

      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('connectionState=connected'));
    });
  });

  // ─── waitForIce — already-complete path ──────────────────────────────────

  describe('waitForIce — already-complete path', () => {
    it('resolves immediately without waiting for events when already complete', async () => {
      // Override so iceGatheringState is complete before setLocalDescription returns
      // and no icegatheringstatechange event is ever fired.
      global.RTCPeerConnection = class extends MockRTCPeerConnection {
        constructor(config: RTCConfiguration) {
          super(config);
          this.iceGatheringState = 'complete';
          createdPCs.push(this);
        }
        async setLocalDescription(desc: RTCSessionDescriptionInit) {
          this.localDescription = desc;
          // ICE already complete — no event fired; waitForIce must return via
          // the synchronous check at the top of the function.
        }
      } as unknown as typeof RTCPeerConnection;

      // If waitForIce failed to handle the already-complete case it would hang forever.
      const host = await createHost({ onMessage: vi.fn() });

      expect(host.offer).toBeTruthy();
      expect(createdPCs[0].localDescription).not.toBeNull();
    });
  });

  describe('waitForIce timeout', () => {
    it('rejects host offer creation when ICE gathering stalls', async () => {
      vi.useFakeTimers();
      try {
        global.RTCPeerConnection = class extends MockRTCPeerConnection {
          constructor(config: RTCConfiguration) {
            super(config);
            this.iceGatheringState = 'gathering';
            createdPCs.push(this);
          }
          async setLocalDescription(desc: RTCSessionDescriptionInit) {
            this.localDescription = desc;
            // Intentionally never reaches "complete" and never emits event.
          }
        } as unknown as typeof RTCPeerConnection;

        const hostPromise = createHost({ onMessage: vi.fn() });
        const rejection = expect(hostPromise).rejects.toThrow('ICE gathering timed out');
        await vi.advanceTimersByTimeAsync(15_100);
        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects client answer creation when ICE gathering stalls', async () => {
      vi.useFakeTimers();
      try {
        global.RTCPeerConnection = class extends MockRTCPeerConnection {
          constructor(config: RTCConfiguration) {
            super(config);
            this.iceGatheringState = 'gathering';
            createdPCs.push(this);
          }
          async setLocalDescription(desc: RTCSessionDescriptionInit) {
            this.localDescription = desc;
            // Intentionally never reaches "complete" and never emits event.
          }
        } as unknown as typeof RTCPeerConnection;

        const offer = btoa(JSON.stringify({ type: 'offer', sdp: 'mock-sdp' }));
        const clientPromise = createClient({ onMessage: vi.fn() }, offer);
        const rejection = expect(clientPromise).rejects.toThrow('ICE gathering timed out');
        await vi.advanceTimersByTimeAsync(15_100);
        await rejection;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Two-peer loopback simulation ─────────────────────────────────────────

  describe('Two-peer loopback simulation', () => {
    /**
     * Performs the full negotiation handshake and then wires a synthetic
     * in-memory "link" between the host's data channel and a paired
     * client data channel, so that send() on one delivers to onmessage on
     * the other — exactly like a real RTCDataChannel pair.
     */
    async function createLoopbackPair(
      hostCbs: Partial<P2PCallbacks> = {},
      clientCbs: Partial<P2PCallbacks> = {}
    ) {
      const hostMessages: unknown[] = [];
      const clientMessages: unknown[] = [];
      const hostOnOpen = vi.fn();
      const clientOnOpen = vi.fn();

      const hostCallbacks: P2PCallbacks = {
        onMessage: (d) => hostMessages.push(d),
        onOpen: hostOnOpen,
        onLog: vi.fn(),
        ...hostCbs,
      };
      const clientCallbacks: P2PCallbacks = {
        onMessage: (d) => clientMessages.push(d),
        onOpen: clientOnOpen,
        onLog: vi.fn(),
        ...clientCbs,
      };

      // Phase 1: negotiate
      const hostResult = await createHost(hostCallbacks);
      const clientResult = await createClient(clientCallbacks, hostResult.offer);
      await hostResult.applyAnswer(clientResult.answer);

      const hostPc = createdPCs[0];
      const clientPc = createdPCs[1];
      const hostChannel = hostPc.createdChannels[0];
      const clientChannel = new MockRTCDataChannel('scrabble-data');

      // Phase 2: wire loopback — host.send() → clientChannel.onmessage, vice-versa
      hostChannel.send = (data: string) => {
        clientChannel.onmessage?.({ data } as MessageEvent);
      };
      clientChannel.send = (data: string) => {
        hostChannel.onmessage?.({ data } as MessageEvent);
      };

      // Phase 3: trigger client ondatachannel (calls wireChannel on clientChannel)
      clientPc.simulateDataChannel(clientChannel);

      // Phase 4: open both channels (fires respective onOpen callbacks)
      clientChannel.simulateOpen();
      hostChannel.simulateOpen();

      return {
        host: hostResult,
        client: clientResult,
        hostMessages,
        clientMessages,
        hostOnOpen,
        clientOnOpen,
        hostChannel,
        clientChannel,
      };
    }

    it('host and client exchange messages bidirectionally after negotiation', async () => {
      const { host, client, hostMessages, clientMessages } = await createLoopbackPair();

      host.connection.send({ type: 'SYNC_STATE', move: 1 });
      expect(clientMessages).toEqual([{ type: 'SYNC_STATE', move: 1 }]);

      client.connection.send({ type: 'ACTION_PASS', playerId: 'client' });
      expect(hostMessages).toEqual([{ type: 'ACTION_PASS', playerId: 'client' }]);
    });

    it('both onOpen callbacks fire once each side opens', async () => {
      const { hostOnOpen, clientOnOpen } = await createLoopbackPair();
      expect(hostOnOpen).toHaveBeenCalledTimes(1);
      expect(clientOnOpen).toHaveBeenCalledTimes(1);
    });

    it('multiple messages can be sent in sequence without loss', async () => {
      const { host, clientMessages } = await createLoopbackPair();

      const msgs = [
        { type: 'SYNC_STATE', move: 1 },
        { type: 'SYNC_STATE', move: 2 },
        { type: 'SYNC_STATE', move: 3 },
      ];
      for (const m of msgs) host.connection.send(m);

      expect(clientMessages).toHaveLength(3);
      expect(clientMessages).toEqual(msgs);
    });

    it('all ActionMessage types round-trip correctly', async () => {
      const { host, client, hostMessages, clientMessages } = await createLoopbackPair();

      // Host → Client: SYNC_STATE (the most complex message)
      const syncState = {
        type: 'SYNC_STATE',
        state: {
          sessionId: 's1', language: 'en', board: [], racks: {}, scores: {},
          bag: [], players: ['host', 'client'], currentPlayer: 'host',
          moveNumber: 1, history: [],
        },
        meta: {
          mode: 'host', language: 'en', isHost: true,
          localPlayerId: 'host', remotePlayerId: 'client', sessionId: 's1',
        },
        labels: { host: 'Alice', client: 'Bob' },
      };
      host.connection.send(syncState);
      expect(clientMessages[0]).toEqual(syncState);

      // Client → Host: all client action types
      const actionMove = {
        type: 'ACTION_MOVE', playerId: 'client',
        placements: [{ x: 7, y: 7, tile: { id: 't1', letter: 'A', value: 1, blank: false } }],
      };
      client.connection.send(actionMove);
      expect(hostMessages[0]).toEqual(actionMove);

      client.connection.send({ type: 'ACTION_PASS', playerId: 'client' });
      expect(hostMessages[1]).toEqual({ type: 'ACTION_PASS', playerId: 'client' });

      client.connection.send({ type: 'ACTION_EXCHANGE', playerId: 'client', tileIds: ['t1', 't2'] });
      expect(hostMessages[2]).toEqual({ type: 'ACTION_EXCHANGE', playerId: 'client', tileIds: ['t1', 't2'] });

      client.connection.send({ type: 'REQUEST_SYNC' });
      expect(hostMessages[3]).toEqual({ type: 'REQUEST_SYNC' });

      client.connection.send({ type: 'PLAYER_READY', playerId: 'client', ready: true });
      expect(hostMessages[4]).toEqual({ type: 'PLAYER_READY', playerId: 'client', ready: true });

      const draft = {
        type: 'DRAFT_PLACEMENTS', playerId: 'client', moveNumber: 3,
        placements: [{ x: 5, y: 5, tile: { id: 't2', letter: 'B', value: 3, blank: false } }],
      };
      client.connection.send(draft);
      expect(hostMessages[5]).toEqual(draft);

      const rematch = { type: 'ACTION_REMATCH_REQUEST', playerId: 'client', at: 99999 };
      client.connection.send(rematch);
      expect(hostMessages[6]).toEqual(rematch);
    });

    it('closing host connection prevents further messages reaching client', async () => {
      const { host, clientMessages } = await createLoopbackPair();

      host.connection.send({ type: 'BEFORE_CLOSE' });
      expect(clientMessages).toHaveLength(1);

      host.connection.close();

      // After close the host channel readyState is 'closed' — send() is a no-op
      host.connection.send({ type: 'AFTER_CLOSE' });
      expect(clientMessages).toHaveLength(1);
    });

    it('invalid JSON from peer triggers onError rather than crashing', async () => {
      const hostOnError = vi.fn();
      const { hostChannel } = await createLoopbackPair({ onError: hostOnError });

      // Inject malformed JSON directly into the host channel's onmessage
      hostChannel.onmessage?.({ data: '{bad json' } as MessageEvent);

      expect(hostOnError).toHaveBeenCalled();
    });
  });
});
