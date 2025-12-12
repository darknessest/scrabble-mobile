export interface P2PCallbacks {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
  onLog?: (msg: string) => void;
}

export interface P2PConnection {
  role: 'host' | 'client';
  send: (data: unknown) => void;
  close: () => void;
  dataChannelReady: boolean;
}

type ChannelRef = { current: RTCDataChannel | null };

const rtcConfig: RTCConfiguration = {
  iceServers: []
};

export async function createHost(callbacks: P2PCallbacks) {
  const pc = new RTCPeerConnection(rtcConfig);
  const channel = pc.createDataChannel('scrabble-data', { negotiated: false });
  wireChannel(channel, callbacks);
  wirePeerLogging(pc, 'host', callbacks);
  const channelRef: ChannelRef = { current: channel };

  const offer = await buildOffer(pc);

  return {
    connection: buildConn(pc, channelRef, 'host'),
    offer,
    applyAnswer: async (answer: string) => {
      const desc = decodeSDP(answer);
      await pc.setRemoteDescription(desc);
    }
  };
}

export async function createClient(callbacks: P2PCallbacks, offer: string) {
  const pc = new RTCPeerConnection(rtcConfig);
  wirePeerLogging(pc, 'client', callbacks);

  const channelRef: ChannelRef = { current: null };
  pc.ondatachannel = (ev) => {
    channelRef.current = ev.channel;
    wireChannel(ev.channel, callbacks);
  };

  const desc = decodeSDP(offer);
  await pc.setRemoteDescription(desc);

  const answer = await buildAnswer(pc);

  return {
    connection: buildConn(pc, channelRef, 'client'),
    answer,
    applyAck: async () => {
      // noop placeholder for symmetry
    }
  };
}

function wireChannel(channel: RTCDataChannel, callbacks: P2PCallbacks) {
  channel.onopen = () => callbacks.onOpen?.();
  channel.onclose = () => callbacks.onClose?.();
  channel.onerror = (err) => callbacks.onError?.(err);
  channel.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data);
      callbacks.onMessage(parsed);
    } catch (err) {
      callbacks.onError?.(err);
    }
  };
}

function buildConn(pc: RTCPeerConnection, channelRef: ChannelRef, role: 'host' | 'client'): P2PConnection {
  return {
    role,
    send: (data: unknown) => {
      const channel = channelRef.current;
      if (channel?.readyState === 'open') {
        channel.send(JSON.stringify(data));
      }
    },
    close: () => {
      channelRef.current?.close();
      pc.close();
    },
    get dataChannelReady() {
      return channelRef.current?.readyState === 'open';
    }
  };
}

async function buildOffer(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);
  return encodeSDP(pc.localDescription!);
}

async function buildAnswer(pc: RTCPeerConnection): Promise<string> {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIce(pc);
  return encodeSDP(pc.localDescription!);
}

function encodeSDP(desc: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(desc));
}

function decodeSDP(data: string): RTCSessionDescriptionInit {
  return JSON.parse(atob(data)) as RTCSessionDescriptionInit;
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function wirePeerLogging(pc: RTCPeerConnection, role: 'host' | 'client', callbacks: P2PCallbacks) {
  const log = (msg: string) => callbacks.onLog?.(`[${role}] ${msg}`);
  pc.onicegatheringstatechange = () => log(`iceGatheringState=${pc.iceGatheringState}`);
  pc.onconnectionstatechange = () => log(`connectionState=${pc.connectionState}`);
  pc.oniceconnectionstatechange = () => log(`iceConnectionState=${pc.iceConnectionState}`);
  pc.onicecandidate = (ev) => {
    if (!ev.candidate) {
      log('ICE gathering complete');
    }
  };
}

