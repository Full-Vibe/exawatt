import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJson5 } from 'json5';
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

/**
 * Parse the text of an `openclaw.json`, wherever it was read from.
 *
 * OpenClaw's own loader parses this file as JSON5, so a hand-edited
 * configuration may carry comments, trailing commas, single-quoted strings, or
 * unquoted keys and still be exactly what the Gateway runs with. Both of
 * Exawatt's readers used `JSON.parse` and reported such a file as "could not
 * read the configuration", which sent the operator to check a permission on a
 * file the Gateway was reading fine (BUG-146). This is the one grammar both
 * readers share, so the remote bootstrap and the local read cannot drift.
 *
 * Total by construction: garbage in, null out, never a throw. Only an object
 * comes back; a top-level array or primitive is not a configuration.
 */
export function parseGatewayConfigText(raw: unknown): OCGatewayConfig | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = parseJson5(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as OCGatewayConfig;
}

export function readGatewayConfig(
  stateDir?: string,
  configPath?: string
): OCGatewayConfig | null {
  const resolvedPath =
    configPath ??
    join(stateDir ?? join(homedir(), '.openclaw'), 'openclaw.json');
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf-8');
  } catch {
    return null;
  }
  return parseGatewayConfigText(raw);
}
