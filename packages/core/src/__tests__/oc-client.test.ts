import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OCClient } from '../oc/client';
import * as auth from '../oc/auth';

/**
 * An invented device identity, in the encodings the Gateway parses: a 32-byte
 * secret as hex, and the raw public key bytes as unpadded base64url. Fixed
 * rather than generated so the assertions below are about the client.
 */
const SAVED_KEYPAIR = {
  privateKey:
    '7c1d0e5a93b46f2081ca35e7d9481b60f3a27c5e6d80194b2fe3a70c58d9126b',
  publicKey: 'pB97LGDZjjUXBCumz40Z43tcIE72Go2Ty3Di9Bhdagk',
};

vi.mock('../oc/auth', async () => {
  const actual =
    await vi.importActual<typeof import('../oc/auth')>('../oc/auth');
  return {
    ...actual,
    generateDeviceKeypair: vi.fn(async () => ({
      privateKey: 'a'.repeat(64),
      publicKey: 'b'.repeat(64),
    })),
    buildDeviceAuthPayload: vi.fn(() => 'signed-payload'),
    signDevicePayload: vi.fn(async () => 'c'.repeat(128)),
    signChallenge: vi.fn(async () => 'legacy-signature'),
    deriveDeviceId: vi.fn(async () => 'd'.repeat(64)),
  };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: string[] = [];

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.onclose?.();
  }

  serverSend(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * Long enough for real WebCrypto to answer. The mocked auth module resolves
 * in a microtask, but a test that puts the real device-id derivation back
 * needs the digest to actually finish before the connect frame exists.
 */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
};

const beginConnect = async (
  client: OCClient
): Promise<{ connectPromise: Promise<void>; socket: MockWebSocket }> => {
  const connectPromise = client.connect();
  await flush();

  const socket = MockWebSocket.instances[0];
  expect(socket).toBeDefined();

  return { connectPromise, socket };
};

const completeHandshake = async (
  socket: MockWebSocket,
  options: { sendChallenge?: boolean } = {}
): Promise<void> => {
  if (options.sendChallenge ?? true) {
    socket.serverSend({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-1', ts: 1111 },
    });
    await flush();
  }
  expect(socket.sentMessages.length).toBeGreaterThan(0);

  const connectRequest = JSON.parse(socket.sentMessages[0]) as {
    id: string;
    method: string;
  };

  expect(connectRequest.method).toBe('connect');

  socket.serverSend({
    type: 'res',
    id: connectRequest.id,
    ok: true,
    payload: {
      type: 'hello-ok',
      protocol: 3,
      policy: { tickIntervalMs: 1000 },
      auth: { deviceToken: 'device-token-1' },
    },
  });

  await flush();
};

describe('OCClient', () => {
  beforeEach(() => {
    // Call history only; the module mock's implementations stay. Without it
    // one test's handshake is counted against the next one's keygen.
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('completes challenge handshake and becomes connected', async () => {
    const client = new OCClient({ url: 'ws://127.0.0.1:18789' });

    const { connectPromise, socket } = await beginConnect(client);
    socket.serverSend({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-1', ts: 1111 },
    });
    await flush();

    const connectRequest = JSON.parse(socket.sentMessages[0]) as {
      method: string;
      params: {
        minProtocol: 3;
        maxProtocol: 3;
        role: string;
        scopes: string[];
        device: { signedAt: number; nonce: string };
        client: { id: string; mode: string };
        caps: string[];
        userAgent: string;
        locale: string;
      };
    };

    expect(connectRequest.method).toBe('connect');
    // A RANGE, not a pin. A current Gateway refuses an operator client unless
    // maxProtocol reaches 4, and a v3 Gateway still matches on the minimum.
    expect(connectRequest.params.minProtocol).toBe(3);
    expect(connectRequest.params.maxProtocol).toBe(4);
    expect(connectRequest.params.role).toBe('operator');
    expect(connectRequest.params.scopes).toEqual([
      'operator.read',
      'operator.write',
    ]);
    expect(connectRequest.params.device.nonce).toBe('nonce-1');
    expect(connectRequest.params.device.signedAt).toEqual(expect.any(Number));
    expect(connectRequest.params.client.id).toBe('webchat');
    expect(connectRequest.params.client.mode).toBe('webchat');
    expect(connectRequest.params.caps).toEqual(['tool-events']);
    expect(connectRequest.params.userAgent).toBeTypeOf('string');
    expect(connectRequest.params.locale).toBeTypeOf('string');

    await completeHandshake(socket, { sendChallenge: false });
    await connectPromise;

    expect(auth.buildDeviceAuthPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'd'.repeat(64),
        clientId: 'webchat',
        clientMode: 'webchat',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        nonce: 'nonce-1',
      })
    );
    expect(auth.signDevicePayload).toHaveBeenCalledWith(
      'a'.repeat(64),
      'signed-payload'
    );
    expect(client.getStatus()).toBe('connected');
  });

  it('requests privileged scopes only when the embedding boundary opts in', async () => {
    const client = new OCClient({
      url: 'ws://127.0.0.1:18789',
      scopes: ['operator.read', 'operator.admin'],
    });

    const { connectPromise, socket } = await beginConnect(client);
    socket.serverSend({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-privileged', ts: 1111 },
    });
    await flush();

    const connectRequest = JSON.parse(socket.sentMessages[0]) as {
      params: { scopes: string[] };
    };
    expect(connectRequest.params.scopes).toEqual([
      'operator.read',
      'operator.admin',
    ]);

    await completeHandshake(socket, { sendChallenge: false });
    await connectPromise;
  });

  it('matches request and response by id', async () => {
    const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
    const { connectPromise, socket } = await beginConnect(client);
    await completeHandshake(socket);
    await connectPromise;

    const requestPromise = client.call<{ uptime: number }>('health', {});
    const outgoing = JSON.parse(socket.sentMessages[1]) as {
      id: string;
      method: string;
    };

    expect(outgoing.method).toBe('health');

    socket.serverSend({
      type: 'res',
      id: outgoing.id,
      ok: true,
      payload: { uptime: 42 },
    });

    await expect(requestPromise).resolves.toEqual({ uptime: 42 });
  });

  it('rejects timed out requests', async () => {
    vi.useFakeTimers();
    const client = new OCClient({
      url: 'ws://127.0.0.1:18789',
      requestTimeoutMs: 50,
    });

    const { connectPromise, socket } = await beginConnect(client);
    await completeHandshake(socket);
    await connectPromise;

    const requestPromise = client.call('status', {});
    const timeoutExpectation = expect(requestPromise).rejects.toThrow(
      'Request status timed out after 50ms'
    );

    await vi.advanceTimersByTimeAsync(60);

    await timeoutExpectation;
  });

  it('dispatches matching OC events to subscribers', async () => {
    const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
    const handler = vi.fn();
    client.onOCEvent('presence', handler);

    const { connectPromise, socket } = await beginConnect(client);
    await completeHandshake(socket);
    await connectPromise;

    const payload = { agentId: 'agent-1', online: true, sessionCount: 2 };
    socket.serverSend({ type: 'event', event: 'presence', payload });
    await flush();

    expect(handler).toHaveBeenCalledWith(payload);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reconnects after websocket close', async () => {
    vi.useFakeTimers();
    const client = new OCClient({
      url: 'ws://127.0.0.1:18789',
      reconnectDelayMs: 20,
      maxReconnectDelay: 100,
    });

    const { connectPromise, socket: firstSocket } = await beginConnect(client);
    await completeHandshake(firstSocket);
    await connectPromise;

    firstSocket.close();
    await vi.advanceTimersByTimeAsync(20);

    expect(MockWebSocket.instances.length).toBe(2);
    expect(client.getStatus()).toBe('connecting');
  });

  it('does not let a stale close race disconnect a replacement socket', async () => {
    vi.useFakeTimers();
    const client = new OCClient({
      url: 'ws://127.0.0.1:18789',
      reconnectDelayMs: 20,
    });
    const { connectPromise, socket: firstSocket } = await beginConnect(client);
    await completeHandshake(firstSocket);
    await connectPromise;

    client.disconnect();
    const secondConnect = client.connect();
    await flush();
    const secondSocket = MockWebSocket.instances[1]!;
    await completeHandshake(secondSocket);
    await secondConnect;
    await vi.advanceTimersByTimeAsync(30);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(client.getStatus()).toBe('connected');
  });

  describe('device identity', () => {
    it('mints one when the caller keeps none, and exposes what it minted', async () => {
      const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
      // Nothing to expose before a connect: the client has not had to be
      // anybody yet.
      expect(client.deviceKeypair).toBeNull();

      const { connectPromise, socket } = await beginConnect(client);
      await completeHandshake(socket);
      await connectPromise;

      expect(auth.generateDeviceKeypair).toHaveBeenCalledTimes(1);
      // Readable, because the caller has to persist it beside the token the
      // Gateway just issued. A token kept without it is refused next launch.
      expect(client.deviceKeypair).toEqual({
        privateKey: 'a'.repeat(64),
        publicKey: 'b'.repeat(64),
      });
      expect(client.deviceToken).toBe('device-token-1');
    });

    it('presents the keypair it was given instead of minting a new device', async () => {
      const client = new OCClient({
        url: 'ws://127.0.0.1:18789',
        deviceKeypair: SAVED_KEYPAIR,
      });
      expect(client.deviceKeypair).toEqual(SAVED_KEYPAIR);

      const { connectPromise, socket } = await beginConnect(client);
      await completeHandshake(socket);
      await connectPromise;

      // The whole seam: a client handed an identity is that device, and never
      // mints a second one.
      expect(auth.generateDeviceKeypair).not.toHaveBeenCalled();
      expect(auth.deriveDeviceId).toHaveBeenCalledWith(SAVED_KEYPAIR.publicKey);
      expect(auth.signDevicePayload).toHaveBeenCalledWith(
        SAVED_KEYPAIR.privateKey,
        'signed-payload'
      );

      const connectRequest = JSON.parse(socket.sentMessages[0]) as {
        params: { device: { publicKey: string } };
      };
      expect(connectRequest.params.device.publicKey).toBe(
        SAVED_KEYPAIR.publicKey
      );
      expect(client.deviceKeypair).toEqual(SAVED_KEYPAIR);
    });

    it('sends the device id the Gateway itself would derive from that key', async () => {
      // The real derivation for this one handshake, checked against Node's
      // own crypto rather than against this module. An id derived any other
      // way is a device the Gateway has never approved, whatever the token
      // says.
      const actual =
        await vi.importActual<typeof import('../oc/auth')>('../oc/auth');
      vi.mocked(auth.deriveDeviceId).mockImplementationOnce(
        actual.deriveDeviceId
      );

      const client = new OCClient({
        url: 'ws://127.0.0.1:18789',
        deviceKeypair: SAVED_KEYPAIR,
      });
      const { connectPromise, socket } = await beginConnect(client);
      socket.serverSend({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1', ts: 1111 },
      });
      await settle();
      await completeHandshake(socket, { sendChallenge: false });
      await connectPromise;

      const connectRequest = JSON.parse(socket.sentMessages[0]) as {
        params: { device: { id: string } };
      };
      expect(connectRequest.params.device.id).toBe(
        createHash('sha256')
          .update(Buffer.from(SAVED_KEYPAIR.publicKey, 'base64url'))
          .digest('hex')
      );
    });

    it('refuses an unusable keypair rather than quietly becoming a new device', () => {
      expect(
        () =>
          new OCClient({
            url: 'ws://127.0.0.1:18789',
            deviceKeypair: { privateKey: 'not-hex', publicKey: 'not base64!' },
          })
      ).toThrow(/device keypair/iu);
      expect(auth.generateDeviceKeypair).not.toHaveBeenCalled();
    });
  });

  describe('a refused handshake', () => {
    it("rejects connect with the Gateway's own sentence, not a generic one", async () => {
      const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
      const reported: Error[] = [];
      client.on('connection:error', error => {
        reported.push(error);
      });

      const { connectPromise, socket } = await beginConnect(client);
      const rejection = expect(connectPromise).rejects.toThrow(
        'unauthorized: device token mismatch (rotate/reissue device token)'
      );

      socket.serverSend({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-refused', ts: 1111 },
      });
      await flush();
      const connectRequest = JSON.parse(socket.sentMessages[0]) as {
        id: string;
      };
      socket.serverSend({
        type: 'res',
        id: connectRequest.id,
        ok: false,
        error: {
          message:
            'unauthorized: device token mismatch (rotate/reissue device token)',
        },
      });
      await flush();

      await rejection;
      // The sentence the event carried and the sentence connect() rejects
      // with are now the same one. They were not, and every caller above
      // reported "connection failed" over a Gateway that was answering fine.
      expect(reported.map(error => error.message)).toEqual([
        'unauthorized: device token mismatch (rotate/reissue device token)',
      ]);
    });

    it('still reports a generic failure when the connection said nothing', async () => {
      const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
      const { connectPromise, socket } = await beginConnect(client);
      const rejection = expect(connectPromise).rejects.toThrow(
        /connection failed with status/u
      );

      socket.close();
      await flush();

      await rejection;
    });
  });

  it('emits expected status transitions', async () => {
    const client = new OCClient({ url: 'ws://127.0.0.1:18789' });
    const statuses: string[] = [];
    client.on('connection:status', status => {
      statuses.push(status);
    });

    const { connectPromise, socket } = await beginConnect(client);
    await completeHandshake(socket);
    await connectPromise;
    client.disconnect();

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');
    expect(statuses).toContain('disconnected');
  });
});
