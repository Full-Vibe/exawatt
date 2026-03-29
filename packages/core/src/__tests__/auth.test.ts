import { describe, it, expect } from 'vitest';
import {
  generateDeviceKeypair,
  signChallenge,
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

  it('deriveDeviceId produces 32-char hex from public key', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const deviceId = deriveDeviceId(publicKey);
    expect(deviceId).toHaveLength(32);
    expect(deviceId).toBe(publicKey.slice(0, 32));
  });
});
