/**
 * ENG-038 slice 4 — the Google plan-account read through Antigravity's own
 * `/usage`.
 *
 * Pinned to REAL captured output (two states of the operator's account on
 * 2026-10-05), then to the honesty rules: every degraded state is its own
 * named cause with no window nobody read (unreadable is never zero); a lost
 * read keeps the last good windows at their true observed instant; a machine
 * without Antigravity is never asked and never carries the account.
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
} from '@exawatt/core';
import {
  AGY_USAGE_ARGS,
  GooglePlanAccountService,
  createAgyUsageRunner,
  defaultAntigravityHome,
  groupScope,
  judgeAgyUsageRun,
  parseAgyUsageOutput,
} from './google-plan-account';
import type {
  HarnessCommandRun,
  HarnessCommandRunner,
} from './harness-command-run';
import { SIGNED_IN_NEARLY_SPENT, SIGNED_IN_SPENT } from './agy-usage.fixtures';
import { ProviderPlanCompositeSource } from './provider-plan-composite';
import type { ConsumptionScannerLike } from '../consumption-ipc';

/** 2026-10-05 12:30 in Los Angeles, when the fixtures were captured. */
const NOW_MS = Date.parse('2026-10-05T19:30:00.000Z');
const OBSERVED_AT = new Date(NOW_MS).toISOString();

const stdoutOf = (body: unknown) => `${JSON.stringify(body)}\n`;
const finished = (stdout: string, exitCode = 0, stderr = ''): HarnessCommandRun => ({
  kind: 'finished',
  exitCode,
  stdout,
  stderr,
});

function windowsOf(stdout: string) {
  const parsed = parseAgyUsageOutput(stdout, NOW_MS);
  if (parsed.kind !== 'windows') {
    throw new Error(`expected windows, got ${JSON.stringify(parsed)}`);
  }
  return parsed.windows;
}

/* ------------------------------------------------------------------ */
/* the real report                                                      */
/* ------------------------------------------------------------------ */

describe('the real /usage report (Antigravity CLI 1.2.17)', () => {
  it('reads one weekly limit per model group, used percent from the remaining fraction', () => {
    expect(
      windowsOf(stdoutOf(SIGNED_IN_NEARLY_SPENT)).map(w => ({
        id: w.limitId,
        name: w.limitName,
        used: w.usedPercent,
        minutes: w.windowMinutes,
        resetsAt: w.resetsAt,
      }))
    ).toEqual([
      {
        id: 'gemini-weekly',
        name: 'Gemini',
        // 0.0010104 remaining: 99.9% used, the state the page exists for.
        used: 99.9,
        minutes: 10_080,
        resetsAt: '2026-10-09T00:56:53.000Z',
      },
      {
        id: '3p-weekly',
        name: 'Claude and GPT',
        used: 0,
        minutes: 10_080,
        resetsAt: '2026-10-12T19:14:14.000Z',
      },
    ]);
  });

  it('reads a spent group as 100% used', () => {
    const [gemini] = windowsOf(stdoutOf(SIGNED_IN_SPENT));
    expect(gemini).toMatchObject({ limitId: 'gemini-weekly', usedPercent: 100 });
  });

  it('enters every window as the account’s own reading, observed now, with no plan tier', () => {
    for (const w of windowsOf(stdoutOf(SIGNED_IN_NEARLY_SPENT))) {
      expect(w).toMatchObject({
        source: 'antigravity',
        scope: 'primary',
        planType: null,
        observedAt: OBSERVED_AT,
        providerSessionId: '',
        origin: 'provider-account',
      });
    }
    const read = judgeAgyUsageRun(finished(stdoutOf(SIGNED_IN_NEARLY_SPENT)), NOW_MS);
    expect(read).toMatchObject({ planType: null, spend: null });
  });

  it('keys each group’s bucket so pace history continues across reads', () => {
    const [gemini, third] = windowsOf(stdoutOf(SIGNED_IN_NEARLY_SPENT));
    expect(planWindowKey(gemini)).toBe('antigravity|gemini-weekly|primary|10080');
    expect(planWindowKey(third)).toBe('antigravity|3p-weekly|primary|10080');
  });

  it('names the scope after the group, without the word "models"', () => {
    expect(groupScope('Gemini Models')).toBe('Gemini');
    expect(groupScope('Claude and GPT models')).toBe('Claude and GPT');
    expect(groupScope('Imagen model')).toBe('Imagen');
    expect(groupScope(null)).toBeNull();
    expect(groupScope('  models ')).toBeNull();
  });

  it('reads the envelope from under login-shell noise', () => {
    const noisy = `Welcome back\n${JSON.stringify(SIGNED_IN_NEARLY_SPENT)}\n`;
    expect(windowsOf(noisy)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* unreadable is never zero                                             */
/* ------------------------------------------------------------------ */

describe('every unreadable shape is a named cause, never a window', () => {
  const withBucket = (bucket: Record<string, unknown>) => {
    const body = structuredClone(SIGNED_IN_NEARLY_SPENT);
    body.command.data.groups[0].buckets[0] = {
      ...body.command.data.groups[0].buckets[0],
      ...bucket,
    } as (typeof body.command.data.groups)[0]['buckets'][0];
    return stdoutOf(body);
  };

  const cases: Array<[string, HarnessCommandRun, string]> = [
    ['missing binary', finished('', 127, 'agy: command not found'), 'not-installed'],
    ['a shell that says it cannot find agy', finished('', 1, 'fish: Unknown command: agy'), 'not-installed'],
    ['timeout', { kind: 'timed-out' }, 'timed-out'],
    ['a process that would not start', { kind: 'spawn-failed' }, 'exited'],
    ['non-zero exit', finished('', 1, 'boom'), 'exited'],
    ['no JSON at all', finished('Gemini Models\tWeekly Limit Remaining\t0%\n'), 'unrecognized'],
    [
      'the model answered instead of the command',
      finished(stdoutOf({ status: 'SUCCESS', response: 'Here is your usage…', num_turns: 1 })),
      'unrecognized',
    ],
    ['a failed status', finished(stdoutOf({ status: 'FAILURE', response: 'internal error' })), 'exited'],
    [
      'a failed status that asks to sign in (shape not yet captured from a real signed-out agy)',
      finished(stdoutOf({ status: 'FAILURE', response: 'Please sign in to continue' })),
      'no-plan',
    ],
    ['a window name the grammar does not know', finished(withBucket({ window: 'fortnightly' })), 'unrecognized'],
    ['a remaining fraction above one', finished(withBucket({ remaining_fraction: 1.2 })), 'unrecognized'],
    ['a remaining fraction that is text', finished(withBucket({ remaining_fraction: '0.5' })), 'unrecognized'],
    ['a reset that is not an instant', finished(withBucket({ reset_time: 'in 3 days' })), 'unrecognized'],
    ['a bucket with no id', finished(withBucket({ id: '' })), 'unrecognized'],
    [
      'two buckets with one id',
      finished(
        stdoutOf({
          ...SIGNED_IN_NEARLY_SPENT,
          command: {
            name: 'usage',
            data: {
              groups: [
                SIGNED_IN_NEARLY_SPENT.command.data.groups[0],
                SIGNED_IN_NEARLY_SPENT.command.data.groups[0],
              ],
            },
          },
        })
      ),
      'unrecognized',
    ],
    [
      'no buckets at all',
      finished(stdoutOf({ ...SIGNED_IN_NEARLY_SPENT, command: { name: 'usage', data: { groups: [] } } })),
      'unrecognized',
    ],
  ];

  it.each(cases)('%s', (_label, run, cause) => {
    const judged = judgeAgyUsageRun(run, NOW_MS);
    expect(judged).toEqual({ failure: cause });
    // Nothing partial: a half-read limit list could hide the limit about to bite.
    expect(judged).not.toHaveProperty('windows');
  });

  it('fails the whole report when one bucket is unreadable, even if another is fine', () => {
    const body = structuredClone(SIGNED_IN_NEARLY_SPENT);
    body.command.data.groups[1].buckets[0].window = 'quarterly';
    expect(parseAgyUsageOutput(stdoutOf(body), NOW_MS)).toMatchObject({
      kind: 'failure',
      cause: 'unrecognized',
    });
  });
});

/* ------------------------------------------------------------------ */
/* the process — the operator's own agy, asked once                      */
/* ------------------------------------------------------------------ */

describe('createAgyUsageRunner', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-agy-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function scriptedShell(body: string): () => Promise<string> {
    const shell = path.join(dir, 'fakesh');
    fs.writeFileSync(
      shell,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv"\npwd > "${dir}/cwd"\n${body}\n`,
      { mode: 0o755 }
    );
    return async () => shell;
  }

  it('asks the operator’s own agy for /usage as JSON and nothing else', async () => {
    const fixture = path.join(dir, 'usage.json');
    fs.writeFileSync(fixture, stdoutOf(SIGNED_IN_NEARLY_SPENT));
    const run = createAgyUsageRunner({ resolveShell: scriptedShell(`cat "${fixture}"`) });
    const result = await run(10_000);
    expect(result).toMatchObject({ kind: 'finished', exitCode: 0 });
    const argv = fs.readFileSync(path.join(dir, 'argv'), 'utf8').trim().split('\n');
    expect(argv.slice(0, 2)).toEqual(['-l', '-c']);
    expect(argv[2]).toBe("agy '-p' '/usage' '--output-format' 'json'");
    expect(AGY_USAGE_ARGS).toEqual(['-p', '/usage', '--output-format', 'json']);
    // Run from Exawatt's scratch directory, never from a Project.
    expect(fs.readFileSync(path.join(dir, 'cwd'), 'utf8').trim()).not.toBe(process.cwd());
    expect(judgeAgyUsageRun(result, NOW_MS)).toMatchObject({ windows: expect.any(Array) });
  });

  it('stops an agy that does not answer, and says it timed out', async () => {
    const run = createAgyUsageRunner({ resolveShell: scriptedShell('sleep 30') });
    const result = await run(150);
    expect(result).toEqual({ kind: 'timed-out' });
    expect(judgeAgyUsageRun(result, NOW_MS)).toEqual({ failure: 'timed-out' });
  });
});

/* ------------------------------------------------------------------ */
/* the service — last good value, presence, composite                    */
/* ------------------------------------------------------------------ */

describe('GooglePlanAccountService', () => {
  let stateDir: string;
  let home: string;
  let nowMs: number;

  const good = (body: unknown = SIGNED_IN_NEARLY_SPENT): HarnessCommandRun =>
    finished(stdoutOf(body));

  function runnerOf(...runs: HarnessCommandRun[]): HarnessCommandRunner & ReturnType<typeof vi.fn> {
    let call = 0;
    return vi.fn(async () => runs[Math.min(call++, runs.length - 1)]);
  }

  const service = (over: { run?: HarnessCommandRunner; antigravityHome?: string } = {}) =>
    new GooglePlanAccountService({
      stateDir,
      enabled: true,
      run: over.run ?? runnerOf(good()),
      antigravityHome: over.antigravityHome ?? home,
      now: () => nowMs,
      minFetchIntervalMs: 5 * 60_000,
      jitterMs: 0,
    });

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exa-google-plan-'));
    home = path.join(stateDir, 'antigravity-cli');
    fs.mkdirSync(home);
    nowMs = NOW_MS;
  });
  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('serves the account’s windows after a refresh, as the antigravity account', async () => {
    const svc = service();
    expect(svc.source).toBe('antigravity');
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account).toMatchObject({
      source: 'antigravity',
      status: 'ok',
      observedAt: OBSERVED_AT,
      planType: null,
    });
    expect(view.windows.map(w => w.limitId)).toEqual(['gemini-weekly', '3p-weekly']);
  });

  it('a lost read keeps the last good windows at their TRUE observed instant and names the cause', async () => {
    const run = runnerOf(good(), { kind: 'timed-out' });
    const svc = service({ run });
    await svc.maybeRefresh();
    nowMs += 6 * 60_000;
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account).toMatchObject({
      status: 'unavailable',
      failure: 'timed-out',
      // The successful read's instant, not the failed one's.
      observedAt: OBSERVED_AT,
    });
    expect(view.windows).toHaveLength(2);
    for (const w of view.windows) expect(w.observedAt).toBe(OBSERVED_AT);
    // The old figure is still the old figure: it never became 0% or fresh.
    expect(view.windows[0].usedPercent).toBe(99.9);
  });

  it('a read that never succeeded serves no window: unreadable is not zero', async () => {
    const svc = service({ run: runnerOf(finished('', 127, 'agy: command not found')) });
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account).toMatchObject({
      status: 'unavailable',
      failure: 'not-installed',
      observedAt: null,
    });
    expect(view.windows).toEqual([]);
    expect(view.observations).toEqual([]);
    expect(fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))).toEqual([]);
  });

  it('a later good read replaces the stale figure and clears the cause', async () => {
    const run = runnerOf(good(), { kind: 'timed-out' }, good(SIGNED_IN_SPENT));
    const svc = service({ run });
    await svc.maybeRefresh();
    nowMs += 6 * 60_000;
    await svc.maybeRefresh();
    nowMs += 6 * 60_000;
    await svc.maybeRefresh();
    const view = svc.view();
    expect(view.account.status).toBe('ok');
    expect(view.account).not.toHaveProperty('failure');
    expect(view.windows[0].usedPercent).toBe(100);
    expect(view.account.observedAt).toBe(new Date(nowMs).toISOString());
  });

  it('states Antigravity’s presence from its state directory, and never reads inside it', () => {
    expect(service().installed()).toBe(true);
    const absent = service({ antigravityHome: path.join(stateDir, 'nowhere') });
    expect(absent.installed()).toBe(false);
    // A later install is picked up on the next ask.
    fs.mkdirSync(path.join(stateDir, 'nowhere'));
    expect(absent.installed()).toBe(true);
    expect(defaultAntigravityHome('/Users/op')).toBe('/Users/op/.gemini/antigravity-cli');
  });

  describe('through the composite', () => {
    const scanner = (): ConsumptionScannerLike => ({
      async snapshot(): Promise<LiveConsumptionSnapshot> {
        const empty = emptyLiveConsumptionSnapshot(nowMs);
        return { ...empty, scanState: { ...empty.scanState, firstScanComplete: true } };
      },
      rescan() {},
      cancelScan() {},
      onUpdated(_listener: (event: ConsumptionUpdatedEvent) => void) {
        return () => {};
      },
    });

    it('never asks a machine without Antigravity, and carries no Google account there', async () => {
      const run = runnerOf(good());
      const svc = service({ run, antigravityHome: path.join(stateDir, 'nowhere') });
      const composite = new ProviderPlanCompositeSource(scanner(), [svc]);
      const snapshot = await composite.snapshot();
      // The composite nudges synchronously after the scanner answers, and a
      // nudge starts the run synchronously, so a run would already show.
      expect(run).not.toHaveBeenCalled();
      expect(snapshot.providerPlanAccounts).toEqual([]);
      expect(snapshot.planWindows).toEqual([]);
    });

    it('asks a machine with Antigravity and carries the account with its windows', async () => {
      const run = runnerOf(good());
      const svc = service({ run });
      const composite = new ProviderPlanCompositeSource(scanner(), [svc]);
      await composite.snapshot();
      await svc.maybeRefresh();
      expect(run).toHaveBeenCalledTimes(1);
      const snapshot = await composite.snapshot();
      expect(snapshot.providerPlanAccounts?.map(a => a.source)).toEqual(['antigravity']);
      expect(snapshot.planWindows.map(w => w.limitId)).toEqual(['gemini-weekly', '3p-weekly']);
    });
  });
});
