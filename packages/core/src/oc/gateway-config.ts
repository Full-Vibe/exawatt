import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OCGatewayConfig } from './auth';

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

export function readGatewayToken(stateDir?: string): string | null {
  const config = readGatewayConfig(stateDir);
  return config?.gateway?.auth?.token ?? null;
}
