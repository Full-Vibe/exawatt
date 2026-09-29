import path from 'path';

/**
 * The `processKillGuard` safety control (ENG-044): refuse an agent's shell
 * command when a process kill in it would reach beyond the agent's own work.
 *
 * Why it exists (incident `0028`): an agent ran `pkill -f "next start" -f` to
 * stop a dev server. macOS `pkill` stops reading options at the first
 * pattern, so the trailing `-f` became a second pattern, matching every
 * process with `-f` in its arguments. Every Chromium helper carries
 * `--field-trial-handle`, so it killed every browser tab, chat app and
 * Exawatt window on the machine at once.
 *
 * How it decides: the command is split the way a shell splits it (quotes,
 * `;`/`&&`/`|`, `$(…)` and backticks, `sh -c '…'`, `eval`, wrappers such as
 * `sudo` and `xargs`, a path or `\` before the tool name). Every `pkill`,
 * `killall`, and `pgrep` that feeds `kill` is dry-run with its own arguments
 * (`pgrep`, or `killall -s`, both read-only) against one process table, and
 * the command is refused when the processes it would signal include an
 * installed app, a system process, an agent harness (native or run by an
 * interpreter), a process Exawatt protects (itself, any Session), or more
 * than `MAX_MATCHES` processes. Like the real `pkill`, the dry run leaves out
 * the command's own ancestors: the agent's harness and its Session's shell,
 * whose arguments often carry the very pattern the agent is killing. `kill
 * -1`, which signals every process the user owns, is refused outright.
 *
 * What it does when it cannot tell (the guard is on because the operator
 * turned it on, so "could not check" is never read as "nothing to kill"):
 *
 * - A listing that failed (timed out, missing, exited with an error, or an
 *   empty process table) REFUSES, naming the cause. It is transient, so the
 *   agent's retry succeeds; the one command it costs is the price of never
 *   letting the incident-`0028` command through on a loaded machine, which is
 *   exactly when listings run slow.
 * - A target the shell only decides when the command runs (`pkill -f
 *   "$PATTERN"`, a pattern fed through `xargs`) RUNS and is reported as
 *   undecided. Refusing it would refuse the same legitimate script forever,
 *   and a guard that blocks legitimate work on its own limits gets switched
 *   off. `kill $(pgrep …)` is not in this class: its `pgrep` is dry-run.
 * - A command the shell itself cannot parse (an unbalanced quote) runs,
 *   because the shell refuses it before anything is signalled.
 */

export const MAX_MATCHES = 20;

const SYSTEM_PREFIXES = [
  '/Applications/',
  '/System/',
  '/Library/',
  '/usr/libexec/',
  '/usr/sbin/',
  '/sbin/',
];
const HARNESS_NAMES = new Set([
  'claude',
  'codex',
  'opencode',
  'gemini',
  'qwen',
  'grok',
]);
/** npm-installed harnesses run as `node <script>`; the script names them. */
const HARNESS_PACKAGE =
  /node_modules\/(?:@anthropic-ai\/claude-code|@openai\/codex|@google\/gemini-cli|@qwen-code\/qwen-code|opencode-ai|@vibe-kit\/grok-cli)\//;
const INTERPRETERS = /^(?:node|nodejs|bun|deno)(?:[-\d.]*)$/;
const SIGNALS = new Set(
  'HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV SYS PIPE ALRM TERM URG STOP TSTP CONT CHLD TTIN TTOU IO XCPU XFSZ VTALRM PROF WINCH INFO USR1 USR2'.split(
    ' '
  )
);
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
const SHELL = /(?:^|[\s|;&(])(?:ba|z|fi|k|da)?sh\b(?![-\w])/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
/** `pgrep`/`pkill` options that take a value (macOS getopt string). */
const PGREP_VALUE_OPTIONS = new Set(['F', 'G', 'P', 'U', 'd', 'g', 't', 'u']);
/** Output-only options the dry run drops: one pid per line is what it reads. */
const PGREP_OUTPUT_OPTIONS = new Set(['l', 'q', 'I', 'd']);
const MAX_SHELL_DEPTH = 4;

/** The read-only tools the guard runs. */
export type ListingTool = 'pgrep' | 'killall' | 'ps';

/** A listing that ran to completion; its exit status is the tool's answer. */
export interface Listing {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessKillGuardDependencies {
  /** Runs a read-only listing tool. Rejects when the tool could not be run to
   *  completion (missing, timed out, killed): that is not an empty answer. */
  run(tool: ListingTool, args: readonly string[]): Promise<Listing>;
  /** Processes no agent command may take down: Exawatt's own, every
   *  Session's root. */
  protectedPids: ReadonlySet<number>;
  /** The root process of the asking agent's Session, when known. The command
   *  runs beneath it, so it and the harness under it are the command's own
   *  ancestors. */
  sessionRootPid?: number | null;
  /** The operator's home, for `~/Applications`. */
  home: string;
}

/** Part of a command the guard did not judge, and why. */
interface UndecidedInvocation {
  invocation: string;
  cause: string;
}

interface ProcessKillGuardVerdict {
  /** The refusal the agent reads, or null to let the command run. */
  refusal: string | null;
  /** Invocations the guard could not judge. With a refusal, the guard refused
   *  because it could not check; without one, the target is only decided when
   *  the command runs. Either way it is recorded, never silent. */
  undecided: UndecidedInvocation[];
}

/** A listing that did not answer. Never read as "nothing matched". */
export class ListingFailure extends Error {
  constructor(readonly cause: string) {
    super(cause);
    this.name = 'ListingFailure';
  }
}

interface Word {
  text: string;
  /** Holds an expansion the shell performs at run time (`$x`, `$(…)`). */
  dynamic: boolean;
}

type Invocation =
  | { kind: 'dry-run'; tool: 'pkill' | 'pgrep' | 'killall'; args: Word[] }
  | { kind: 'kill-all' }
  | { kind: 'unjudged'; tool: string; args: Word[]; cause: string };

/** The verdict for `command`. */
export async function processKillGuardVerdict(
  command: string,
  deps: ProcessKillGuardDependencies
): Promise<ProcessKillGuardVerdict> {
  const verdict: ProcessKillGuardVerdict = { refusal: null, undecided: [] };
  if (!/\b(?:pkill|killall|pgrep|kill)\b/.test(command)) return verdict;
  const commands = simpleCommands(withoutDataHeredocs(command));
  if (!commands) return verdict;
  const invocations = killInvocations(commands);
  // A `pgrep` only matters when its pids reach a `kill`, at any depth.
  const feedsKill = /\bkill\b/.test(command);

  const reasons: string[] = [];
  const failures: string[] = [];
  const dryRuns: Array<Extract<Invocation, { kind: 'dry-run' }>> = [];
  const seen = new Set<string>();
  for (const invocation of invocations) {
    if (invocation.kind === 'kill-all') {
      if (!seen.has('kill -1')) {
        seen.add('kill -1');
        reasons.push('`kill -1` signals every process you own');
      }
      continue;
    }
    if (invocation.tool === 'pgrep' && !feedsKill) continue;
    const display = displayOf(invocation.tool, invocation.args);
    if (seen.has(display)) continue;
    seen.add(display);
    if (invocation.kind === 'unjudged') {
      verdict.undecided.push({ invocation: display, cause: invocation.cause });
      continue;
    }
    dryRuns.push(invocation);
  }

  if (dryRuns.length > 0) {
    // One process table, read alongside the dry runs: the whole check stays
    // inside one listing timeout, well under the harness's hook timeout.
    const table = readProcessTable(deps);
    table.catch(() => undefined);
    const outcomes = await Promise.all(
      dryRuns.map(async invocation => {
        const display = displayOf(invocation.tool, invocation.args);
        try {
          const matched = await dryRun(invocation, deps);
          if (matched.pids.length === 0) return { display };
          return { display, reason: judge(matched, await table, deps) };
        } catch (error) {
          const cause =
            error instanceof ListingFailure
              ? error.cause
              : 'the check itself failed';
          return { display, cause };
        }
      })
    );
    for (const { display, reason, cause } of outcomes as Array<{
      display: string;
      reason?: string | null;
      cause?: string;
    }>) {
      if (reason) reasons.push(`\`${display}\`: ${reason}`);
      if (cause) {
        verdict.undecided.push({ invocation: display, cause });
        failures.push(`\`${display}\` (${cause})`);
      }
    }
  }

  if (reasons.length > 0) {
    verdict.refusal =
      `Blocked by Exawatt's process-kill safety control: ${reasons.join('; ')}. ` +
      'macOS pkill treats every argument after the first pattern as another ' +
      'pattern, so a trailing `-f` matches anything with "-f" in its command ' +
      'line. Stop only what you started: by port listener (`lsof -tiTCP:<port> ' +
      '-sTCP:LISTEN | xargs kill`), by a PID you recorded, or with a pattern ' +
      "anchored to your own path. Preview with `pgrep -fl '<pattern>'` first, " +
      'with every option before the pattern.';
  } else if (failures.length > 0) {
    verdict.refusal =
      `Exawatt's process-kill safety control could not check ${failures.join('; ')}, ` +
      'so the command did not run. Run it again. If the check keeps failing, ' +
      'stop the process by its port listener (`lsof -tiTCP:<port> ' +
      '-sTCP:LISTEN | xargs kill`) or by a PID you recorded.';
  }
  return verdict;
}

/** A heredoc body is data unless the command reading it is a shell. */
export function withoutDataHeredocs(command: string): string {
  const lines = command.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i++];
    kept.push(line);
    const opened = HEREDOC.exec(line);
    if (!opened) continue;
    const body: string[] = [];
    while (i < lines.length && lines[i].replace(/^\t+/, '') !== opened[2]) {
      body.push(lines[i++]);
    }
    i += 1;
    if (SHELL.test(line.slice(0, opened.index))) kept.push(...body);
  }
  return kept.join('\n');
}

/** POSIX word splitting for one invocation's arguments; null when the quoting
 *  is unbalanced. */
export function shellWords(text: string): string[] | null {
  const commands = simpleCommands(text);
  if (!commands) return null;
  return commands.flatMap(words => words.map(word => word.text));
}

/**
 * The simple commands in `text`, split the way a POSIX shell splits them:
 * quotes, escapes, separators (`;`, `&&`, `||`, `|`, `&`, newlines,
 * subshell parentheses) and redirections, which belong to the shell and are
 * dropped. A command substitution (`$(…)`, backticks, `<(…)`) contributes its
 * own commands, and the word holding it is marked dynamic. Null when quoting
 * or a substitution is unbalanced: the shell refuses such a command itself.
 */
function simpleCommands(text: string): Word[][] | null {
  const out: Word[][] = [];
  return scan(text, 0, null, out) === null ? null : out;
}

function scan(
  text: string,
  start: number,
  close: ')' | '`' | null,
  out: Word[][]
): number | null {
  let words: Word[] = [];
  let word = '';
  let inWord = false;
  let dynamic = false;
  let dropNextWord = false;
  let depth = 0;
  const finishWord = () => {
    if (inWord) {
      if (dropNextWord) dropNextWord = false;
      else words.push({ text: word, dynamic });
    }
    word = '';
    inWord = false;
    dynamic = false;
  };
  const finishCommand = () => {
    finishWord();
    dropNextWord = false;
    if (words.length > 0) out.push(words);
    words = [];
  };
  const substitute = (from: number, until: ')' | '`'): number | null => {
    dynamic = true;
    inWord = true;
    return scan(text, from, until, out);
  };

  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (close === '`' && c === '`') {
      finishCommand();
      return i + 1;
    }
    if (c === ' ' || c === '\t') {
      finishWord();
      i += 1;
    } else if (c === '\n') {
      finishCommand();
      i += 1;
    } else if (c === '#' && !inWord) {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '&' && text[i + 1] === '>') {
      finishWord();
      i += text[i + 2] === '>' ? 3 : 2;
      dropNextWord = true;
    } else if (c === ';' || c === '|' || c === '&') {
      finishCommand();
      i += 1;
      while (text[i] === c || (c === '|' && text[i] === '&')) i += 1;
    } else if ((c === '<' || c === '>') && text[i + 1] === '(') {
      finishWord();
      const end = scan(text, i + 2, ')', out);
      if (end === null) return null;
      i = end;
    } else if (c === '<' || c === '>') {
      // `2>` names a descriptor, not an argument.
      if (inWord && /^\d+$/.test(word) && !dynamic) {
        word = '';
        inWord = false;
      } else {
        finishWord();
      }
      while (text[i] === '<' || text[i] === '>') i += 1;
      if (text[i] === '&' || text[i] === '|') i += 1;
      if (/[\d-]/.test(text[i] ?? '') && text[i - 1] === '&') {
        while (/[\d-]/.test(text[i] ?? '')) i += 1;
      } else {
        dropNextWord = true;
      }
    } else if (c === '(') {
      finishCommand();
      depth += 1;
      i += 1;
    } else if (c === ')') {
      finishCommand();
      i += 1;
      if (depth === 0) {
        if (close === ')') return i;
      } else {
        depth -= 1;
      }
    } else if (c === '\\') {
      if (text[i + 1] === '\n') {
        i += 2;
        continue;
      }
      if (i + 1 < text.length) word += text[i + 1];
      inWord = true;
      i += 2;
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      word += text.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (c === '"') {
      inWord = true;
      i += 1;
      for (;;) {
        if (i >= text.length) return null;
        const q = text[i];
        if (q === '"') {
          i += 1;
          break;
        }
        if (
          q === '\\' &&
          i + 1 < text.length &&
          '"\\$`\n'.includes(text[i + 1])
        ) {
          word += text[i + 1];
          i += 2;
        } else if (q === '$' && text[i + 1] === '(') {
          const end = substitute(i + 2, ')');
          if (end === null) return null;
          i = end;
        } else if (q === '`') {
          const end = substitute(i + 1, '`');
          if (end === null) return null;
          i = end;
        } else {
          if (q === '$') dynamic = true;
          word += q;
          i += 1;
        }
      }
    } else if (c === '$' && text[i + 1] === '(') {
      const end = substitute(i + 2, ')');
      if (end === null) return null;
      i = end;
    } else if (c === '$' && text[i + 1] === "'") {
      const end = text.indexOf("'", i + 2);
      if (end < 0) return null;
      word += text.slice(i + 2, end);
      inWord = true;
      i = end + 1;
    } else if (c === '`') {
      const end = substitute(i + 1, '`');
      if (end === null) return null;
      i = end;
    } else {
      if (c === '$') dynamic = true;
      word += c;
      inWord = true;
      i += 1;
    }
  }
  if (close !== null) return null;
  finishCommand();
  return i;
}

const PREFIX_WORDS = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'time',
  'exec',
  'command',
  'builtin',
  'nohup',
  'noglob',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Wrappers that run the rest of their arguments as a command, with the
 *  options of each that take a value. */
const WRAPPERS: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T']),
  env: new Set(['-u', '-P']),
  nice: new Set(['-n']),
  timeout: new Set(['-s', '-k']),
  gtimeout: new Set(['-s', '-k']),
  xargs: new Set(['-E', '-I', '-J', '-L', '-n', '-P', '-R', '-S', '-s']),
};

interface Head {
  /** The command's own name, without its directory or a leading `\`. */
  text: string;
  dynamic: boolean;
  args: Word[];
  /** `xargs` appends stdin to the arguments. */
  fedByXargs: boolean;
}

function headOf(words: readonly Word[]): Head | null {
  let i = 0;
  let fedByXargs = false;
  for (;;) {
    const word = words[i];
    if (!word) return null;
    if (PREFIX_WORDS.has(word.text) || ASSIGNMENT.test(word.text)) {
      i += 1;
      continue;
    }
    const name = path.basename(word.text);
    const valueOptions = WRAPPERS[name];
    if (!valueOptions || word.dynamic) {
      return {
        text: name,
        dynamic: word.dynamic,
        args: words.slice(i + 1),
        fedByXargs,
      };
    }
    if (name === 'xargs') fedByXargs = true;
    i += 1;
    while (words[i]) {
      const option = words[i].text;
      if (option === '--') {
        i += 1;
        break;
      }
      if (ASSIGNMENT.test(option) && name === 'env') {
        i += 1;
        continue;
      }
      if (!option.startsWith('-') || option === '-') break;
      i += valueOptions.has(option) ? 2 : 1;
    }
    // `timeout 5 pkill …`: the duration comes before the command.
    if ((name === 'timeout' || name === 'gtimeout') && words[i]) i += 1;
  }
}

function killInvocations(commands: Word[][], depth = 0): Invocation[] {
  const found: Invocation[] = [];
  for (const words of commands) {
    const head = headOf(words);
    if (!head || head.dynamic) continue;
    const { text: tool, args } = head;
    if (tool === 'pkill' || tool === 'pgrep' || tool === 'killall') {
      if (head.fedByXargs) {
        found.push({
          kind: 'unjudged',
          tool,
          args,
          cause: 'xargs supplies its arguments when it runs',
        });
      } else if (args.some(arg => arg.dynamic)) {
        found.push({
          kind: 'unjudged',
          tool,
          args,
          cause: 'the shell expands its arguments when it runs',
        });
      } else {
        found.push({ kind: 'dry-run', tool, args });
      }
    } else if (tool === 'kill') {
      if (signalsEveryProcess(args)) found.push({ kind: 'kill-all' });
    } else if (
      depth < MAX_SHELL_DEPTH &&
      (SHELLS.has(tool) || tool === 'eval')
    ) {
      const script =
        tool === 'eval'
          ? args.map(arg => arg.text).join(' ')
          : shellScriptOf(args);
      if (script === null) continue;
      const nested = simpleCommands(withoutDataHeredocs(script));
      if (nested) found.push(...killInvocations(nested, depth + 1));
    }
  }
  return found;
}

/** `bash -c '<script>' …`: the first operand after an option cluster with
 *  `c` in it. */
function shellScriptOf(args: readonly Word[]): string | null {
  let command = false;
  let i = 0;
  for (; i < args.length; i += 1) {
    const option = args[i].text;
    if (option === '--' || option === '-') {
      i += 1;
      break;
    }
    if (/^--[a-z][a-z-]*$/.test(option)) continue;
    if (!/^[-+][A-Za-z]+$/.test(option)) break;
    if (option.includes('c')) command = true;
    if (option.endsWith('o') && option.length === 2) i += 1;
  }
  return command && args[i] ? args[i].text : null;
}

/** `kill [-s SIG | -SIG | -n N] [--] -1 …`. */
function signalsEveryProcess(args: readonly Word[]): boolean {
  // `kill -1` alone names signal 1 and no process: a usage error.
  if (args.length === 1 && args[0].text === '-1') return false;
  let i = 0;
  if (args[0]?.text === '-s' || args[0]?.text === '-n') i = 2;
  else if (args.length > 1 && isSignal(args[0].text)) i = 1;
  if (args[i]?.text === '--') i += 1;
  return args.slice(i).some(arg => arg.text === '-1');
}

function isSignal(word: string): boolean {
  if (!word.startsWith('-') || word.length < 2) return false;
  const body = word.slice(1);
  if (/^\d+$/.test(body)) return true;
  const name = body.toUpperCase();
  return SIGNALS.has(name.startsWith('SIG') ? name.slice(3) : name);
}

function displayOf(tool: string, args: readonly Word[]): string {
  return [tool, ...args.map(arg => quoted(arg.text))].join(' ');
}

function quoted(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text)
    ? text
    : `'${text.replace(/'/g, `'\\''`)}'`;
}

interface Matched {
  pids: number[];
  /** `-a`/`-v`: the real invocation also matches its own ancestors. */
  includesAncestors: boolean;
}

async function dryRun(
  invocation: Extract<Invocation, { kind: 'dry-run' }>,
  deps: ProcessKillGuardDependencies
): Promise<Matched> {
  const args = invocation.args.map(arg => arg.text);
  if (invocation.tool === 'killall') {
    const listing = await deps.run('killall', [
      '-s',
      ...args.filter(arg => arg !== '-s'),
    ]);
    if (
      listing.exitCode === 1 &&
      /no matching processes/i.test(listing.stderr)
    ) {
      return { pids: [], includesAncestors: true };
    }
    if (listing.exitCode !== 0) throw exited('killall', listing);
    return {
      pids: [...listing.stdout.matchAll(/^kill\s+-\S+\s+(\d+)/gm)].map(m =>
        Number(m[1])
      ),
      includesAncestors: true,
    };
  }
  const { argv, includesAncestors } = pgrepArgv(invocation.tool, args);
  const listing = await deps.run('pgrep', argv);
  if (listing.exitCode === 1) return { pids: [], includesAncestors };
  if (listing.exitCode !== 0) throw exited('pgrep', listing);
  // One pid per line: only a line's first field is a pid.
  const pids = listing.stdout
    .split('\n')
    .map(line => /^\s*(\d+)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => Number(match[1]));
  if (pids.length === 0)
    throw new ListingFailure('pgrep matched but listed no pids');
  return { pids, includesAncestors };
}

/**
 * The `pgrep` argv that lists what the invocation would signal: the same
 * selection, with `pkill`'s signal and every output-only option removed so
 * the answer is one pid per line. Options end at the first pattern, exactly
 * as macOS getopt reads them, so a trailing `-f` stays a pattern.
 */
export function pgrepArgv(
  tool: 'pkill' | 'pgrep',
  args: readonly string[]
): { argv: string[]; includesAncestors: boolean } {
  const argv: string[] = [];
  let includesAncestors = false;
  let i =
    tool === 'pkill' && args[0] !== undefined && isSignal(args[0]) ? 1 : 0;
  for (; i < args.length; i += 1) {
    const word = args[i];
    if (word === '--') break;
    if (!word.startsWith('-') || word === '-') break;
    const kept: string[] = [];
    const cluster = word.slice(1);
    for (let j = 0; j < cluster.length; j += 1) {
      const flag = cluster[j];
      if (PGREP_VALUE_OPTIONS.has(flag)) {
        const inline = cluster.slice(j + 1);
        const value = inline || args[++i];
        if (flag !== 'd') {
          if (kept.length) argv.push(`-${kept.join('')}`);
          kept.length = 0;
          argv.push(`-${flag}`);
          if (value !== undefined) argv.push(value);
        }
        break;
      }
      if (PGREP_OUTPUT_OPTIONS.has(flag)) continue;
      if (flag === 'a' || flag === 'v') includesAncestors = true;
      kept.push(flag);
    }
    if (kept.length) argv.push(`-${kept.join('')}`);
  }
  argv.push(...args.slice(i));
  return { argv, includesAncestors };
}

function exited(tool: ListingTool, listing: Listing): ListingFailure {
  const detail = listing.stderr.trim().split('\n')[0];
  return new ListingFailure(
    `${tool} exited ${listing.exitCode}${detail ? `: ${detail}` : ''}`
  );
}

interface ProcessRow {
  pid: number;
  ppid: number;
  executable: string;
  args: string;
}

async function readProcessTable(
  deps: ProcessKillGuardDependencies
): Promise<Map<number, ProcessRow>> {
  const [tree, commandLines] = await Promise.all([
    deps.run('ps', ['-axww', '-o', 'pid=,ppid=,comm=']),
    deps.run('ps', ['-axww', '-o', 'pid=,args=']),
  ]);
  if (tree.exitCode !== 0) throw exited('ps', tree);
  if (commandLines.exitCode !== 0) throw exited('ps', commandLines);
  const argsOf = new Map<number, string>();
  for (const line of commandLines.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*?)\s*$/.exec(line);
    if (match) argsOf.set(Number(match[1]), match[2]);
  }
  const table = new Map<number, ProcessRow>();
  for (const line of tree.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    table.set(pid, {
      pid,
      ppid: Number(match[2]),
      executable: match[3],
      args: argsOf.get(pid) ?? '',
    });
  }
  // A machine always has processes: an empty table is a failed read.
  if (table.size === 0) throw new ListingFailure('ps listed no processes');
  return table;
}

function isHarness(row: ProcessRow): boolean {
  if (HARNESS_NAMES.has(path.basename(row.executable))) return true;
  const [argv0 = '', script = ''] = row.args.split(/\s+/);
  if (HARNESS_NAMES.has(path.basename(argv0))) return true;
  if (!INTERPRETERS.test(path.basename(row.executable))) return false;
  return (
    HARNESS_NAMES.has(path.basename(script)) || HARNESS_PACKAGE.test(row.args)
  );
}

/**
 * The command's own ancestors, which the real `pkill` never matches: the
 * Session's root and everything above it, and the path from that root down
 * to each harness under it (the agent's shell tool runs beneath one).
 */
function commandAncestors(
  table: ReadonlyMap<number, ProcessRow>,
  root: number | null | undefined
): Set<number> {
  const ancestors = new Set<number>();
  if (root == null || !table.has(root)) return ancestors;
  for (
    let pid: number | undefined = root;
    pid !== undefined && pid > 0 && !ancestors.has(pid);
    pid = table.get(pid)?.ppid
  ) {
    ancestors.add(pid);
  }
  const children = new Map<number, number[]>();
  for (const row of table.values()) {
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const stack = [...(children.get(root) ?? [])];
  const visited = new Set<number>();
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const row = table.get(pid)!;
    if (isHarness(row)) {
      for (
        let up: number | undefined = pid;
        up !== undefined && !ancestors.has(up);
        up = table.get(up)?.ppid
      ) {
        ancestors.add(up);
      }
    }
    stack.push(...(children.get(pid) ?? []));
  }
  return ancestors;
}

function judge(
  matched: Matched,
  table: ReadonlyMap<number, ProcessRow>,
  deps: ProcessKillGuardDependencies
): string | null {
  const ancestors = matched.includesAncestors
    ? new Set<number>()
    : commandAncestors(table, deps.sessionRootPid);
  const targets = matched.pids.filter(pid => !ancestors.has(pid));
  if (targets.length === 0) return null;
  const prefixes = [
    ...SYSTEM_PREFIXES,
    path.join(deps.home, 'Applications') + '/',
  ];
  const counts = new Map<string, number>();
  let protectedCount = 0;
  for (const pid of targets) {
    const row = table.get(pid);
    const name = row ? path.basename(row.executable) : `pid ${pid}`;
    if (
      deps.protectedPids.has(pid) ||
      (row &&
        (prefixes.some(prefix => row.executable.startsWith(prefix)) ||
          isHarness(row)))
    ) {
      protectedCount += 1;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (protectedCount > 0) {
    const named = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => (count > 1 ? `${name} x${count}` : name))
      .join(', ');
    return `it would also kill ${protectedCount} process(es) outside your work, including: ${named}`;
  }
  // Counted on what the dry run matched, not on what the table still lists.
  if (targets.length > MAX_MATCHES) {
    return `the pattern matches ${targets.length} processes, far more than one task's own`;
  }
  return null;
}
