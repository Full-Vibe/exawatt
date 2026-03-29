import * as ed from '@noble/ed25519';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---- Browser-safe crypto utilities ----

/**
 * Generate a new Ed25519 keypair for device auth.
 * Returns hex-encoded keys.
 */
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

/**
 * Sign the gateway challenge nonce.
 * message = nonce + ":" + timestamp (as string)
 */
export async function signChallenge(
  privateKeyHex: string,
  nonce: string,
  timestamp: number
): Promise<string> {
  const message = new TextEncoder().encode(`${nonce}:${timestamp}`);
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(message, privateKeyBytes);
  return bytesToHex(signature);
}

/**
 * Derive device ID from public key (first 16 bytes as hex = 32 chars).
 */
export function deriveDeviceId(publicKeyHex: string): string {
  return publicKeyHex.slice(0, 32);
}

// ---- Server-only filesystem utilities ----
// These are exported from server.ts, NOT from index.ts

export interface OCGatewayConfig {
  gateway?: {
    port?: number;
    host?: string;
    auth?: { token?: string };
  };
}

/**
 * Read the OC gateway config from the filesystem.
 * Only call server-side.
 */
export function readGatewayConfig(stateDir?: string): OCGatewayConfig | null {
  const dir = stateDir ?? join(homedir(), '.openclaw');
  const configPath = join(dir, 'openclaw.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as OCGatewayConfig;
  } catch {
    return null;
  }
}

/**
 * Read the OC gateway auth token from the filesystem.
 * Returns token string or null if not found.
 * Only call server-side.
 */
export function readGatewayToken(stateDir?: string): string | null {
  const config = readGatewayConfig(stateDir);
  return config?.gateway?.auth?.token ?? null;
}

// ---- Helpers ----

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
