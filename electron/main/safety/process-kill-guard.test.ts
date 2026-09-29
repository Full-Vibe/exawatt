import { describe, expect, it } from 'vitest';
import {
  ListingFailure,
  MAX_MATCHES,
  pgrepArgv,
  processKillGuardVerdict,
  shellWords,
  withoutDataHeredocs,
  type Listing,
  type ListingTool,
} from './process-kill-guard';

interface Proc {
  ppid: number;
  exe: string;
  args?: string;
}

/**
 * A machine the guard can list, answering in the real macOS tools' output
 * formats and exit codes: `pgrep` prints one pid per line and exits 1 with
 * nothing when no process matches; `killall -s` prints `kill -TERM <pid>` per
 * target and exits 1 with "No matching processes…" on stderr; `ps -axww -o
 * pid=,ppid=,comm=` and `-o pid=,args=` print the whole table. The fake
 * answers pgrep and killall by EXACT argv, so a test also pins what the dry
 * run asks: the same selection `pkill` would have used.
 */
function machine(
  processes: Record<number, Proc>,
  pgrep: Record<string, number[] | Listing> = {},
  killall: Record<string, number[]> = {},
  broken: Partial<Record<ListingTool, 'timeout' | Listing>> = {}
) {
  const calls: string[] = [];
  const ok = (stdout: string, exitCode = 0): Listing => ({
    stdout,
    stderr: '',
    exitCode,
  });
  const run = async (
    tool: ListingTool,
    args: readonly string[]
  ): Promise<Listing> => {
    const key = args.join(' ');
    calls.push(`${tool} ${key}`);
    const failure = broken[tool];
    if (failure === 'timeout') {
      throw new ListingFailure(`${tool} did not answer within 1.5s`);
    }
    if (failure) return failure;
    if (tool === 'pgrep') {
      const answer = pgrep[key] ?? [];
      if (!Array.isArray(answer)) return answer;
      return answer.length ? ok(answer.join('\n') + '\n') : ok('', 1);
    }
    if (tool === 'killall') {
      const pids = killall[key] ?? [];
      return pids.length
        ? ok(pids.map(pid => `kill -TERM ${pid}`).join('\n'))
        : {
            stdout: '',
            stderr: 'No matching processes belonging to you were found\n',
            exitCode: 1,
          };
    }
    const rows = Object.entries(processes);
    if (key.endsWith('comm=')) {
      return ok(
        rows
          .map(
            ([pid, p]) =>
              `${pid.padStart(5)} ${String(p.ppid).padStart(5)} ${p.exe}`
          )
          .join('\n')
      );
    }
    return ok(
      rows.map(([pid, p]) => `${pid.padStart(5)} ${p.args ?? p.exe}`).join('\n')
    );
  };
  return { run, calls };
}

const HELPER =
  '/Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Framework.framework/Helpers/Brave Browser Helper (Renderer).app/Contents/MacOS/Brave Browser Helper (Renderer)';
const NODE = '/Users/op/.nvm/versions/node/v24/bin/node';
const EXAWATT = 10;
const ROOT = 20; // the asking agent's Session shell
const CLAUDE = 21; // its harness
const TOOL_SHELL = 22; // an earlier Bash tool shell, still running
const DEV = 30; // a dev server the agent started

/** Exawatt → Session root → claude → a dev server, plus the machine. */
function world(extra: Record<number, Proc> = {}): Record<number, Proc> {
  return {
    1: { ppid: 0, exe: '/sbin/launchd' },
    [EXAWATT]: {
      ppid: 1,
      exe: '/Applications/Exawatt.app/Contents/MacOS/Exawatt',
    },
    [ROOT]: {
      ppid: EXAWATT,
      exe: '/bin/zsh',
      args: "/bin/zsh -l -c cd -- /repo || exit 1\nclaude 'stop next start'",
    },
    [CLAUDE]: { ppid: ROOT, exe: 'claude', args: "claude 'stop next start'" },
    [TOOL_SHELL]: { ppid: CLAUDE, exe: '/bin/zsh' },
    [DEV]: { ppid: TOOL_SHELL, exe: NODE, args: `${NODE} next start` },
    ...extra,
  };
}

function verdict(
  command: string,
  box: ReturnType<typeof machine>,
  options: { protectedPids?: number[]; root?: number | null } = {}
) {
  return processKillGuardVerdict(command, {
    run: box.run,
    protectedPids: new Set(options.protectedPids ?? [EXAWATT, ROOT]),
    sessionRootPid: options.root === undefined ? ROOT : options.root,
    home: '/Users/op',
  });
}

async function refusal(
  command: string,
  box: ReturnType<typeof machine>,
  options?: Parameters<typeof verdict>[2]
) {
  return (await verdict(command, box, options)).refusal;
}

describe('processKillGuardVerdict', () => {
  it('refuses the 2026-09-24 command, dry-running exactly what pkill would match', async () => {
    const box = machine(
      world({ 101: { ppid: 1, exe: HELPER }, 102: { ppid: 1, exe: HELPER } }),
      { '-f next start -f': [101, 102, DEV] }
    );

    const reason = await refusal(
      'pkill -f "next start" -f 2>/dev/null; lsof -tiTCP:3300 -sTCP:LISTEN | xargs kill',
      box
    );

    // The redirect is the shell's; the trailing -f is pkill's second pattern.
    expect(box.calls).toContain('pgrep -f next start -f');
    expect(reason).toContain('2 process(es) outside your work');
    expect(reason).toContain('Brave Browser Helper (Renderer) x2');
  });

  it('lets through a kill that reaches only the agent’s own processes', async () => {
    const box = machine(world(), { '-f next start': [DEV] });
    expect(await refusal('pkill -f "next start"', box)).toBeNull();
  });

  it('leaves out the command’s own ancestors, as the real pkill does', async () => {
    // The Session shell and claude carry the pattern in their arguments.
    const box = machine(world(), { '-f next start': [ROOT, CLAUDE, DEV] });
    expect(await refusal('pkill -f "next start"', box)).toBeNull();
    // `-a` asks pkill to include them, so the guard does too.
    const withAncestors = machine(world(), {
      '-a -f next start': [ROOT, CLAUDE, DEV],
    });
    expect(await refusal('pkill -a -f "next start"', withAncestors)).toContain(
      'outside your work'
    );
  });

  it('still protects another Session’s shell and harness', async () => {
    const box = machine(
      world({
        40: { ppid: EXAWATT, exe: '/bin/zsh', args: 'zsh -c claude next' },
        41: { ppid: 40, exe: 'claude', args: 'claude next' },
      }),
      { '-f next': [40, 41] }
    );
    const reason = await refusal('pkill -f next', box, {
      protectedPids: [EXAWATT, ROOT, 40],
    });
    expect(reason).toContain('2 process(es) outside your work');
  });

  it.each([
    ['npm-installed Gemini', `${NODE} /opt/homebrew/bin/gemini`],
    [
      'npm-installed Qwen',
      `${NODE} /opt/homebrew/lib/node_modules/@qwen-code/qwen-code/cli.js`,
    ],
    [
      'npm-installed Codex',
      `${NODE} /Users/op/.npm-global/lib/node_modules/@openai/codex/bin/codex.js`,
    ],
  ])('protects %s, which runs as node', async (_name, args) => {
    const box = machine(world({ 50: { ppid: 1, exe: NODE, args } }), {
      '-f node': [50],
    });
    expect(await refusal('pkill -f node', box)).toContain('outside your work');
  });

  it('protects agent harnesses by name, wherever they are installed', async () => {
    const box = machine(
      world({ 60: { ppid: 1, exe: '/Users/op/.local/bin/claude' } }),
      { '-x claude': [60] }
    );
    expect(await refusal('pgrep -x claude | xargs kill -9', box)).toContain(
      'claude'
    );
  });

  it('refuses a pattern broad enough to be nobody’s own work, counting what pgrep matched', async () => {
    const pids = Array.from({ length: MAX_MATCHES + 1 }, (_, i) => 500 + i);
    // The table lists none of them: the count is the dry run's, not ps's.
    const box = machine(world(), { '-f node': pids });
    expect(await refusal('pkill -f node', box)).toContain(
      `matches ${MAX_MATCHES + 1} processes`
    );
  });

  it('dry-runs killall with -s and judges what it would signal', async () => {
    const box = machine(
      world({
        600: {
          ppid: 1,
          exe: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock',
        },
      }),
      {},
      { '-s Dock': [600] }
    );
    expect(await refusal('killall Dock', box)).toContain('Dock');
    expect(box.calls).toContain('killall -s Dock');
  });

  it.each([
    ['a signal', 'pkill -9 -f alpha', 'pgrep -f alpha'],
    ['a named signal', 'pkill -KILL beta', 'pgrep beta'],
    ['pkill’s confirmation flag', 'pkill -I -f gamma', 'pgrep -f gamma'],
    [
      'long output inside a cluster',
      'pgrep -lf delta | xargs kill',
      'pgrep -f delta',
    ],
    ['a delimiter', 'kill $(pgrep -d, -f eps)', 'pgrep -f eps'],
    ['an attached delimiter', 'kill $(pgrep -fd, zeta)', 'pgrep -f zeta'],
    ['a value option', 'pkill -u op -f eta', 'pgrep -u op -f eta'],
  ])('drops %s before dry-running', async (_name, command, call) => {
    const box = machine(world());
    await verdict(command, box);
    expect(box.calls).toContain(call);
  });

  it.each([
    ['a path', '/usr/bin/pkill -f Helper'],
    ['a backslash', '\\pkill -f Helper'],
    ['sudo', 'sudo -u op pkill -f Helper'],
    ['env and assignments', 'LC_ALL=C env -i pkill -f Helper'],
    ['a timeout', 'timeout 5 pkill -f Helper'],
    ['sh -c', "sh -c 'pkill -f Helper'"],
    ['bash -lc', 'bash -lc "pkill -f Helper; echo done"'],
    ['bash --login -c', "bash --login -c 'pkill -f Helper'"],
    ['eval', "eval 'pkill -f Helper'"],
    ['a subshell', '(cd /tmp && pkill -f Helper)'],
    ['a command substitution', 'kill -9 $(pgrep -f Helper)'],
    ['backticks', 'kill `pgrep -f Helper`'],
    ['a quoted substitution', 'kill "$(pgrep -f Helper)"'],
    ['a loop over pgrep', 'for p in $(pgrep -f Helper); do kill $p; done'],
    ['a shell-fed heredoc', 'bash <<EOF\npkill -f Helper\nEOF'],
  ])('finds a kill behind %s', async (_name, command) => {
    const box = machine(world({ 700: { ppid: 1, exe: HELPER } }), {
      '-f Helper': [700],
    });
    expect(await refusal(command, box)).toContain('outside your work');
  });

  it.each([
    ['an alternation', "pkill -f 'next|vite'", '-f next|vite'],
    ['a group', 'pkill -f "(next|vite) dev"', '-f (next|vite) dev'],
    ['a trailing redirect', 'pkill -f "a b" >/dev/null 2>&1', '-f a b'],
  ])('keeps %s inside the pattern', async (_name, command, argv) => {
    const box = machine(world(), { [argv]: [700] });
    await verdict(command, box);
    expect(box.calls).toContain(`pgrep ${argv}`);
  });

  it('never reads a port in `pgrep -lf` output as a pid', async () => {
    // `-l` is dropped, so each line is a pid; a line that is not is a
    // failure, never a number lifted out of an argument list.
    const box = machine(world(), {
      '-f next': {
        stdout: `${DEV} ${NODE} next start --port 80\n`,
        stderr: '',
        exitCode: 0,
      },
    });
    const result = await verdict('pgrep -f next | xargs kill', box);
    expect(result.refusal).toContain('could not check');
    expect(box.calls.some(call => call.includes('-p 80'))).toBe(false);
  });

  it('refuses kill -1 outright', async () => {
    const box = machine(world());
    expect(await refusal('kill -9 -1', box)).toContain('kill -1');
    expect(await refusal('kill -- -1', box)).toContain('kill -1');
    expect(await refusal('kill -s KILL -1', box)).toContain('kill -1');
    expect(await refusal('kill -12345', box)).toBeNull();
    expect(await refusal('kill -1 12345', box)).toBeNull();
  });

  it('spends nothing on a command that kills nothing', async () => {
    const box = machine(world());
    expect(await refusal('ls -la && git status', box)).toBeNull();
    expect(await refusal('pgrep -fl node', box)).toBeNull();
    expect(await refusal("echo 'pkill -f x'", box)).toBeNull();
    expect(box.calls).toEqual([]);
  });

  it('lets a target decided at run time through, and reports it', async () => {
    const box = machine(world());
    const expanded = await verdict('pkill -f "$PATTERN"', box);
    expect(expanded.refusal).toBeNull();
    expect(expanded.undecided).toEqual([
      expect.objectContaining({ cause: expect.stringContaining('expands') }),
    ]);
    const piped = await verdict('echo next | xargs pkill -f', box);
    expect(piped.refusal).toBeNull();
    expect(piped.undecided).toHaveLength(1);
    expect(box.calls).toEqual([]);
  });

  it('lets through a command the shell itself would refuse', async () => {
    const box = machine(world());
    expect(await verdict('pkill -f "unbalanced', box)).toEqual({
      refusal: null,
      undecided: [],
    });
  });

  it('reads a heredoc as data unless a shell is reading it', async () => {
    const box = machine(world({ 700: { ppid: 1, exe: HELPER } }), {
      '-f Helper': [700],
    });
    expect(
      await refusal("cat > notes.md <<'EOF'\npkill -f Helper\nEOF", box)
    ).toBeNull();
  });
});

describe('a check that could not look', () => {
  const failures: Array<
    [string, Parameters<typeof machine>[3], Parameters<typeof machine>[1]?]
  > = [
    ['pgrep timed out', { pgrep: 'timeout' }],
    ['ps timed out', { ps: 'timeout' }],
    [
      'pgrep rejected its options',
      {},
      {
        '-f Helper': {
          stdout: '',
          stderr: 'pgrep: illegal option -- Z',
          exitCode: 2,
        },
      },
    ],
    [
      'ps exited with an error',
      { ps: { stdout: '', stderr: 'ps: boom', exitCode: 1 } },
    ],
    ['ps listed nothing', { ps: { stdout: '', stderr: '', exitCode: 0 } }],
    [
      'killall failed',
      { killall: { stdout: '', stderr: 'killall: bad', exitCode: 1 } },
    ],
  ];

  it.each(failures)(
    'refuses and says so when %s',
    async (_name, broken, pgrep = { '-f Helper': [700] }) => {
      const box = machine(
        world({ 700: { ppid: 1, exe: NODE } }),
        pgrep,
        { '-s Helper': [700] },
        broken
      );
      const command = broken?.killall ? 'killall Helper' : 'pkill -f Helper';
      const result = await verdict(command, box);
      expect(result.refusal).toContain('could not check');
      expect(result.undecided).toHaveLength(1);
    }
  );

  it('does not read a failed listing as "nothing matched" for 600 processes', async () => {
    const pids = Array.from({ length: 600 }, (_, i) => 1000 + i);
    const box = machine(world(), { '-f node': pids }, {}, { ps: 'timeout' });
    expect((await verdict('pkill -f node', box)).refusal).not.toBeNull();
  });
});

describe('pgrepArgv', () => {
  it('ends options at the first pattern, as macOS getopt does', () => {
    expect(pgrepArgv('pkill', ['-9', '-f', 'next start', '-f']).argv).toEqual([
      '-f',
      'next start',
      '-f',
    ]);
    expect(pgrepArgv('pgrep', ['-lfn', 'x']).argv).toEqual(['-fn', 'x']);
    expect(pgrepArgv('pgrep', ['--', '-x']).argv).toEqual(['--', '-x']);
    expect(pgrepArgv('pgrep', ['-v', 'x']).includesAncestors).toBe(true);
  });
});

describe('shellWords', () => {
  it('splits like a POSIX shell and refuses unbalanced quoting', () => {
    expect(shellWords(` -f "next start" -f 'a b' c\\ d`)).toEqual([
      '-f',
      'next start',
      '-f',
      'a b',
      'c d',
    ]);
    expect(shellWords(' -f "open')).toBeNull();
  });
});

describe('withoutDataHeredocs', () => {
  it('keeps the lines after a heredoc closes', () => {
    expect(withoutDataHeredocs('cat > x <<EOF\nsecret\nEOF\npkill -f y')).toBe(
      'cat > x <<EOF\npkill -f y'
    );
  });
});
