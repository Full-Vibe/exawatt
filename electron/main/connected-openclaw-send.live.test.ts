import { describe, expect, it, vi } from 'vitest';
import {
  generateDeviceKeypair,
  buildDeviceAuthPayload,
  signDevicePayload,
  deriveDeviceId,
} from '@exawatt/core';
import {
  bootstrapGatewayCredentialOverSsh,
  createSshRemoteExec,
} from './gateway-bootstrap';
import { openSshTunnel } from './ssh-tunnel';

vi.mock('electron', () => ({}));

/**
 * Live proof that H2's write path reaches a real coworker (ENG-033).
 *
 * Gated by its OWN environment variable, deliberately not the read-only one.
 * Every other live test observes; this one speaks, and speaking to an
 * autonomous agent on someone's production server is a different kind of act.
 * A read-only run can therefore never send by accident:
 *
 *   EXAWATT_LIVE_OPENCLAW_SEND_ALIAS=my-alias \
 *   EXAWATT_LIVE_OPENCLAW_SEND_AGENT=my-agent \
 *     npx vitest run electron/main/connected-openclaw-send.live.test.ts
 *
 * The message says plainly what it is and asks for no work, because the
 * recipient is an agent that can act on what it reads.
 */

const ALIAS = process.env.EXAWATT_LIVE_OPENCLAW_SEND_ALIAS ?? '';
const AGENT = process.env.EXAWATT_LIVE_OPENCLAW_SEND_AGENT ?? '';
const target = { kind: 'ssh-alias' as const, alias: ALIAS };

const PROBE_VERSION = 'exawatt-send-probe';

async function handshake(
  port: number,
  keys: { privateKey: string; publicKey: string },
  scopes: string[],
  auth: { token?: string; deviceToken?: string }
) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (value: unknown) => void>();
  let counter = 0;
  const nonceReady = new Promise<string>((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('socket')), {
      once: true,
    });
    socket.addEventListener('message', event => {
      const frame = JSON.parse(String((event as MessageEvent).data));
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        resolve(frame.payload.nonce);
      }
      if (frame.type === 'res' && pending.has(frame.id)) {
        pending.get(frame.id)!(frame);
        pending.delete(frame.id);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('open')), {
      once: true,
    });
  });
  const nonce = await nonceReady;
  const deviceId = await deriveDeviceId(keys.publicKey);
  const signedAt = Date.now();
  const signature = await signDevicePayload(
    keys.privateKey,
    buildDeviceAuthPayload({
      deviceId,
      clientId: 'openclaw-macos',
      clientMode: 'ui',
      role: 'operator',
      scopes,
      signedAtMs: signedAt,
      token: auth.deviceToken ?? auth.token ?? null,
      nonce,
    })
  );
  const call = (method: string, params: unknown = {}) =>
    new Promise<{ ok: boolean; payload?: never; error?: unknown }>(resolve => {
      const id = `send-${++counter}`;
      pending.set(id, value => resolve(value as never));
      socket.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  const hello = await call('connect', {
    minProtocol: 3,
    maxProtocol: 4,
    role: 'operator',
    scopes,
    auth,
    device: {
      id: deviceId,
      publicKey: keys.publicKey,
      signature,
      signedAt,
      nonce,
    },
    client: {
      id: 'openclaw-macos',
      version: PROBE_VERSION,
      platform: 'darwin',
      mode: 'ui',
    },
    caps: ['tool-events'],
    userAgent: PROBE_VERSION,
    locale: 'en-US',
  });
  return { deviceId, hello, call, close: () => socket.close() };
}

async function devices() {
  const listed = await createSshRemoteExec()(target, [
    'openclaw',
    'devices',
    'list',
    '--json',
  ]);
  return JSON.parse(listed.stdout) as {
    paired?: { deviceId: string; scopes?: string[] }[];
    pending?: { requestId?: string; id?: string; scopes?: string[] }[];
  };
}

describe.skipIf(!ALIAS || !AGENT)('live send to a connected coworker', () => {
  it('asks for authority, is granted it on the server, and is heard', async () => {
    const boot = await bootstrapGatewayCredentialOverSsh(
      target,
      createSshRemoteExec()
    );
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    const opened = await openSshTunnel({
      ...target,
      remotePort: boot.facts.gatewayPort,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const port = opened.tunnel.localPort;
    const keys = await generateDeviceKeypair();
    const deviceId = await deriveDeviceId(keys.publicKey);
    const sessionKey = `agent:${AGENT}:main`;
    const marker = `exawatt-send-probe-${Date.now()}`;

    try {
      // 1. Pair read-only, exactly as connecting does.
      const read = await handshake(port, keys, ['operator.read'], {
        token: boot.facts.sharedToken,
      });
      expect(read.hello.ok).toBe(true);
      const deviceToken =
        (read.hello as { payload?: { auth?: { deviceToken?: string } } })
          .payload?.auth?.deviceToken ?? null;
      expect(deviceToken).toBeTruthy();
      read.close();

      // 2. Ask for more. The Gateway refuses and queues an approval request,
      //    which is the whole authority model: Exawatt can ask, never grant.
      const asked = await handshake(
        port,
        keys,
        ['operator.read', 'operator.write'],
        { token: boot.facts.sharedToken }
      );
      expect(asked.hello.ok).toBe(false);
      asked.close();

      const queued = await devices();
      const request = (queued.pending ?? [])[0];
      expect(request, 'a pending approval request').toBeTruthy();
      const requestId = request?.requestId ?? request?.id ?? '';
      expect(requestId).toBeTruthy();

      // 3. The operator approves, on the machine that runs the Agent.
      const approved = await createSshRemoteExec()(target, [
        'openclaw',
        'devices',
        'approve',
        requestId,
      ]);
      expect(approved.code, approved.stderr.slice(0, 200)).toBe(0);

      const afterApproval = await devices();
      const record = (afterApproval.paired ?? []).find(
        entry => entry.deviceId === deviceId
      );
      expect(record?.scopes).toContain('operator.write');

      // 4. Now Exawatt may speak, and only now.
      //
      // The token from step 1 was issued at read scope and cannot present a
      // wider one; the Gateway refuses it with a scope mismatch, which is the
      // same guard that stops Exawatt widening its own authority. Approval
      // raised the device's baseline, so this reconnect presents the shared
      // secret once more and receives a NEW token at the granted scope.
      const writer = await handshake(
        port,
        keys,
        ['operator.read', 'operator.write'],
        { token: boot.facts.sharedToken }
      );
      expect(writer.hello.ok, JSON.stringify(writer.hello.error)).toBe(true);

      const sent = await writer.call('chat.send', {
        sessionKey,
        // Required by the Gateway, not optional: the protocol makes
        // exactly-once the caller's responsibility rather than a nicety.
        idempotencyKey: marker,
        message:
          process.env.EXAWATT_LIVE_OPENCLAW_SEND_TEXT ??
          `Connectivity test from Exawatt (${marker}). No action needed: please do not run any tools, post anything, or start any work in response to this message.`,
      });
      expect(sent.ok, JSON.stringify(sent.error)).toBe(true);

      // 5. The source's own transcript is what proves it landed.
      const history = await writer.call('chat.history', {
        sessionKey,
        limit: 10,
      });
      expect(history.ok).toBe(true);
      expect(JSON.stringify(history.payload)).toContain(marker);
      writer.close();
    } finally {
      // Remove only the credential this run created. The message stays, as a
      // real message does.
      await createSshRemoteExec()(target, [
        'openclaw',
        'devices',
        'remove',
        deviceId,
      ]);
      await opened.tunnel.close();
    }
  }, 180_000);
});
