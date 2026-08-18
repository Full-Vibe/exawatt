import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { OCGatewayConfig } from './auth';

/**
 * Read one OpenClaw installation's own configuration.
 *
 * This used to carry a second job: turning that config into THE gateway
 * connection, complete with endpoint resolution, bind-mode handling, and
 * credential selection. That job encoded the assumption ENG-010 exists to
 * remove, namely that there is one gateway and local configuration names it.
 * Connections now come from configured sources, each with its own transport,
 * so only the config read survives, and it survives for one caller: resolving
 * a LOCAL source's declared credential without executing anything.
 */
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
