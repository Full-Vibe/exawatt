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
 * How it decides: every `pkill`, `killall`, and `pgrep` that feeds `kill` is
 * dry-run with its own arguments (`pgrep`, or `killall -s`, both read-only),
 * and the command is refused when the match set includes an installed app, a
 * system process, an agent harness, a process Exawatt protects (itself, the
 * agent's own session), or more than `MAX_MATCHES` processes. `kill -1`, which
 * signals every process the user owns, is refused outright.
 *
 * It fails open. A command it cannot parse or dry-run honestly (an unexpanded
 * `$VAR`, an unbalanced quote, a listing that failed) runs, because a guard
 * that blocks legitimate work on its own limits gets switched off.
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
const SIGNALS = new Set(
  'HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV SYS PIPE ALRM TERM URG STOP TSTP CONT CHLD TTIN TTOU IO XCPU XFSZ VTALRM PROF WINCH INFO USR1 USR2'.split(
    ' '
  )
);
/** One invocation, up to a shell separator or the end of a substitution. */
const INVOCATION =
  /(?:^|[\s;&|(`])(?:sudo\s+)?(pkill|pgrep|killall)\b([^;&|)`\n]*)/g;
const KILL_ALL = /(?:^|[\s;&|(`])kill\s+(?:-\S+\s+)*(?:--\s+)?-1(?![\w])/;
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
const SHELL = /(?:^|[\s|;&(])(?:ba|z|fi|k|da)?sh\b(?![-\w])/;
const REDIRECT = /^(\d*|&)(>>?|<)(.*)$/;

export interface ProcessKillGuardDependencies {
  /** Runs a read-only listing tool; resolves its stdout, or '' on any failure. */
  run(command: string, args: readonly string[]): Promise<string>;
  /** Processes no agent command may take down: Exawatt's own, the agent's
   *  own session shell. */
  protectedPids: ReadonlySet<number>;
  /** The operator's home, for `~/Applications`. */
  home: string;
}

/** The reason to refuse `command`, or null to let it run. */
export async function processKillGuardVerdict(
  command: string,
  deps: ProcessKillGuardDependencies
): Promise<string | null> {
  if (!/\b(?:pkill|killall|pgrep|kill)\b/.test(command)) return null;
  const scanned = withoutDataHeredocs(command);
  const reasons: string[] = [];
  if (KILL_ALL.test(scanned)) {
    reasons.push('`kill -1` signals every process you own');
  }
  const feedsKill = /\bkill\b/.test(scanned);
  for (const match of scanned.matchAll(INVOCATION)) {
    const tool = match[1] as 'pkill' | 'pgrep' | 'killall';
    const rest = match[2];
    if (tool === 'pgrep' && !feedsKill) continue;
    const words = shellWords(rest);
    if (!words) continue;
    const args = withoutRedirections(words);
    if (args.some(arg => arg.includes('$') || arg.includes('`'))) continue;
    const pids =
      tool === 'killall'
        ? await killallTargets(args, deps)
        : await pgrepTargets(tool, args, deps);
    const reason = await verdictFor(pids, deps);
    if (reason) reasons.push(`\`${tool}${rest.trimEnd()}\`: ${reason}`);
  }
  if (reasons.length === 0) return null;
  return (
    `Blocked by Exawatt's process-kill safety control: ${reasons.join('; ')}. ` +
    'macOS pkill treats every argument after the first pattern as another ' +
    'pattern, so a trailing `-f` matches anything with "-f" in its command ' +
    'line. Stop only what you started: by port listener (`lsof -tiTCP:<port> ' +
    '-sTCP:LISTEN | xargs kill`), by a PID you recorded, or with a pattern ' +
    "anchored to your own path. Preview with `pgrep -fl '<pattern>'` first, " +
    'with every option before the pattern.'
  );
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
 *  is unbalanced, which the guard treats as "cannot judge, let it run". */
export function shellWords(text: string): string[] | null {
  const words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && i + 1 < text.length) word += text[++i];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === '\\' && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (quote) return null;
  if (inWord) words.push(word);
  return words;
}

/** `2>/dev/null` belongs to the shell, not the pattern list. */
function withoutRedirections(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const redirect = REDIRECT.exec(words[i]);
    if (!redirect) {
      out.push(words[i]);
      continue;
    }
    if (redirect[3] === '') i += 1;
  }
  return out;
}

function isSignal(word: string): boolean {
  if (!word.startsWith('-') || word.length < 2) return false;
  const body = word.slice(1);
  if (/^\d+$/.test(body)) return true;
  const name = body.toUpperCase();
  return SIGNALS.has(name.startsWith('SIG') ? name.slice(3) : name);
}

function numbers(text: string): number[] {
  return text
    .split(/\s+/)
    .filter(word => /^\d+$/.test(word))
    .map(Number);
}

async function pgrepTargets(
  tool: 'pkill' | 'pgrep',
  args: readonly string[],
  deps: ProcessKillGuardDependencies
): Promise<number[]> {
  const argv = args.filter(
    (arg, index) =>
      !(tool === 'pkill' && index === 0 && isSignal(arg)) && arg !== '-I'
  );
  if (argv.length === 0) return [];
  return numbers(await deps.run('pgrep', argv));
}

/** `killall -s` prints `kill -SIG <pid>` for what it WOULD do. */
async function killallTargets(
  args: readonly string[],
  deps: ProcessKillGuardDependencies
): Promise<number[]> {
  const text = await deps.run('killall', [
    '-s',
    ...args.filter(arg => arg !== '-s'),
  ]);
  return [...text.matchAll(/^kill\s+-\S+\s+(\d+)/gm)].map(m => Number(m[1]));
}

async function verdictFor(
  pids: readonly number[],
  deps: ProcessKillGuardDependencies
): Promise<string | null> {
  if (pids.length === 0) return null;
  const listing = await deps.run('ps', [
    '-o',
    'pid=,comm=',
    '-p',
    pids.join(','),
  ]);
  const processes = listing
    .split('\n')
    .map(line => /^\s*(\d+)\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ pid: Number(match[1]), executable: match[2] }));
  const prefixes = [
    ...SYSTEM_PREFIXES,
    path.join(deps.home, 'Applications') + '/',
  ];
  const counts = new Map<string, number>();
  let protectedCount = 0;
  for (const { pid, executable } of processes) {
    const name = path.basename(executable);
    if (
      prefixes.some(prefix => executable.startsWith(prefix)) ||
      HARNESS_NAMES.has(name) ||
      deps.protectedPids.has(pid)
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
  if (processes.length > MAX_MATCHES) {
    return `the pattern matches ${processes.length} processes, far more than one task's own`;
  }
  return null;
}
