import { describe, expect, it } from 'vitest';
import {
  MAX_MATCHES,
  processKillGuardVerdict,
  shellWords,
  withoutDataHeredocs,
} from './process-kill-guard';

/**
 * A machine the guard can list, answering in the real tools' output formats:
 * `pgrep` prints one pid per line (exit 1 and nothing when no match),
 * `ps -o pid=,comm=` prints `<pid> <executable path>`, and `killall -s` prints
 * `kill -TERM <pid>` per target. The fake answers by EXACT argv, so a test
 * also pins what the dry-run asks: the same arguments `pkill` would have used.
 */
function machine(
  processes: Record<number, string>,
  pgrep: Record<string, number[]> = {},
  killall: Record<string, number[]> = {}
) {
  const calls: string[] = [];
  const run = async (command: string, args: readonly string[]) => {
    const key = args.join(' ');
    calls.push(`${command} ${key}`);
    if (command === 'pgrep') return (pgrep[key] ?? []).join('\n');
    if (command === 'killall') {
      return (killall[key] ?? []).map(pid => `kill -TERM ${pid}`).join('\n');
    }
    if (command === 'ps') {
      const pids = args[args.length - 1].split(',').map(Number);
      return pids
        .filter(pid => processes[pid])
        .map(pid => `${String(pid).padStart(5)} ${processes[pid]}`)
        .join('\n');
    }
    return '';
  };
  return { run, calls };
}

const HELPER =
  '/Applications/Brave Browser.app/Contents/Frameworks/Brave Browser Framework.framework/Helpers/Brave Browser Helper (Renderer).app/Contents/MacOS/Brave Browser Helper (Renderer)';
const DEV_SERVER = '/Users/op/.nvm/versions/node/v24/bin/node';

function verdict(
  command: string,
  box: ReturnType<typeof machine>,
  protectedPids: ReadonlySet<number> = new Set()
) {
  return processKillGuardVerdict(command, {
    run: box.run,
    protectedPids,
    home: '/Users/op',
  });
}

describe('processKillGuardVerdict', () => {
  it('refuses the 2026-09-24 command, dry-running exactly what pkill would match', async () => {
    const box = machine(
      { 101: HELPER, 102: HELPER, 200: DEV_SERVER },
      { '-f next start -f': [101, 102, 200] }
    );

    const reason = await verdict(
      'pkill -f "next start" -f 2>/dev/null; lsof -tiTCP:3300 -sTCP:LISTEN | xargs kill',
      box
    );

    // The redirect is the shell's; the trailing -f is pkill's second pattern.
    expect(box.calls[0]).toBe('pgrep -f next start -f');
    expect(reason).toContain('2 process(es) outside your work');
    expect(reason).toContain('Brave Browser Helper (Renderer) x2');
  });

  it('lets a kill through that reaches only the agent’s own processes', async () => {
    const box = machine({ 200: DEV_SERVER }, { '-f next start': [200] });
    expect(await verdict('pkill -f "next start"', box)).toBeNull();
  });

  it('protects Exawatt and every agent Session by pid', async () => {
    const box = machine({ 300: '/bin/zsh' }, { '-f zsh': [300] });
    expect(await verdict('pkill -f zsh', box, new Set([300]))).toContain(
      'outside your work'
    );
  });

  it('protects agent harnesses by name, wherever they are installed', async () => {
    const box = machine(
      { 400: '/Users/op/.local/bin/claude' },
      { '-x claude': [400] }
    );
    expect(await verdict('pgrep -x claude | xargs kill -9', box)).toContain(
      'claude'
    );
  });

  it('refuses a pattern broad enough to be nobody’s own work', async () => {
    const pids = Array.from({ length: MAX_MATCHES + 1 }, (_, i) => 500 + i);
    const box = machine(
      Object.fromEntries(pids.map(pid => [pid, DEV_SERVER])),
      { '-f node': pids }
    );
    expect(await verdict('pkill -f node', box)).toContain(
      `matches ${MAX_MATCHES + 1} processes`
    );
  });

  it('dry-runs killall with -s and judges what it would signal', async () => {
    const box = machine(
      { 600: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock' },
      {},
      { '-s Dock': [600] }
    );
    expect(await verdict('killall Dock', box)).toContain('Dock');
    expect(box.calls).toContain('killall -s Dock');
  });

  it('drops the signal and interactive flags before dry-running pkill', async () => {
    const box = machine({}, {});
    await verdict(
      'pkill -9 -f alpha; pkill -KILL beta; pkill -I -f gamma',
      box
    );
    expect(box.calls).toEqual([
      'pgrep -f alpha',
      'pgrep beta',
      'pgrep -f gamma',
    ]);
  });

  it('refuses kill -1 outright', async () => {
    const box = machine({});
    expect(await verdict('kill -9 -1', box)).toContain('kill -1');
    expect(await verdict('kill -- -1', box)).toContain('kill -1');
    expect(await verdict('kill -12345', box)).toBeNull();
  });

  it('spends nothing on a command that kills nothing', async () => {
    const box = machine({});
    expect(await verdict('ls -la && git status', box)).toBeNull();
    expect(await verdict('pgrep -fl node', box)).toBeNull();
    expect(box.calls).toEqual([]);
  });

  it('lets through what it cannot judge honestly', async () => {
    const box = machine({});
    expect(await verdict('pkill -f "$PATTERN"', box)).toBeNull();
    expect(await verdict('pkill -f "unbalanced', box)).toBeNull();
    expect(box.calls).toEqual([]);
  });

  it('reads a heredoc as data unless a shell is reading it', async () => {
    const box = machine({ 700: HELPER }, { '-f Helper': [700] });
    expect(
      await verdict("cat > notes.md <<'EOF'\npkill -f Helper\nEOF", box)
    ).toBeNull();
    expect(await verdict('bash <<EOF\npkill -f Helper\nEOF', box)).toContain(
      'outside your work'
    );
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
