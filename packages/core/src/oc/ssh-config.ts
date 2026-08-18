/**
 * Pure parser for OpenSSH client config text.
 *
 * Connect lists the host aliases the operator already keeps in their SSH config
 * so they pick a name instead of retyping an address. The parsed result crosses
 * into the renderer, so it deliberately carries alias NAMES ONLY: the values of
 * HostName, User, IdentityFile, ProxyJump and Port never leave this module.
 * Booleans about which keywords a block declared are enough to tell the
 * operator an alias is fully configured without exporting the infrastructure
 * detail itself.
 *
 * Text in, alias list out. No filesystem, no network, no Node built-ins.
 */

export interface SshHostAlias {
  /** The literal alias token as written in the config. */
  alias: string;
  /** True when the block declared a HostName keyword. Value never captured. */
  hasHostName: boolean;
  /** True when the block declared a User keyword. Value never captured. */
  hasUser: boolean;
  /** True when the block declared an IdentityFile keyword. Value never captured. */
  hasIdentityFile: boolean;
}

export interface SshConfigParseResult {
  aliases: readonly SshHostAlias[];
  /** True when the config delegates to other files Exawatt did not read. */
  hasIncludeDirectives: boolean;
  /** True when input hit a documented bound and parsing stopped early. */
  truncated: boolean;
}

/**
 * Bounds exist because the config is operator-supplied text of unbounded size
 * and the result feeds a picker. Every bound fails closed: the list gets
 * shorter and `truncated` says so, rather than the parser doing unbounded work.
 */
const MAX_CONFIG_CHARS = 1_000_000;
const MAX_LINES = 50_000;
const MAX_ALIASES = 500;
const MAX_ALIAS_LENGTH = 255;

const EMPTY_RESULT: SshConfigParseResult = {
  aliases: [],
  hasIncludeDirectives: false,
  truncated: false,
};

/**
 * Parse host aliases out of `~/.ssh/config` style text.
 *
 * A malformed config degrades to fewer aliases and never throws: the operator's
 * config is theirs to write however they like, and an unparseable line must not
 * be able to take down the Connect flow.
 */
export function parseSshHostAliases(configText: string): SshConfigParseResult {
  if (typeof configText !== 'string' || configText.length === 0) {
    return EMPTY_RESULT;
  }
  if (configText.length > MAX_CONFIG_CHARS) {
    // Refuse the whole document rather than parse a prefix: a partial list of
    // an absurdly large config is more misleading than an explicit bound.
    return { aliases: [], hasIncludeDirectives: false, truncated: true };
  }

  const lines = configText.split(/\r?\n/);
  let truncated = false;
  let lineCount = lines.length;
  if (lineCount > MAX_LINES) {
    lineCount = MAX_LINES;
    truncated = true;
  }

  const byAlias = new Map<string, MutableAlias>();
  const order: MutableAlias[] = [];
  let hasIncludeDirectives = false;

  /** The aliases declared by the Host line that owns the keywords we read. */
  let currentBlock: MutableAlias[] = [];
  /**
   * Match blocks are conditional rules, not declarations. Their keywords belong
   * to whatever the condition selects, so attributing them to the Host block
   * above would claim configuration the alias may never receive.
   */
  let inMatchBlock = false;

  for (let index = 0; index < lineCount; index += 1) {
    const line = stripComment(lines[index] ?? '').trim();
    if (line.length === 0) continue;

    const directive = splitDirective(line);
    if (!directive) continue;

    const keyword = directive.keyword.toLowerCase();

    if (keyword === 'host') {
      inMatchBlock = false;
      currentBlock = [];
      for (const token of tokenize(directive.rest)) {
        if (!isConnectableAlias(token)) continue;
        if (token.length > MAX_ALIAS_LENGTH) {
          // An alias longer than any real hostname is either generated noise or
          // an attempt to smuggle a payload through the picker. Drop it, and
          // admit the list is incomplete.
          truncated = true;
          continue;
        }
        const existing = byAlias.get(token);
        if (existing) {
          currentBlock.push(existing);
          continue;
        }
        if (order.length >= MAX_ALIASES) {
          truncated = true;
          return finish(order, hasIncludeDirectives, truncated);
        }
        const created: MutableAlias = {
          alias: token,
          hasHostName: false,
          hasUser: false,
          hasIdentityFile: false,
        };
        byAlias.set(token, created);
        order.push(created);
        currentBlock.push(created);
      }
      continue;
    }

    if (keyword === 'match') {
      inMatchBlock = true;
      currentBlock = [];
      continue;
    }

    if (keyword === 'include') {
      // Report only that delegation happened. The include paths themselves are
      // filesystem detail the renderer has no business seeing.
      hasIncludeDirectives = true;
      continue;
    }

    if (inMatchBlock || currentBlock.length === 0) continue;

    const flag = KEYWORD_FLAGS[keyword];
    if (!flag) continue;
    for (const alias of currentBlock) {
      // Booleans attach to every alias the owning Host line declared, and OR
      // together so a later block can only add capability, never remove it.
      alias[flag] = true;
    }
  }

  return finish(order, hasIncludeDirectives, truncated);
}

type MutableAlias = {
  -readonly [K in keyof SshHostAlias]: SshHostAlias[K];
};

type AliasFlag = 'hasHostName' | 'hasUser' | 'hasIdentityFile';

/**
 * Only the keywords whose presence tells the operator something about
 * connectability. Every other keyword is ignored outright, which keeps the
 * surface of what this parser can ever expose small and auditable.
 */
const KEYWORD_FLAGS: Readonly<Record<string, AliasFlag | undefined>> = {
  hostname: 'hasHostName',
  user: 'hasUser',
  identityfile: 'hasIdentityFile',
};

function finish(
  order: readonly MutableAlias[],
  hasIncludeDirectives: boolean,
  truncated: boolean
): SshConfigParseResult {
  return {
    aliases: order.map(alias => ({ ...alias })),
    hasIncludeDirectives,
    truncated,
  };
}

/**
 * A `#` starts a comment, but only outside a quoted value: operators do put
 * `#` inside quoted strings and cutting there would corrupt the line into
 * something that parses differently than ssh reads it.
 */
function stripComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === '#' && !quoted) return line.slice(0, index);
  }
  return line;
}

/**
 * Split `Keyword value` and `Keyword=value` alike. OpenSSH accepts either
 * separator, and an operator who writes `HostName=…` expects the same result as
 * one who writes `HostName …`.
 */
function splitDirective(
  line: string
): { keyword: string; rest: string } | null {
  let index = 0;
  while (index < line.length) {
    const char = line[index] as string;
    if (char === '=' || /\s/.test(char)) break;
    index += 1;
  }
  const keyword = line.slice(0, index);
  if (keyword.length === 0) return null;

  let rest = line.slice(index).replace(/^\s+/, '');
  if (rest.startsWith('=')) rest = rest.slice(1).replace(/^\s+/, '');
  return { keyword, rest };
}

/** Whitespace-separated tokens, with double-quoted spans kept intact. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;

  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);

  return tokens.filter(token => token.length > 0);
}

/**
 * Wildcard and negated patterns are matching rules, not destinations. Offering
 * `*` or `!build-box` in a picker would hand the operator a name that cannot be
 * connected to, so they never enter the list.
 */
function isConnectableAlias(token: string): boolean {
  if (token.length === 0) return false;
  if (token.startsWith('!')) return false;
  return !token.includes('*') && !token.includes('?');
}
