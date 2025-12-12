import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHost, createClient } from './p2p';

// Types for mocks
type EventListener = (evt: any) => void;

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

  dispatchEvent(event: { type: string; [key: string]: any }) {
    const listeners = this.listeners[event.type] || [];
    listeners.forEach((l) => l(event));
    
    // Call on<event> handler if it exists
    const handlerName = `on${event.type}`;
    // @ts-ignore
    if (typeof this[handlerName] === 'function') {
      // @ts-ignore
      this[handlerName](event);
    }
  }
}

class MockRTCDataChannel extends MockEventTarget {
  label: string;
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
  
  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;

  constructor(label: string) {
    super();
    this.label = label;
  }

  send(data: any) {
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
  localDescription: any = null;
  remoteDescription: any = null;

  onicegatheringstatechange: ((ev: any) => void) | null = null;
  onconnectionstatechange: ((ev: any) => void) | null = null;
  oniceconnectionstatechange: ((ev: any) => void) | null = null;
  ondatachannel: ((ev: { channel: MockRTCDataChannel }) => void) | null = null;
  onicecandidate: ((ev: any) => void) | null = null;

  createdChannels: MockRTCDataChannel[] = [];

  constructor(config: any) {
    super();
  }

  createDataChannel(label: string, options?: any) {
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

  async setLocalDescription(desc: any) {
    this.localDescription = desc;
    // Simulate ICE gathering completing shortly after setting local description
    setTimeout(() => {
      this.iceGatheringState = 'complete';
      this.dispatchEvent({ type: 'icegatheringstatechange' });
      // Also signal end of candidates
      if (this.onicecandidate) {
          this.onicecandidate({ candidate: null });
      }
    }, 10);
  }

  async setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
  }

  close() {
    this.connectionState = 'closed';
    this.dispatchEvent({ type: 'connectionstatechange' });
    this.createdChannels.forEach(ch => ch.close());
  }

  // Helper for tests to simulate incoming data channel
  simulateDataChannel(channel: MockRTCDataChannel) {
    // @ts-ignore
    if (this.ondatachannel) {
      // @ts-ignore
      this.ondatachannel({ channel });
    }
  }
}

// Helper to access the last created PC
let createdPCs: MockRTCPeerConnection[] = [];

describe('P2P Network', () => {
  beforeEach(() => {
    createdPCs = [];
    // @ts-ignore
    global.RTCPeerConnection = class extends MockRTCPeerConnection {
      constructor(config: any) {
        super(config);
        createdPCs.push(this);
      }
    };
    // @ts-ignore
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

    const host = await createHost(callbacks);
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
});

