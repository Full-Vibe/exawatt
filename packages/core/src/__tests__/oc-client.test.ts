import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { OCClient } from '../oc/client';
import * as auth from '../oc/auth';

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
    deriveDeviceId: vi.fn(() => 'd'.repeat(32)),
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
    expect(connectRequest.params.minProtocol).toBe(3);
    expect(connectRequest.params.maxProtocol).toBe(3);
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
        deviceId: 'd'.repeat(32),
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
