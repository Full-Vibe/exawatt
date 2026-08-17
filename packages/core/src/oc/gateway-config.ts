import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { OCGatewayConfig } from './auth';

export interface OCGatewayConnection {
  /** Credential-free WebSocket endpoint. Authentication stays in the frame. */
  url: string;
  token?: string;
  password?: string;
}

export function readGatewayConfig(
  stateDir?: string,
  configPath?: string
): OCGatewayConfig | null {
  const resolvedPath =
    configPath ??
    join(stateDir ?? join(homedir(), '.openclaw'), 'openclaw.json');
  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(raw) as OCGatewayConfig;
  } catch {
    return null;
  }
}

export function readGatewayToken(stateDir?: string): string | null {
  const config = readGatewayConfig(stateDir);
  const token = config?.gateway?.auth?.token;
  return validSecret(token) ? token : null;
}

/**
 * Resolve the source-owned local/LAN Gateway connection without ever placing
 * its credential in a URL. Invalid endpoint material fails closed instead of
 * letting config text alter the authority or path Electron connects to.
 */
export function readGatewayConnection(
  stateDir?: string,
  configPath?: string
): OCGatewayConnection | null {
  return resolveGatewayConnection(readGatewayConfig(stateDir, configPath), {
    tailnetHost: primaryTailnetIPv4(),
  });
}

export function resolveGatewayConnection(
  config: OCGatewayConfig | null,
  options: { tailnetHost?: string } = {}
): OCGatewayConnection | null {
  const gateway = config?.gateway;
  if (!gateway) return null;
  if (
    gateway.mode !== undefined &&
    gateway.mode !== 'local' &&
    gateway.mode !== 'remote'
  ) {
    return null;
  }

  if (gateway.mode === 'remote') {
    const credential = credentialFor({
      token: gateway.remote?.token,
      password: gateway.remote?.password,
    });
    const url = validatedGatewayUrl(gateway.remote?.url);
    return credential && url ? { url, ...credential } : null;
  }

  const credential = localCredential(gateway.auth);
  if (!credential) return null;

  const bind = gateway.bind ?? 'loopback';
  if (!['auto', 'lan', 'loopback', 'custom', 'tailnet'].includes(bind)) {
    return null;
  }
  if (
    !credential.token &&
    !credential.password &&
    bind !== 'loopback' &&
    bind !== 'auto'
  ) {
    return null;
  }
  let host = '127.0.0.1';
  if (bind === 'custom') {
    const customHost = gateway.customBindHost?.trim();
    if (!customHost || isIP(customHost) !== 4) return null;
    host = customHost === '0.0.0.0' ? '127.0.0.1' : customHost;
  } else if (bind === 'tailnet') {
    if (!options.tailnetHost || !isTailnetIPv4(options.tailnetHost))
      return null;
    host = options.tailnetHost;
  }

  const configuredPort = gateway.port;
  const port = configuredPort ?? 18_789;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;

  const url = validatedGatewayUrl(`ws://${host}:${port}`);
  return url ? { url, ...credential } : null;
}

function validSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 16_384
  );
}

function credentialFor(values: {
  token?: unknown;
  password?: unknown;
}): Pick<OCGatewayConnection, 'token' | 'password'> | null {
  const token = validSecret(values.token) ? values.token : null;
  const password = validSecret(values.password) ? values.password : null;
  if ((token === null) === (password === null)) return null;
  return token ? { token } : password ? { password } : null;
}

function localCredential(
  auth: NonNullable<OCGatewayConfig['gateway']>['auth']
): Pick<OCGatewayConnection, 'token' | 'password'> | null {
  if (!auth || auth.mode === 'trusted-proxy') return null;
  if (
    auth.mode !== undefined &&
    auth.mode !== 'none' &&
    auth.mode !== 'token' &&
    auth.mode !== 'password'
  ) {
    return null;
  }
  if (auth.mode === 'none') return {};
  if (auth.mode === 'token') {
    return validSecret(auth.token) ? { token: auth.token } : null;
  }
  if (auth.mode === 'password') {
    return validSecret(auth.password) ? { password: auth.password } : null;
  }
  return credentialFor(auth);
}

function validatedGatewayUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isTailnetIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

function primaryTailnetIPv4(): string | undefined {
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (!entry.internal && isTailnetIPv4(entry.address)) {
          return entry.address;
        }
      }
    }
  } catch {
    // Network-interface discovery is best-effort. A tailnet-only local
    // Gateway without a discoverable address fails closed.
  }
  return undefined;
}
