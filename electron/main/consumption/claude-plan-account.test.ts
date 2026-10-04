/**
 * ENG-038 slice 3 — the Claude plan-account read through Claude Code's own
 * `/usage`.
 *
 * Four families of pins:
 * - the parser, against REAL captured output (signed in, signed out) plus the
 *   format changes that must degrade to "couldn't read" and never to 0%;
 * - the reset time: the printed zone and date resolved to an absolute instant,
 *   rolling the year correctly;
 * - every degraded state as its own named cause, and the throttle / off
 *   switch / last-good-value life the shared service gives it;
 * - the custody boundary: the Keychain path and the distribution gate are
 *   gone and a test fails if either is reintroduced.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyLiveConsumptionSnapshot,
  planWindowKey,
  type ConsumptionUpdatedEvent,
  type LiveConsumptionSnapshot,
  type PlanWindow,
} from '@exawatt/core';
import {
  CLAUDE_USAGE_ARGS,
  ClaudePlanAccountService,
  createClaudeUsageRunner,
  judgeClaudeUsageRun,
  migratePersistedLimitName,
  parseClaudeResetTime,
  parseClaudeUsageOutput,
  parseClaudeUsageReport,
  type ClaudeUsageRun,
  type ClaudeUsageRunner,
} from './claude-plan-account';
import {
  SIGNED_IN_REAL,
  SIGNED_IN_WITH_MINUTES_RESULT,
  SIGNED_OUT_REAL,
} from './claude-usage.fixtures';
import { ProviderPlanCompositeSource } from './provider-plan-composite';
import type { ConsumptionScannerLike } from '../consumption-ipc';

/** 2026-10-04 14:25 in Los Angeles, the afternoon the fixtures were captured. */
const NOW_MS = Date.parse('2026-10-04T21:25:00.000Z');
const OBSERVED_AT = new Date(NOW_MS).toISOString();

const envelope = (result: string, over: Record<string, unknown> = {}) => ({
  ...SIGNED_IN_REAL,
  result,
  ...over,
});
const stdoutOf = (body: unknown) => `${JSON.stringify(body)}\n`;
const finished = (
  stdout: string,
  exitCode = 0,
  stderr = ''
): ClaudeUsageRun => ({
  kind: 'finished',
  exitCode,
  stdout,
  stderr,
});

function windowsOf(stdout: string, nowMs = NOW_MS): PlanWindow[] {
  const parsed = parseClaudeUsageOutput(stdout, nowMs);
  if (parsed.kind !== 'windows') {
    throw new Error(
      `expected windows, got ${parsed.kind}: ${JSON.stringify(parsed)}`
    );
  }
  return parsed.windows;
}

/* ------------------------------------------------------------------ */
/* the real report                                                      */
/* ------------------------------------------------------------------ */

describe('the real /usage report (Claude Code 2.1.289)', () => {
  it('reads the signed-in session, all-models week, and model-scoped week', () => {
    const windows = windowsOf(stdoutOf(SIGNED_IN_REAL));
    expect(
      windows.map(w => ({
        id: w.limitId,
        name: w.limitName,
        used: w.usedPercent,
        minutes: w.windowMinutes,
        resetsAt: w.resetsAt,
      }))
    ).toEqual([
      {
        id: 'claude-session',
        name: null,
        used: 4,
        minutes: 300,
        resetsAt: '2026-10-05T02:00:00.000Z',
      },
      {
        id: 'claude-weekly-all',
        name: null,
        used: 92,
        minutes: 10080,
        resetsAt: '2026-10-05T09:00:00.000Z',
      },
      {
        id: 'claude-weekly-fable',
        name: 'Fable',
        used: 58,
        minutes: 10080,
        resetsAt: '2026-10-05T09:00:00.000Z',
      },
    ]);
  });

  it('enters every window as the account’s own reading, observed now', () => {
    for (const w of windowsOf(stdoutOf(SIGNED_IN_REAL))) {
      expect(w).toMatchObject({
        source: 'claude-code',
        scope: 'primary',
        origin: 'provider-account',
        observedAt: OBSERVED_AT,
        providerSessionId: '',
        planType: null,
      });
    }
  });

  it('reads a reset that carries minutes ("6:59pm", "1:59am")', () => {
    const windows = windowsOf(
      stdoutOf(envelope(SIGNED_IN_WITH_MINUTES_RESULT))
    );
    expect(windows.map(w => [w.limitId, w.usedPercent, w.resetsAt])).toEqual([
      ['claude-session', 2, '2026-10-05T01:59:00.000Z'],
      ['claude-weekly-all', 92, '2026-10-05T08:59:00.000Z'],
      ['claude-weekly-fable', 58, '2026-10-05T08:59:00.000Z'],
    ]);
  });

  it('gives every window a distinct bucket key, stable across reads', () => {
    const first = windowsOf(stdoutOf(SIGNED_IN_REAL));
    const keys = first.map(planWindowKey);
    expect(new Set(keys).size).toBe(3);
    const later = windowsOf(stdoutOf(SIGNED_IN_REAL), NOW_MS + 60_000);
    expect(later.map(planWindowKey)).toEqual(keys);
  });

  it('reads whatever model the week line names, not a fixed list', () => {
    const windows = windowsOf(
      stdoutOf(
        envelope(
          [
            'Current session: 1% used · resets Oct 4 at 7pm (America/Los_Angeles)',
            'Current week (all models): 10% used · resets Oct 5 at 2am (America/Los_Angeles)',
            'Current week (Sonnet only): 3% used · resets Oct 5 at 2am (America/Los_Angeles)',
            'Current week (Some Future Model 4.2): 7% used · resets Oct 5 at 2am (America/Los_Angeles)',
          ].join('\n')
        )
      )
    );
    expect(windows.map(w => [w.limitId, w.limitName])).toEqual([
      ['claude-session', null],
      ['claude-weekly-all', null],
      ['claude-weekly-sonnet', 'Sonnet'],
      ['claude-weekly-some-future-model-4-2', 'Some Future Model 4.2'],
    ]);
  });

  it('ignores the free-text sections that follow the limits', () => {
    // The real report carries "What's contributing to your limits usage?" and
    // per-period request counts; none of it is a limit and all of it churns.
    expect(SIGNED_IN_REAL.result).toContain('Last 7d');
    expect(windowsOf(stdoutOf(SIGNED_IN_REAL))).toHaveLength(3);
  });

  it('reads a window with no reset time as an unknown reset, not a made-up one', () => {
    const [session] = windowsOf(stdoutOf(envelope('Current session: 0% used')));
    expect(session.usedPercent).toBe(0);
    expect(session.resetsAt).toBeNull();
  });

  it('reads fractional percentages exactly', () => {
    const [session] = windowsOf(
      stdoutOf(
        envelope(
          'Current session: 12.5% used · resets Oct 4 at 7pm (America/Los_Angeles)'
        )
      )
    );
    expect(session.usedPercent).toBe(12.5);
  });
});

describe('signed out', () => {
  it('is the real cost summary with no limit lines, read as its own state', () => {
    expect(SIGNED_OUT_REAL.result).toMatch(/^Total cost:/u);
    const parsed = parseClaudeUsageOutput(stdoutOf(SIGNED_OUT_REAL), NOW_MS);
    expect(parsed).toMatchObject({ kind: 'failure', cause: 'no-plan' });
  });

  it('is never a 0% window', () => {
    const run = judgeClaudeUsageRun(
      finished(stdoutOf(SIGNED_OUT_REAL)),
      NOW_MS
    );
    expect(run).toEqual({ failure: 'no-plan' });
  });
});

/* ------------------------------------------------------------------ */
/* a changed format is "couldn't read", never 0% and never partial      */
/* ------------------------------------------------------------------ */

describe('a format Exawatt does not know', () => {
  const expectUnrecognized = (stdout: string) =>
    expect(parseClaudeUsageOutput(stdout, NOW_MS)).toMatchObject({
      kind: 'failure',
      cause: 'unrecognized',
    });

  it.each([
    [
      'the figure now counts what is left',
      'Current session: 96% left · resets Oct 4 at 7pm (America/Los_Angeles)',
    ],
    [
      'the separator moved',
      'Current session: 4% used - resets Oct 4 at 7pm (America/Los_Angeles)',
    ],
    [
      'the reset moved to a 24-hour clock',
      'Current session: 4% used · resets Oct 4 at 19:00 (America/Los_Angeles)',
    ],
    [
      'the zone became an abbreviation',
      'Current session: 4% used · resets Oct 4 at 7pm (PDT)',
    ],
    [
      'the zone is not one that exists',
      'Current session: 4% used · resets Oct 4 at 7pm (Mars/Olympus_Mons)',
    ],
    [
      'the date is not on the calendar',
      'Current session: 4% used · resets Feb 30 at 7pm (America/Los_Angeles)',
    ],
    [
      'the percentage is out of range',
      'Current session: 140% used · resets Oct 4 at 7pm (America/Los_Angeles)',
    ],
    [
      'the label changed',
      'Current period: 4% used · resets Oct 4 at 7pm (America/Los_Angeles)',
    ],
  ])('refuses when %s', (_label, line) => {
    // The line still starts with "Current ", so it is a limit Exawatt cannot
    // read; for the label case the whole report has no limit line at all.
    expectUnrecognized(stdoutOf(envelope(line)));
  });

  it('serves nothing partial when one limit line cannot be read', () => {
    // A half-read list could hide the very limit that is about to bite.
    expectUnrecognized(
      stdoutOf(
        envelope(
          [
            'Current session: 4% used · resets Oct 4 at 7pm (America/Los_Angeles)',
            'Current week (all models): 92% left · resets Oct 5 at 2am (America/Los_Angeles)',
          ].join('\n')
        )
      )
    );
  });

  it('refuses two lines that claim the same limit', () => {
    const line =
      'Current session: 4% used · resets Oct 4 at 7pm (America/Los_Angeles)';
    expectUnrecognized(stdoutOf(envelope(`${line}\n${line}`)));
  });

  it.each([
    ['an empty report', ''],
    ['a report that names no limit', 'Everything is fine. Carry on.'],
  ])('refuses %s', (_label, result) => {
    expectUnrecognized(stdoutOf(envelope(result)));
  });

  it.each([
    ['no output at all', ''],
    ['text that is not JSON', 'usage: claude [options]\n'],
    ['JSON that is not an object', '[1,2,3]\n'],
    ['an envelope with no result text', stdoutOf({ type: 'result' })],
    [
      'an envelope of another type',
      stdoutOf({ type: 'assistant', result: SIGNED_IN_REAL.result }),
    ],
    [
      'a result that is not text',
      stdoutOf({ type: 'result', result: { windows: [] } }),
    ],
  ])('refuses %s', (_label, stdout) => {
    expectUnrecognized(stdout);
  });

  it('reads an envelope an error flag marks as an error as a stopped claude', () => {
    expect(
      parseClaudeUsageOutput(
        stdoutOf(envelope(SIGNED_IN_REAL.result, { is_error: true })),
        NOW_MS
      )
    ).toMatchObject({ kind: 'failure', cause: 'exited' });
  });

  it('finds the envelope past login-shell startup noise', () => {
    const noisy = `Welcome back\nfish: some greeting\n${stdoutOf(SIGNED_IN_REAL)}`;
    expect(windowsOf(noisy)).toHaveLength(3);
  });

  it('never returns a window set for a report it did not read', () => {
    // The property behind every case above: unrecognized is a failure value,
    // not an empty window list a caller could mistake for "no usage".
    const parsed = parseClaudeUsageReport('Current week: lots', NOW_MS);
    expect(parsed.kind).toBe('unrecognized');
    expect(parsed).not.toHaveProperty('windows');
  });
});

/* ------------------------------------------------------------------ */
/* the reset time                                                       */
/* ------------------------------------------------------------------ */

describe('parseClaudeResetTime', () => {
  const at = (text: string, now = NOW_MS) => parseClaudeResetTime(text, now);

  it('resolves a Pacific daylight reset on the hour and with minutes', () => {
    expect(at('Oct 4 at 7pm (America/Los_Angeles)')).toBe(
      '2026-10-05T02:00:00.000Z'
    );
    expect(at('Oct 4 at 6:59pm (America/Los_Angeles)')).toBe(
      '2026-10-05T01:59:00.000Z'
    );
  });

  it('uses standard time once daylight saving has ended', () => {
    // US daylight saving ended Sunday 2026-11-01.
    const now = Date.parse('2026-10-30T12:00:00.000Z');
    expect(at('Oct 31 at 7pm (America/Los_Angeles)', now)).toBe(
      '2026-11-01T02:00:00.000Z'
    );
    expect(at('Nov 2 at 7pm (America/Los_Angeles)', now)).toBe(
      '2026-11-03T03:00:00.000Z'
    );
  });

  it('resolves the printed zone, not the machine’s', () => {
    expect(at('Oct 5 at 9am (Europe/London)')).toBe('2026-10-05T08:00:00.000Z');
    expect(at('Oct 5 at 9am (Asia/Kolkata)')).toBe('2026-10-05T03:30:00.000Z');
  });

  it('reads 12am as midnight and 12pm as noon', () => {
    expect(at('Oct 5 at 12am (UTC)')).toBe('2026-10-05T00:00:00.000Z');
    expect(at('Oct 5 at 12pm (UTC)')).toBe('2026-10-05T12:00:00.000Z');
  });

  it('rolls into the next year when the read is in December', () => {
    const now = Date.parse('2026-12-31T22:00:00.000Z'); // 14:00 in Los Angeles
    expect(at('Jan 1 at 2am (America/Los_Angeles)', now)).toBe(
      '2027-01-01T10:00:00.000Z'
    );
    expect(at('Jan 3 at 6pm (America/Los_Angeles)', now)).toBe(
      '2027-01-04T02:00:00.000Z'
    );
    // And stays in the year when the reset is later the same December.
    expect(at('Dec 31 at 11pm (America/Los_Angeles)', now)).toBe(
      '2027-01-01T07:00:00.000Z'
    );
  });

  it('judges the year in the printed zone, not in UTC', () => {
    // 2026-12-31 20:00 in Los Angeles is already 2027-01-01 04:00 in UTC.
    const now = Date.parse('2027-01-01T04:00:00.000Z');
    expect(at('Dec 31 at 11pm (America/Los_Angeles)', now)).toBe(
      '2027-01-01T07:00:00.000Z'
    );
    expect(at('Jan 2 at 2am (America/Los_Angeles)', now)).toBe(
      '2027-01-02T10:00:00.000Z'
    );
  });

  it('keeps a reset that has only just passed in the current year', () => {
    expect(at('Oct 4 at 1pm (America/Los_Angeles)')).toBe(
      '2026-10-04T20:00:00.000Z'
    );
  });

  it('reads a time with no date as the next such time', () => {
    expect(at('7pm (America/Los_Angeles)')).toBe('2026-10-05T02:00:00.000Z');
    expect(at('1pm (America/Los_Angeles)')).toBe('2026-10-05T20:00:00.000Z');
  });

  it('settles the day daylight saving starts and ends', () => {
    // 2026-03-08 02:30 does not exist in Los Angeles; the reset lands after it.
    const march = Date.parse('2026-03-07T12:00:00.000Z');
    expect(at('Mar 8 at 3am (America/Los_Angeles)', march)).toBe(
      '2026-03-08T10:00:00.000Z'
    );
    const november = Date.parse('2026-10-31T12:00:00.000Z');
    expect(at('Nov 1 at 3am (America/Los_Angeles)', november)).toBe(
      '2026-11-01T11:00:00.000Z'
    );
  });

  it.each([
    'Oct 4 at 25pm (America/Los_Angeles)',
    'Oct 4 at 0pm (America/Los_Angeles)',
    'Oct 4 at 7:75pm (America/Los_Angeles)',
    'Octember 4 at 7pm (America/Los_Angeles)',
    'Oct 4 at 7pm',
    'Oct 4 at 7pm (not/azone)',
    'tomorrow evening',
    '',
  ])('refuses %j', text => {
    expect(at(text)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* every degraded state is its own cause                                */
/* ------------------------------------------------------------------ */

describe('judgeClaudeUsageRun', () => {
  const judge = (run: ClaudeUsageRun) => judgeClaudeUsageRun(run, NOW_MS);

  it('turns a good run into windows with no plan guess and no spend', () => {
    const read = judge(finished(stdoutOf(SIGNED_IN_REAL)));
    expect(read).toMatchObject({ planType: null, spend: null });
    expect('windows' in read && read.windows).toHaveLength(3);
  });

  it.each([
    ['exit 127', finished('', 127, 'zsh: command not found: claude')],
    [
      'a fish unknown command',
      finished('', 127, 'fish: Unknown command: claude'),
    ],
    [
      'a shell that says so on exit 1',
      finished('', 1, 'claude: command not found'),
    ],
  ])('names a missing binary: %s', (_label, run) => {
    expect(judge(run)).toEqual({ failure: 'not-installed' });
  });

  it('names a timeout', () => {
    expect(judge({ kind: 'timed-out' })).toEqual({ failure: 'timed-out' });
  });

  it('names a non-zero exit that is not a missing binary', () => {
    expect(judge(finished('', 1, 'Error: something broke'))).toEqual({
      failure: 'exited',
    });
    expect(judge(finished(stdoutOf(SIGNED_IN_REAL), 2))).toEqual({
      failure: 'exited',
    });
  });

  it('does not read a good-looking answer from a failed exit', () => {
    // Output on a non-zero exit is not trusted: a failure is not a read.
    expect(judge(finished(stdoutOf(SIGNED_IN_REAL), 1))).toEqual({
      failure: 'exited',
    });
  });

  it('names a process that could not start', () => {
    expect(judge({ kind: 'spawn-failed' })).toEqual({ failure: 'exited' });
  });

  it('names signed out as its own state', () => {
    expect(judge(finished(stdoutOf(SIGNED_OUT_REAL)))).toEqual({
      failure: 'no-plan',
    });
  });

  it('names a changed format as its own state', () => {
    expect(
      judge(finished(stdoutOf(envelope('Current session: 4% left'))))
    ).toEqual({ failure: 'unrecognized' });
  });

  it('keeps all five causes distinct', () => {
    const causes = new Set(
      [
        judge(finished('', 127)),
        judge({ kind: 'timed-out' }),
        judge(finished('', 1, 'boom')),
        judge(finished(stdoutOf(SIGNED_OUT_REAL))),
        judge(finished('garbage')),
      ].map(read => ('failure' in read ? read.failure : 'ok'))
    );
    expect(causes).toEqual(
      new Set([
        'not-installed',
        'timed-out',
        'exited',
        'no-plan',
        'unrecognized',
      ])
    );
  });
});

/* ------------------------------------------------------------------ */
/* the process — real child, scripted shell                             */
/* ------------------------------------------------------------------ */

describe('the usage runner', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-claude-run-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A stand-in for the operator's login shell: a script that records how it
   *  was called, then behaves as `body` says. */
  function scriptedShell(body: string): () => Promise<string> {
    const shell = path.join(dir, 'fakesh');
    fs.writeFileSync(
      shell,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv"\nprintf '%s' "$DISABLE_AUTOUPDATER" > "${dir}/autoupdater"\npwd > "${dir}/cwd"\n${body}\n`,
      { mode: 0o755 }
    );
    return async () => shell;
  }

  it('asks the operator’s own claude for /usage and nothing else', async () => {
    const fixture = path.join(dir, 'usage.json');
    fs.writeFileSync(fixture, stdoutOf(SIGNED_IN_REAL));
    const run = createClaudeUsageRunner({
      resolveShell: scriptedShell(`cat "${fixture}"`),
    });

    const result = await run(10_000);

    expect(result).toMatchObject({ kind: 'finished', exitCode: 0 });
    const argv = fs
      .readFileSync(path.join(dir, 'argv'), 'utf8')
      .trim()
      .split('\n');
    // `-l -c <command>` through the login shell; the command is the pinned one.
    expect(argv.slice(0, 2)).toEqual(['-l', '-c']);
    expect(argv[2]).toBe(
      "claude '-p' '/usage' '--no-session-persistence' '--output-format' 'json'"
    );
    expect(CLAUDE_USAGE_ARGS).toEqual([
      '-p',
      '/usage',
      '--no-session-persistence',
      '--output-format',
      'json',
    ]);
    // The auto-updater is off, so a read can never change anyone's install.
    expect(fs.readFileSync(path.join(dir, 'autoupdater'), 'utf8')).toBe('1');
    // Run from Exawatt's scratch directory, never from a Project.
    expect(fs.readFileSync(path.join(dir, 'cwd'), 'utf8').trim()).not.toBe(
      process.cwd()
    );
    // And what it printed is judged as the real thing.
    expect(judgeClaudeUsageRun(result, NOW_MS)).toMatchObject({
      windows: expect.any(Array),
    });
  });

  it('reports a shell that cannot find claude by its exit code', async () => {
    const run = createClaudeUsageRunner({
      resolveShell: scriptedShell(
        `echo 'claude: command not found' >&2; exit 127`
      ),
    });
    const result = await run(10_000);
    expect(result).toMatchObject({ kind: 'finished', exitCode: 127 });
    expect(judgeClaudeUsageRun(result, NOW_MS)).toEqual({
      failure: 'not-installed',
    });
  });

  it('reports a non-zero exit', async () => {
    const run = createClaudeUsageRunner({
      resolveShell: scriptedShell('exit 3'),
    });
    expect(judgeClaudeUsageRun(await run(10_000), NOW_MS)).toEqual({
      failure: 'exited',
    });
  });

  it('stops a claude that does not answer, and says it timed out', async () => {
    const run = createClaudeUsageRunner({
      resolveShell: scriptedShell('sleep 30'),
    });
    const result = await run(150);
    expect(result).toEqual({ kind: 'timed-out' });
    expect(judgeClaudeUsageRun(result, NOW_MS)).toEqual({
      failure: 'timed-out',
    });
  });

  it('reports a shell that cannot be started', async () => {
    const run = createClaudeUsageRunner({
      resolveShell: async () => path.join(dir, 'no-such-shell'),
    });
    expect(await run(10_000)).toEqual({ kind: 'spawn-failed' });
  });
});

/* ------------------------------------------------------------------ */
/* the service — throttle, off switch, last good value                  */
/* ------------------------------------------------------------------ */

describe('ClaudePlanAccountService', () => {
  let stateDir: string;
  let nowMs: number;

  const good = (): ClaudeUsageRun => finished(stdoutOf(SIGNED_IN_REAL));

  /** Answers each call with the next run, then repeats the last one. */
  function runnerOf(
    ...runs: ClaudeUsageRun[]
  ): ClaudeUsageRunner & ReturnType<typeof vi.fn> {
    let call = 0;
    return vi.fn(async () => runs[Math.min(call++, runs.length - 1)]);
  }

  const service = (
    over: {
      run?: ClaudeUsageRunner;
      enabled?: boolean;
      minFetchIntervalMs?: number;
    } = {}
  ) =>
    new ClaudePlanAccountService({
      stateDir,
      enabled: over.enabled ?? true,
      run: over.run ?? runnerOf(good()),
      now: () => nowMs,
      minFetchIntervalMs: over.minFetchIntervalMs ?? 5 * 60_000,
      jitterMs: 0,
    });

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-plan-'));
    nowMs = NOW_MS;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves the account’s windows after a refresh', async () => {
    const svc = service();
    expect(svc.view().account.status).toBe('unavailable');
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account).toMatchObject({
      source: 'claude-code',
      status: 'ok',
      observedAt: OBSERVED_AT,
      planType: null,
      spend: null,
    });
    expect(view.account).not.toHaveProperty('failure');
    expect(view.windows.map(w => w.limitId).sort()).toEqual([
      'claude-session',
      'claude-weekly-all',
      'claude-weekly-fable',
    ]);
  });

  describe('throttle', () => {
    it('reads once per five minutes however often it is pulled', async () => {
      const run = runnerOf(good());
      const svc = service({ run });

      await svc.maybeRefresh();
      await svc.maybeRefresh();
      nowMs += 4 * 60_000 + 59_000;
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);

      nowMs += 1_000;
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('never runs two reads at once', async () => {
      let release: (run: ClaudeUsageRun) => void = () => {};
      const run = vi.fn(
        () => new Promise<ClaudeUsageRun>(resolve => (release = resolve))
      );
      const svc = service({ run, minFetchIntervalMs: 0 });

      const first = svc.maybeRefresh();
      const second = svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
      release(good());
      await Promise.all([first, second]);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('throttles a failing read just the same, so a broken claude is not hammered', async () => {
      const run = runnerOf({ kind: 'timed-out' });
      const svc = service({ run });
      await svc.maybeRefresh();
      nowMs += 60_000;
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('rides snapshot pulls: a pull starts the read, a later pull inside the window does not', async () => {
      const run = runnerOf(good());
      const svc = service({ run });
      void svc.maybeRefresh();
      void svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('every degraded state is its own named cause', () => {
    const cases: Array<[string, ClaudeUsageRun, string]> = [
      [
        'missing binary',
        finished('', 127, 'claude: command not found'),
        'not-installed',
      ],
      ['signed out', finished(stdoutOf(SIGNED_OUT_REAL)), 'no-plan'],
      ['timeout', { kind: 'timed-out' }, 'timed-out'],
      ['non-zero exit', finished('', 1, 'boom'), 'exited'],
      [
        'changed format',
        finished(stdoutOf(envelope('Current session: 4% left'))),
        'unrecognized',
      ],
    ];

    it.each(cases)(
      '%s: unavailable with its cause, and no windows nobody read',
      async (_label, run, cause) => {
        const svc = service({ run: runnerOf(run) });
        await svc.maybeRefresh();
        const view = svc.view();
        expect(view.account).toMatchObject({
          status: 'unavailable',
          failure: cause,
          observedAt: null,
        });
        // Never 0%: there is no window at all, and nothing claims a reading.
        expect(view.windows).toEqual([]);
        expect(view.observations).toEqual([]);
        expect(fs.readdirSync(stateDir)).toEqual([]);
      }
    );

    it('names a new cause when the cause changes, and says so to listeners', async () => {
      const svc = service({
        run: runnerOf({ kind: 'timed-out' }, finished('', 127)),
        minFetchIntervalMs: 0,
      });
      const updates = vi.fn();
      svc.onUpdated(updates);

      await svc.maybeRefresh();
      expect(svc.view().account.failure).toBe('timed-out');
      expect(updates).toHaveBeenCalledTimes(1);

      await svc.maybeRefresh();
      expect(svc.view().account.failure).toBe('not-installed');
      expect(updates).toHaveBeenCalledTimes(2);

      // The same cause again changes nothing, so nothing is announced.
      await svc.maybeRefresh();
      expect(updates).toHaveBeenCalledTimes(2);
    });
  });

  describe('the last good value', () => {
    it('is kept at its TRUE observed time when a later read fails', async () => {
      const svc = service({
        run: runnerOf(good(), { kind: 'timed-out' }),
        minFetchIntervalMs: 0,
      });
      await svc.maybeRefresh();
      const observedAt = svc.view().account.observedAt;
      expect(observedAt).toBe(OBSERVED_AT);

      nowMs += 90 * 60_000;
      await svc.maybeRefresh();

      const view = svc.view();
      expect(view.account).toMatchObject({
        status: 'unavailable',
        failure: 'timed-out',
        observedAt,
      });
      expect(view.windows).toHaveLength(3);
      // Every kept window still says when it was actually read, so the
      // renderer's freshness rule judges it; none was re-stamped as fresh.
      for (const w of view.windows) expect(w.observedAt).toBe(observedAt);
    });

    it('keeps its reset time, so it is judged stale once that reset passes', async () => {
      const svc = service({
        run: runnerOf(good(), finished(stdoutOf(SIGNED_OUT_REAL))),
        minFetchIntervalMs: 0,
      });
      await svc.maybeRefresh();
      nowMs += 60 * 60_000;
      await svc.maybeRefresh();
      const session = svc
        .view()
        .windows.find(w => w.limitId === 'claude-session')!;
      expect(session.resetsAt).toBe('2026-10-05T02:00:00.000Z');
      expect(session.observedAt).toBe(OBSERVED_AT);
    });

    it('is replaced, and the failure cleared, by the next good read', async () => {
      const svc = service({
        run: runnerOf(good(), { kind: 'timed-out' }, good()),
        minFetchIntervalMs: 0,
      });
      await svc.maybeRefresh();
      await svc.maybeRefresh();
      expect(svc.view().account.failure).toBe('timed-out');

      nowMs += 60_000;
      await svc.maybeRefresh();
      const view = svc.view();
      expect(view.account.status).toBe('ok');
      expect(view.account).not.toHaveProperty('failure');
      expect(view.account.observedAt).toBe(new Date(nowMs).toISOString());
    });

    it('survives a warm launch, and the failure does not', async () => {
      const first = service({
        run: runnerOf(good(), { kind: 'timed-out' }),
        minFetchIntervalMs: 0,
      });
      await first.maybeRefresh();
      await first.maybeRefresh();
      expect(first.view().account.failure).toBe('timed-out');

      const run = vi.fn();
      const warm = service({ run });
      const view = warm.view();
      expect(view.windows).toHaveLength(3);
      expect(view.account.observedAt).toBe(OBSERVED_AT);
      // The cause belongs to a read that has not happened in this launch.
      expect(view.account).not.toHaveProperty('failure');
      expect(run).not.toHaveBeenCalled();
    });

    it('persists windows and history only, never the report text', async () => {
      const svc = service();
      await svc.maybeRefresh();
      const persisted = fs.readFileSync(
        path.join(stateDir, 'claude-plan.json'),
        'utf8'
      );
      expect(persisted).not.toContain('contributing');
      expect(persisted).not.toContain('requests');
      expect(fs.readdirSync(stateDir)).toEqual(['claude-plan.json']);
    });
  });

  describe('the Privacy switch', () => {
    it('off constructs no process and serves absence', async () => {
      const run = runnerOf(good());
      const svc = service({ run, enabled: false });

      await svc.maybeRefresh();

      expect(run).not.toHaveBeenCalled();
      const view = svc.view();
      expect(view.windows).toEqual([]);
      expect(view.rates).toEqual({});
      expect(view.account).toMatchObject({
        status: 'disabled',
        observedAt: null,
      });
    });

    it('switching off mid-life hides the windows on the very next view, and starts nothing', async () => {
      const run = runnerOf(good());
      const svc = service({ run, minFetchIntervalMs: 0 });
      await svc.maybeRefresh();
      expect(svc.view().windows).toHaveLength(3);

      svc.setEnabled(false);
      expect(svc.view().windows).toEqual([]);
      expect(svc.view().account.status).toBe('disabled');
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('a read that finishes after the switch went off is dropped', async () => {
      let release: (run: ClaudeUsageRun) => void = () => {};
      const run = vi.fn(
        () => new Promise<ClaudeUsageRun>(resolve => (release = resolve))
      );
      const svc = service({ run, minFetchIntervalMs: 0 });
      const pending = svc.maybeRefresh();
      svc.setEnabled(false);
      release(good());
      await pending;
      expect(svc.view().windows).toEqual([]);
      expect(fs.readdirSync(stateDir)).toEqual([]);
    });

    it('switching back on recovers with a fresh read', async () => {
      const run = runnerOf(good());
      const svc = service({ run, enabled: false });
      svc.setEnabled(true);
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
      expect(svc.view().account.status).toBe('ok');
    });
  });

  it('observes pace from two spaced reads', async () => {
    const later = envelope(
      SIGNED_IN_REAL.result.replace(
        'Current week (all models): 92%',
        'Current week (all models): 94%'
      )
    );
    const svc = service({
      run: runnerOf(good(), finished(stdoutOf(later))),
      minFetchIntervalMs: 0,
    });
    await svc.maybeRefresh();
    nowMs += 60 * 60_000;
    await svc.maybeRefresh();
    const view = svc.view();
    const weeklyAll = view.windows.find(
      w => w.limitId === 'claude-weekly-all'
    )!;
    expect(view.rates[planWindowKey(weeklyAll)]).toBeCloseTo(2, 5);
  });

  describe('a state file that cannot be read (BUG-247)', () => {
    const stateFile = () => path.join(stateDir, 'claude-plan.json');

    it('is never written over, and its history is merged back once it reads', async () => {
      const first = service({ minFetchIntervalMs: 0 });
      await first.maybeRefresh();
      const saved = fs.readFileSync(stateFile());
      fs.chmodSync(stateFile(), 0o000);
      try {
        nowMs += 60 * 60_000;
        const blocked = service({ minFetchIntervalMs: 0 });
        expect(blocked.view().windows).toEqual([]);
        await blocked.maybeRefresh();
        expect(blocked.view().account.status).toBe('ok');
        fs.chmodSync(stateFile(), 0o600);
        expect(fs.readFileSync(stateFile())).toEqual(saved);

        nowMs += 60 * 60_000;
        await blocked.maybeRefresh();
        const warm = service({ run: vi.fn() });
        expect(warm.view().observations.length).toBeGreaterThan(3);
        expect(warm.view().account.observedAt).toBe(
          new Date(nowMs).toISOString()
        );
      } finally {
        fs.chmodSync(stateFile(), 0o600);
      }
    });

    it('sets unparsable bytes aside and starts fresh', async () => {
      fs.writeFileSync(stateFile(), '{"version":1,"windows":[');
      const svc = service();
      expect(svc.view().windows).toEqual([]);
      expect(
        fs
          .readdirSync(stateDir)
          .some(name => name.startsWith('claude-plan.json.corrupt-'))
      ).toBe(true);
      await svc.maybeRefresh();
      expect(
        JSON.parse(fs.readFileSync(stateFile(), 'utf8')).windows
      ).toHaveLength(3);
    });
  });
});

/* ------------------------------------------------------------------ */
/* composite — one seam, two source classes                             */
/* ------------------------------------------------------------------ */

describe('ProviderPlanCompositeSource', () => {
  const scannerSnapshot = (revision: number): LiveConsumptionSnapshot => {
    const snapshot = emptyLiveConsumptionSnapshot(0);
    snapshot.scanState.revision = revision;
    const observation = (hoursAgo: number, usedPercent: number) => ({
      source: 'codex' as const,
      limitId: 'codex',
      scope: 'primary' as const,
      windowMinutes: 300,
      usedPercent,
      observedAtMs: NOW_MS - hoursAgo * 3_600_000,
    });
    snapshot.windowObservations = [observation(1, 10), observation(0, 19.4)];
    snapshot.windowRates = { 'codex|codex|primary|300': 9.4 };
    return snapshot;
  };

  function fakeScanner(revision = 3) {
    const listeners = new Set<(event: ConsumptionUpdatedEvent) => void>();
    const scanner: ConsumptionScannerLike & {
      push(revision: number): void;
      rescans: number;
    } = {
      rescans: 0,
      snapshot: async () => scannerSnapshot(revision),
      rescan() {
        this.rescans += 1;
      },
      cancelScan: () => {},
      onUpdated(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      push(rev: number) {
        const state = scannerSnapshot(rev).scanState;
        for (const listener of listeners)
          listener({ revision: rev, scanState: state });
      },
    };
    return scanner;
  }

  const planService = (dir: string, run?: ClaudeUsageRunner) =>
    new ClaudePlanAccountService({
      stateDir: dir,
      enabled: true,
      run: run ?? (async () => finished(stdoutOf(SIGNED_IN_REAL))),
      now: () => NOW_MS,
      minFetchIntervalMs: 0,
      jitterMs: 0,
    });

  let stateDir: string;
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-composite-'));
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('merges the account’s windows and state into the one snapshot', async () => {
    const plan = planService(stateDir);
    const composite = new ProviderPlanCompositeSource(fakeScanner(), [plan]);

    await plan.maybeRefresh();
    const snapshot = await composite.snapshot();

    expect(snapshot.planWindows.map(w => w.limitId).sort()).toEqual([
      'claude-session',
      'claude-weekly-all',
      'claude-weekly-fable',
    ]);
    expect(snapshot.windowRates['codex|codex|primary|300']).toBeCloseTo(9.4, 5);
    expect(snapshot.providerPlanAccounts?.[0]).toMatchObject({
      source: 'claude-code',
      status: 'ok',
    });
    expect(snapshot.scanState.revision).toBe(3 + plan.view().revision);
  });

  it('carries a named failure to the snapshot the renderer pulls', async () => {
    const plan = planService(stateDir, async () => ({ kind: 'timed-out' }));
    const composite = new ProviderPlanCompositeSource(fakeScanner(), [plan]);
    await plan.maybeRefresh();
    const snapshot = await composite.snapshot();
    expect(
      snapshot.planWindows.filter(w => w.source === 'claude-code')
    ).toEqual([]);
    expect(snapshot.providerPlanAccounts?.[0]).toMatchObject({
      source: 'claude-code',
      status: 'unavailable',
      failure: 'timed-out',
    });
  });

  it('re-emits scanner events with the composed revision and emits on plan bumps', async () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const composite = new ProviderPlanCompositeSource(scanner, [plan]);
    const events: ConsumptionUpdatedEvent[] = [];
    composite.onUpdated(event => events.push(event));

    scanner.push(5);
    expect(events.at(-1)?.revision).toBe(5 + plan.view().revision);

    await plan.maybeRefresh();
    expect(events.at(-1)?.revision).toBe(5 + plan.view().revision);
    expect(events.at(-1)!.revision).toBeGreaterThan(events[0].revision);
    expect(events.at(-1)?.scanState.revision).toBe(events.at(-1)?.revision);
  });

  it('rescan nudges the plan refresh alongside the scanner pass', () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const spy = vi.spyOn(plan, 'maybeRefresh');
    new ProviderPlanCompositeSource(scanner, [plan]).rescan();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scanner.rescans).toBe(1);
  });

  it('reads an account only when its harness left local files', async () => {
    const scanner = fakeScanner();
    const plan = planService(stateDir);
    const spy = vi.spyOn(plan, 'maybeRefresh');
    const composite = new ProviderPlanCompositeSource(
      {
        ...scanner,
        snapshot: async () => ({
          ...scannerSnapshot(3),
          emptySources: ['claude-code'],
        }),
      },
      [plan]
    );
    await composite.snapshot();
    spy.mockClear();
    await composite.snapshot();
    composite.rescan();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('persisted Claude windows from before the label move', () => {
  it('re-reads a saved display sentence as the model scope it named', () => {
    const saved = (limitId: string, limitName: string | null): PlanWindow => ({
      source: 'claude-code',
      limitId,
      limitName,
      scope: 'primary',
      usedPercent: 10,
      windowMinutes: 10080,
      resetsAt: null,
      planType: 'max',
      observedAt: OBSERVED_AT,
      providerSessionId: '',
      origin: 'provider-account',
    });
    expect(
      migratePersistedLimitName(saved('claude-weekly-fable', 'Weekly — Fable'))
        .limitName
    ).toBe('Fable');
    expect(
      migratePersistedLimitName(
        saved('claude-weekly-all', 'Weekly — all models')
      ).limitName
    ).toBeNull();
    expect(
      migratePersistedLimitName(saved('claude-session', 'Current session'))
        .limitName
    ).toBeNull();
    expect(
      migratePersistedLimitName(saved('claude-weekly-fable', 'Fable')).limitName
    ).toBe('Fable');
  });
});

/* ------------------------------------------------------------------ */
/* the custody boundary stays closed                                    */
/* ------------------------------------------------------------------ */

describe('Exawatt reads no Claude credential and gates the read on no distribution', () => {
  const root = path.resolve(__dirname, '../../..');
  const trees = [
    'electron',
    'src',
    'packages/core/src',
    'scripts',
    'contracts',
  ];

  function sourceFiles(directory: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(root, directory), {
      withFileTypes: true,
    })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) sourceFiles(child, found);
      else if (/\.(ts|tsx|mjs|json)$/u.test(entry.name)) found.push(child);
    }
    return found;
  }

  const files = trees.flatMap(tree => sourceFiles(tree));
  const THIS_FILE = path.relative(root, __filename);
  // Spelled in pieces so this file is not itself an occurrence of what it
  // forbids (`grep -rn "<the keychain item>" electron src packages` is empty).
  const join = (...parts: string[]) => parts.join('');

  /** Where each retired token may still appear, and why. */
  const FORBIDDEN: Array<{
    token: string;
    why: string;
    allowed: readonly string[];
  }> = [
    {
      token: join('Claude Code', '-credentials'),
      why: 'the Keychain item Claude Code keeps its token in',
      allowed: [],
    },
    {
      token: join('find-generic', '-password'),
      why: 'the macOS Keychain read',
      allowed: [],
    },
    {
      token: join('/api/oauth', '/usage'),
      why: 'the endpoint the Keychain token was sent to',
      allowed: [],
    },
    {
      token: join('oauth-2025', '-04-20'),
      why: 'the beta header that endpoint required',
      allowed: [],
    },
    {
      token: join('claudePlan', 'Usage'),
      why: 'the retired distribution grant for the Keychain read',
      // The retired wire key is still accepted, and still validated, so a
      // stored copy of the official contract keeps parsing.
      allowed: [
        'packages/core/src/distribution/contract.ts',
        'packages/core/src/distribution/contract.test.ts',
        'contracts/conformance/schema-parity.test.ts',
        'contracts/distribution/v2/schema.json',
        'contracts/distribution/v2/fixtures/custom-distributor.json',
        'contracts/distribution/v2/fixtures/invalid-own-account-value.json',
        'scripts/distribution-build.test.mjs',
      ],
    },
    {
      token: join('isClaudePlanRemote', 'ReadAllowed'),
      why: 'the packaging-and-grant guard for the credentialed read',
      allowed: [],
    },
  ];

  it.each(FORBIDDEN)(
    'does not carry $token ($why) outside its allowed places',
    ({ token, allowed }) => {
      const offenders = files.filter(
        file =>
          file !== THIS_FILE &&
          !allowed.includes(file) &&
          fs.readFileSync(path.join(root, file), 'utf8').includes(token)
      );
      expect(offenders).toEqual([]);
    }
  );

  it('keeps the module free of any network, credential, or Keychain primitive', () => {
    const source = fs
      .readFileSync(
        path.join(root, 'electron/main/consumption/claude-plan-account.ts'),
        'utf8'
      )
      .replace(/\/\*[\s\S]*?\*\//gu, ' ')
      .replace(/(^|[^:])\/\/.*$/gmu, '$1 ');
    for (const forbidden of [
      /\bfetch\b/u,
      /\bhttps?:\/\//u,
      /\bsecurity\b/u,
      /accessToken/iu,
      /Authorization/u,
      /keychain/iu,
      /execFile\b/u,
    ]) {
      expect(
        source,
        `${forbidden} reappeared in claude-plan-account.ts`
      ).not.toMatch(forbidden);
    }
  });

  it('declares no distribution grant on the plan control or the capability projection', () => {
    const contract = fs.readFileSync(
      path.join(root, 'src/lib/hosted-features/contract.ts'),
      'utf8'
    );
    const claudeRow = /claudePlanWindows: \{[\s\S]*?\n  \},/u.exec(
      contract
    )![0];
    expect(claudeRow).toMatch(/requiresDistributionCapability: null/u);
    expect(claudeRow).not.toMatch(/ownAccount/u);
    expect(contract).not.toMatch(/ownAccount/u);
    const capabilities = fs.readFileSync(
      path.join(root, 'src/lib/distribution/capabilities.ts'),
      'utf8'
    );
    expect(capabilities).not.toMatch(/ownAccount/u);
  });
});
