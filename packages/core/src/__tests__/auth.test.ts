import { describe, it, expect } from 'vitest';
import {
  generateDeviceKeypair,
  signChallenge,
  buildDeviceAuthPayload,
  signDevicePayload,
  deriveDeviceId,
} from '../oc/auth';

describe('Auth utilities', () => {
  it('generateDeviceKeypair produces 32-byte hex keys', async () => {
    const { privateKey, publicKey } = await generateDeviceKeypair();
    expect(privateKey).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(publicKey).toHaveLength(64);
  });

  it('each keypair is unique', async () => {
    const kp1 = await generateDeviceKeypair();
    const kp2 = await generateDeviceKeypair();
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });

  it('signChallenge produces 64-byte signature', async () => {
    const { privateKey } = await generateDeviceKeypair();
    const sig = await signChallenge(privateKey, 'test-nonce', Date.now());
    expect(sig).toHaveLength(128); // 64 bytes = 128 hex chars
  });

  it('buildDeviceAuthPayload uses OC v2 payload format', () => {
    const payload = buildDeviceAuthPayload({
      deviceId: 'device-1',
      clientId: 'webchat',
      clientMode: 'webchat',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      signedAtMs: 123456789,
      token: null,
      nonce: 'nonce-1',
    });

    expect(payload).toBe(
      'v2|device-1|webchat|webchat|operator|operator.read,operator.write|123456789||nonce-1'
    );
  });

  it('signDevicePayload produces 64-byte signature', async () => {
    const { privateKey } = await generateDeviceKeypair();
    const sig = await signDevicePayload(privateKey, 'v2|device|payload');
    expect(sig).toHaveLength(128);
  });

  it('deriveDeviceId produces 32-char hex from public key', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const deviceId = deriveDeviceId(publicKey);
    expect(deviceId).toHaveLength(32);
    expect(deviceId).toBe(publicKey.slice(0, 32));
  });
});
