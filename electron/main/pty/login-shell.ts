import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ONE owner for "run something through the operator's LOGIN shell".
 *
 * Every Agent launch, source probe, model-catalog read, resume scan and recap
 * runs the operator's own shell so PATH resolves the way his terminal does.
 * That means Exawatt executes ARBITRARY USER CODE — `config.fish`, `.zprofile`,
 * every completion those files source — far more often than the operator does,
 * and until this module existed it did so from eight hand-built copies of
 * `['-l', '-c', command]`.
 *
 * Two contracts were duplicated in those copies, and both had a defect:
 *
 * 1. **Invocation.** `-l -c` is not universal. tcsh/csh document `-l` as usable
 *    "only alone", so a combined form fails outright; PowerShell spells the
 *    same idea `-Login -Command`. Eight copies of an OS invocation contract is
 *    the structural reason a wrong one can exist.
 *
 * 2. **Working directory — the one that produced incident `0006`.** A shell
 *    runs its startup files in the directory it was SPAWNED in, before it runs
 *    anything Exawatt asked for. Spawning in a Project therefore executes the
 *    operator's startup code inside his repository, and any side effect lands
 *    there. On this machine OpenClaw's generated `openclaw.fish` (sourced from
 *    `config.fish`) contains three lines reading
 *    `complete -c openclaw -n "…" -s > -l trigger-script -d '…'`; fish parses
 *    `> -l` as an output redirection and creates a zero-byte `./-l` at startup.
 *    That is the file that "keeps appearing in repositories opened through
 *    Exawatt" — and it is NOT caused by the `-l` login flag: a non-login
 *    `fish -c true` creates it too (verified 2026-08-16).
 *
 *    So the rule this module enforces is: **startup files never execute inside
 *    a Project.** The shell is spawned in an Exawatt-owned scratch directory
 *    and enters the Project only AFTER its startup has finished — as a `cd`
 *    prefix on the command, or through fish's `-C` (documented to evaluate
 *    "after reading the configuration") for an interactive shell.
 *
 * Nothing here fixes the operator's malformed completion; Exawatt does not own
 * his dotfiles. It stops Exawatt being the delivery vehicle, and it does so for
 * every startup side effect, not for this one file.
 */

/** Families differ in how a login shell is asked to run one command. */
export type LoginShellFamily = 'fish' | 'csh' | 'powershell' | 'posix';

export function loginShellFamily(shellPath: string): LoginShellFamily {
  const name = path
    .basename(shellPath)
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (name === 'fish') return 'fish';
  if (name === 'csh' || name === 'tcsh') return 'csh';
  if (name === 'pwsh' || name === 'powershell') return 'powershell';
  return 'posix';
}

/**
 * POSIX single-quoting. Also correct for fish, which concatenates adjacent
 * quoted words exactly as sh does, and is used for csh (whose quoting rules
 * agree for the single-quote case).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** PowerShell single-quoting doubles the quote instead of escaping it. */
function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

export interface LoginShellPlan {
  /** argv for `spawn`/`execFile`/`pty.spawn`. Never a shell string, never
   *  `shell: true` — a re-parsed argv is how a flag becomes a redirect. */
  args: string[];
  /** Directory the process is SPAWNED in, i.e. where startup files run. */
  cwd: string;
  /**
   * True when startup ran outside `directory` and the shell entered it
   * afterwards. False means the family offers no post-startup entry point and
   * the shell was spawned in `directory` directly, so its startup side effects
   * still land there.
   */
  startupIsolated: boolean;
}

export interface LoginShellRequest {
  /** Command to run non-interactively. Omit for an interactive login shell. */
  command?: string | null;
  /** Directory the work must happen in. Omit to run in the scratch directory. */
  directory?: string | null;
  /** Overrides the configured scratch root; tests pass their own. */
  scratchDir?: string;
}

/**
 * Enter `directory` as the first thing the command does, so a failure to enter
 * it stops the command rather than silently running it somewhere else.
 */
function enterDirectory(family: LoginShellFamily, directory: string): string {
  switch (family) {
    case 'powershell':
      return `Set-Location -LiteralPath ${powershellQuote(directory)}; if (-not $?) { exit 1 }`;
    case 'csh':
      return `cd ${shellQuote(directory)} || exit 1`;
    case 'fish':
    case 'posix':
      return `cd -- ${shellQuote(directory)} || exit 1`;
  }
}

export function planLoginShell(
  shell: string,
  request: LoginShellRequest = {}
): LoginShellPlan {
  const family = loginShellFamily(shell);
  const scratch = request.scratchDir ?? ensureScratchDir();
  const directory = request.directory ?? null;
  const command = request.command ?? null;

  if (command !== null) {
    const full = directory
      ? `${enterDirectory(family, directory)}\n${command}`
      : command;
    return {
      args: commandArgs(family, full),
      cwd: scratch,
      startupIsolated: true,
    };
  }

  // Interactive login shell. Only fish exposes an init command that runs after
  // its configuration, so only fish can keep startup out of the Project.
  if (directory && family === 'fish') {
    return {
      args: ['-l', '-C', enterDirectoryInteractive(directory)],
      cwd: scratch,
      startupIsolated: true,
    };
  }
  return {
    args: family === 'powershell' ? ['-Login'] : ['-l'],
    cwd: directory ?? scratch,
    startupIsolated: directory === null,
  };
}

/** An interactive shell must not exit when `cd` fails; it just stays put. */
function enterDirectoryInteractive(directory: string): string {
  return `cd -- ${shellQuote(directory)}`;
}

function commandArgs(family: LoginShellFamily, command: string): string[] {
  switch (family) {
    case 'powershell':
      return ['-Login', '-Command', command];
    // tcsh/csh document `-l` as usable "only alone": `tcsh -l -c cmd` is
    // rejected, so the command form drops the login flag. csh still reads
    // `.cshrc` for non-login shells, which is where PATH normally lives.
    case 'csh':
      return ['-c', command];
    case 'fish':
    case 'posix':
      return ['-l', '-c', command];
  }
}

/* ------------------------------------------------------------------ */
/* Scratch directory: where the operator's shell startup is allowed to  */
/* write.                                                               */
/* ------------------------------------------------------------------ */

let scratchDir = path.join(os.tmpdir(), 'exawatt-shell-startup');
let scratchExists = false;

/**
 * Point the scratch directory at app-owned storage. Called once from main with
 * `userData`; the tmpdir default keeps this module usable in unit tests and in
 * any code path that runs before Electron is ready.
 */
export function configureLoginShellScratchDir(dir: string): void {
  scratchDir = dir;
  scratchExists = false;
}

export function loginShellScratchDir(): string {
  return scratchDir;
}

/**
 * The plan's `cwd` must always exist — a spawn into a missing directory fails
 * with a bare ENOENT that reads as a broken harness. One memoized `mkdirSync`
 * per process, falling back to the system temp directory, which certainly
 * exists: startup residue in tmp is better than a launch that cannot happen.
 */
function ensureScratchDir(): string {
  if (scratchExists) return scratchDir;
  try {
    fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    scratchExists = true;
    return scratchDir;
  } catch {
    return os.tmpdir();
  }
}

/**
 * Empty the scratch directory. Anything in it is the previous run's
 * shell-startup residue and is safe to drop: nothing Exawatt owns is ever
 * written here. Entries are removed rather than the directory itself, so a
 * spawn racing this call never finds its `cwd` missing.
 */
export async function prepareLoginShellScratchDir(): Promise<void> {
  try {
    await fs.promises.mkdir(scratchDir, { recursive: true, mode: 0o700 });
    scratchExists = true;
    const entries = await fs.promises.readdir(scratchDir);
    await Promise.all(
      entries.map(name =>
        fs.promises
          .rm(path.join(scratchDir, name), { recursive: true, force: true })
          .catch(() => {})
      )
    );
  } catch {
    // A scratch directory that cannot be prepared is not a reason to refuse to
    // launch; `ensureScratchDir` falls back at spawn time.
  }
}

/**
 * Names the operator's shell startup created in the scratch directory. Empty
 * for a clean shell. Non-empty is the finding incident `0006` needed: it names
 * the files the startup writes, in a directory Exawatt owns, instead of leaving
 * them to be discovered in a repository.
 */
export async function observedShellStartupArtifacts(): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(scratchDir);
    return entries.sort().slice(0, 20);
  } catch {
    return [];
  }
}
