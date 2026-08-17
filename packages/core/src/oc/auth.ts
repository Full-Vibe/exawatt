import * as ed from '@noble/ed25519';

export interface OCGatewayConfig {
  gateway?: {
    mode?: 'local' | 'remote';
    port?: number;
    bind?: 'auto' | 'lan' | 'loopback' | 'custom' | 'tailnet';
    customBindHost?: string;
    auth?: {
      mode?: 'none' | 'token' | 'password' | 'trusted-proxy';
      token?: string;
      password?: string;
    };
    remote?: {
      url?: string;
      token?: string;
      password?: string;
    };
  };
}

export async function generateDeviceKeypair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const privateKeyBytes = ed.utils.randomSecretKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToHex(publicKeyBytes),
  };
}

export async function signChallenge(
  privateKeyHex: string,
  nonce: string,
  timestamp: number
): Promise<string> {
  const payload = `${nonce}:${timestamp}`;
  return signDevicePayload(privateKeyHex, payload);
}

export function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
}): string {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
  ].join('|');
}

export async function signDevicePayload(
  privateKeyHex: string,
  payload: string
): Promise<string> {
  const message = new TextEncoder().encode(payload);
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(message, privateKeyBytes);
  return bytesToHex(signature);
}

export function deriveDeviceId(publicKeyHex: string): string {
  return publicKeyHex.slice(0, 32);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
