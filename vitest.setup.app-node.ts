import { afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * No app-node test runs the operator's shell startup or reads his home
 * (BUG-298).
 *
 * The product runs everything through the operator's LOGIN shell, and its
 * tests drive that real path with fixture CLIs in a test-harness bin. A login
 * shell sources `~/.profile`, `~/.zprofile`, `config.fish`. With the
 * operator's real HOME, every such test ran his dotfiles: on this machine
 * `/bin/sh -l` loads RVM, about 950 traced lines plus `ps` and `uname` forks,
 * for each probe. One registry inspection makes a dozen of those probes, so a
 * test's cost was set by the operator's dotfiles times the host's load: about
 * 0.8 s alone and past the 5 s test timeout inside a loaded related-tests run,
 * passing again when re-run alone. Each test file also read whatever the
 * operator's real `~/.codex`, `~/.qwen` or `~/.gemini` happened to hold.
 *
 * So every test file starts with a private, empty HOME, and without the
 * variables that point shells or harnesses at other startup files or state.
 * A login shell then runs only the system's own startup, and a test that
 * wants a home with something in it writes one, as several already do. This
 * file runs before each test file's own imports, so a module that reads
 * HOME when it loads sees the private one.
 */
const REDIRECTED = [
  'HOME',
  // Shell startup that lives outside HOME.
  'ZDOTDIR',
  'ENV',
  'BASH_ENV',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  // Harness state roots the product resolves before HOME.
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'QWEN_HOME',
] as const;

/** Homes live under one parent, each named for the worker that made it. A
 * file whose every test is skipped never reaches `afterAll`, and a worker can
 * be ended without an `exit` event, so each file also clears the homes of
 * workers that are gone. */
const HOMES = join(tmpdir(), 'exawatt-test-homes');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

mkdirSync(HOMES, { recursive: true });
for (const entry of readdirSync(HOMES)) {
  const pid = Number(entry.split('-')[0]);
  if (Number.isInteger(pid) && pid > 0 && !alive(pid)) {
    rmSync(join(HOMES, entry), { recursive: true, force: true });
  }
}

const prior = new Map(REDIRECTED.map(key => [key, process.env[key]]));
const home = mkdtempSync(join(HOMES, `${process.pid}-`));
for (const key of REDIRECTED) delete process.env[key];
process.env.HOME = home;

afterAll(() => {
  for (const [key, value] of prior) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});
