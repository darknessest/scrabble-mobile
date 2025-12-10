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

const rtcConfig: RTCConfiguration = {
  iceServers: []
};

export async function createHost(callbacks: P2PCallbacks) {
  const pc = new RTCPeerConnection(rtcConfig);
  const channel = pc.createDataChannel('scrabble-data', { negotiated: false });
  wireChannel(channel, callbacks);
  wirePeerLogging(pc, 'host', callbacks);

  const offer = await buildOffer(pc);

  return {
    connection: buildConn(pc, channel),
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

  let channel: RTCDataChannel | null = null;
  pc.ondatachannel = (ev) => {
    channel = ev.channel;
    wireChannel(channel, callbacks);
  };

  const desc = decodeSDP(offer);
  await pc.setRemoteDescription(desc);

  const answer = await buildAnswer(pc);

  return {
    connection: buildConn(pc, channel),
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

function buildConn(pc: RTCPeerConnection, channel: RTCDataChannel | null): P2PConnection {
  return {
    role: channel?.id === 0 ? 'host' : 'client',
    send: (data: unknown) => {
      if (channel?.readyState === 'open') {
        channel.send(JSON.stringify(data));
      }
    },
    close: () => {
      channel?.close();
      pc.close();
    },
    get dataChannelReady() {
      return channel?.readyState === 'open';
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

