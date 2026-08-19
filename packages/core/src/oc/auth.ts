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

/**
 * One device's identity, as the Gateway knows it.
 *
 * The pair travels together or not at all. The Gateway derives the device id
 * from the public half and binds every token it issues to that id, so a token
 * kept without its keypair belongs to a device this process can no longer be,
 * and a keypair kept without its token is a device with nothing to present.
 */
export interface OCDeviceKeypair {
  /**
   * Hex-encoded Ed25519 secret. It never goes on the wire, and a caller that
   * persists it owes it exactly the custody the device token gets: OS
   * encryption, never a records file, never a log line, never an error.
   */
  privateKey: string;
  /** base64url raw public key bytes, in the one form the Gateway parses. */
  publicKey: string;
}

/** 32 raw bytes, hex encoded. */
const PRIVATE_KEY_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const PUBLIC_KEY_BYTE_LENGTH = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * Device identity encoding (corrected 2026-08-17 against a live Gateway).
 *
 * The Gateway decodes `device.publicKey` as base64url raw Ed25519 bytes (or
 * PEM), derives the device id as the SHA-256 of those bytes, and decodes the
 * signature as base64url. Exawatt previously sent hex keys and used the first
 * 32 characters of the public key as the id, so every connect was rejected
 * with "device identity mismatch" before a single method could be called.
 *
 * The private key stays hex because it never leaves this process; only the
 * material the Gateway parses is encoded its way.
 */
export async function generateDeviceKeypair(): Promise<OCDeviceKeypair> {
  const privateKeyBytes = ed.utils.randomSecretKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToBase64Url(publicKeyBytes),
  };
}

/**
 * A keypair read back from wherever a caller kept it, or null when the shape
 * is not one this process could present.
 *
 * The one canonical check, here rather than at each storage site, because the
 * encodings were corrected against a live Gateway once and a second opinion
 * about them would be a second chance to get them wrong. A rejected keypair
 * means the caller pairs again, which costs an operator one approval; an
 * accepted-but-wrong one means every handshake is refused with nothing to
 * point at.
 */
export function parseDeviceKeypair(value: unknown): OCDeviceKeypair | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as { privateKey?: unknown; publicKey?: unknown };
  const { privateKey, publicKey } = candidate;
  if (typeof privateKey !== 'string' || typeof publicKey !== 'string') {
    return null;
  }
  if (!PRIVATE_KEY_HEX_PATTERN.test(privateKey)) return null;
  if (!BASE64URL_PATTERN.test(publicKey)) return null;
  try {
    if (base64UrlToBytes(publicKey).length !== PUBLIC_KEY_BYTE_LENGTH) {
      return null;
    }
  } catch {
    return null;
  }
  return { privateKey, publicKey };
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
  return bytesToBase64Url(signature);
}

/**
 * SHA-256 of the raw public key bytes, hex encoded, matching the Gateway's
 * own derivation. Async because it uses WebCrypto rather than adding a hash
 * dependency to a package that both Electron main and the renderer load.
 */
export async function deriveDeviceId(
  publicKeyBase64Url: string
): Promise<string> {
  const raw = base64UrlToBytes(publicKeyBase64Url);
  const digest = await crypto.subtle.digest('SHA-256', raw as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
