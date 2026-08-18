import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseSshHostAliases, type SshHostAlias } from '@exawatt/core';

/**
 * Passive SSH alias enumeration (ENG-010 C1).
 *
 * Connect lists the servers the operator can already reach so nobody has to
 * type an IP. "Passive" is the whole contract: this module reads config TEXT
 * and nothing else. It never opens a connection, never runs `ssh`, never
 * touches a private key, and never resolves a hostname. Selecting an alias is
 * what authorizes contact, and that happens elsewhere.
 *
 * The parsed result is renderer-bound, so it carries alias names and keyword
 * presence only. `parseSshHostAliases` enforces that; this module's job is to
 * find the text and expand `Include`.
 */

/** OpenSSH resolves Include relative to ~/.ssh when the path is not absolute. */
function defaultLocations(): SshConfigLocations {
  const sshDir = path.join(os.homedir(), '.ssh');
  return {
    configPath: path.join(sshDir, 'config'),
    sshDir,
    homeDir: os.homedir(),
  };
}

export interface SshConfigLocations {
  configPath: string;
  /** Root for relative Include targets. */
  sshDir: string;
  /** Root for `~`-prefixed Include targets. */
  homeDir: string;
}

/** Include can nest. Bound it so a cyclic config cannot spin. */
const MAX_INCLUDE_DEPTH = 8;
const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export interface SshAliasCandidates {
  aliases: readonly SshHostAlias[];
  /** True when a config file exists at all. False means nothing to offer. */
  configPresent: boolean;
  /** True when some Include target could not be read. */
  incompleteIncludes: boolean;
}

function readTextFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_TOTAL_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Expand `Include` directives into one text blob.
 *
 * Globs are expanded manually rather than through a glob library because the
 * only patterns that matter here are the ordinary `config.d/*` shapes, and a
 * dependency that walks the filesystem on a renderer-triggered call is a
 * larger surface than the feature deserves.
 */
function collectConfigText(
  file: string,
  depth: number,
  seen: Set<string>,
  state: { bytes: number; incomplete: boolean },
  locations: SshConfigLocations
): string {
  if (depth > MAX_INCLUDE_DEPTH || seen.size >= MAX_FILES) {
    state.incomplete = true;
    return '';
  }
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return '';
  seen.add(resolved);

  const text = readTextFile(resolved);
  if (text === null) {
    state.incomplete = true;
    return '';
  }
  state.bytes += text.length;
  if (state.bytes > MAX_TOTAL_BYTES) {
    state.incomplete = true;
    return text;
  }

  const parts: string[] = [text];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*include\s+(.+?)\s*$/i.exec(line);
    if (!match) continue;
    for (const token of match[1].split(/\s+/)) {
      const cleaned = token.replace(/^["']|["']$/g, '');
      if (!cleaned) continue;
      for (const target of expandIncludeTarget(cleaned, locations)) {
        parts.push(
          collectConfigText(target, depth + 1, seen, state, locations)
        );
      }
    }
  }
  return parts.join('\n');
}

function expandIncludeTarget(
  token: string,
  locations: SshConfigLocations
): string[] {
  const base = token.startsWith('~')
    ? path.join(locations.homeDir, token.slice(1))
    : path.isAbsolute(token)
      ? token
      : path.join(locations.sshDir, token);

  if (!base.includes('*') && !base.includes('?')) return [base];

  const dir = path.dirname(base);
  const pattern = path.basename(base);
  const regex = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`
  );
  try {
    return fs
      .readdirSync(dir)
      .filter(entry => regex.test(entry))
      .sort()
      .map(entry => path.join(dir, entry));
  } catch {
    return [];
  }
}

/**
 * Read the operator's SSH configuration and return the aliases Connect may
 * offer. A missing config is an ordinary answer, not an error: plenty of
 * machines have none, and those operators enter a server manually instead.
 */
export function readSshAliasCandidates(
  overrides: Partial<SshConfigLocations> = {}
): SshAliasCandidates {
  const locations = { ...defaultLocations(), ...overrides };
  const state = { bytes: 0, incomplete: false };
  if (!fs.existsSync(locations.configPath)) {
    return { aliases: [], configPresent: false, incompleteIncludes: false };
  }
  const text = collectConfigText(
    locations.configPath,
    0,
    new Set(),
    state,
    locations
  );
  const parsed = parseSshHostAliases(text);
  return {
    aliases: parsed.aliases,
    configPresent: true,
    incompleteIncludes: state.incomplete || parsed.truncated,
  };
}
