import { createHash, createPublicKey, verify } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  generateDeviceKeypair,
  signChallenge,
  buildDeviceAuthPayload,
  signDevicePayload,
  deriveDeviceId,
} from '../oc/auth';

/**
 * These assertions are written against the Gateway's own derivation rules
 * rather than against this module's implementation, using Node's crypto as an
 * independent witness. Restating the implementation would have kept the old
 * hex encoding green while every real connect was rejected with "device
 * identity mismatch", which is exactly what happened before a live run caught
 * it.
 */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('Auth utilities', () => {
  it('publishes the public key as base64url raw Ed25519 bytes', async () => {
    const { privateKey, publicKey } = await generateDeviceKeypair();
    expect(privateKey).toHaveLength(64); // 32 bytes, hex, never leaves here
    expect(publicKey).not.toMatch(/^[0-9a-f]+$/); // not hex any more
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, unpadded
    expect(base64UrlToBuffer(publicKey)).toHaveLength(32);
  });

  it('each keypair is unique', async () => {
    const kp1 = await generateDeviceKeypair();
    const kp2 = await generateDeviceKeypair();
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });

  it('signs as base64url so the Gateway can decode the signature', async () => {
    const { privateKey } = await generateDeviceKeypair();
    const sig = await signChallenge(
      privateKey,
      'test-nonce',
      1_700_000_000_000
    );
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(base64UrlToBuffer(sig)).toHaveLength(64);
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

  it('produces a signature the Gateway verification path accepts', async () => {
    const { privateKey, publicKey } = await generateDeviceKeypair();
    const payload = 'v2|device|payload';
    const signature = await signDevicePayload(privateKey, payload);

    // Reconstructed exactly the way the Gateway does it: SPKI prefix plus the
    // raw key bytes, then verify the UTF-8 payload.
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, base64UrlToBuffer(publicKey)]),
      type: 'spki',
      format: 'der',
    });
    expect(
      verify(
        null,
        Buffer.from(payload, 'utf8'),
        key,
        base64UrlToBuffer(signature)
      )
    ).toBe(true);
  });

  it('derives the device id as the Gateway does, from the key bytes', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const deviceId = await deriveDeviceId(publicKey);

    expect(deviceId).toHaveLength(64); // sha256 hex
    expect(deviceId).toBe(
      createHash('sha256').update(base64UrlToBuffer(publicKey)).digest('hex')
    );
    // The old scheme truncated the key itself, which no current Gateway accepts.
    expect(deviceId).not.toBe(publicKey.slice(0, 32));
  });
});
