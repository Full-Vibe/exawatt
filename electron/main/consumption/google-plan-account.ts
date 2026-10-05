/**
 * ENG-038 slice 4 — the Google plan-account read, through Antigravity's own
 * `/usage` (ENG-008 E16, demo arc G4).
 *
 * Antigravity (`agy`) meters the operator's Google account in weekly limits
 * per model group ("Gemini Models"; "Claude and GPT models"), and answers
 *
 *   agy -p "/usage" --output-format json
 *
 * with a structured report and no agent turn (verified 2026-10-05 on 1.2.17:
 * `num_turns: 0`, `conversation_id: ""`, no conversation written). Custody is
 * SOURCE-OWNED like the Claude and Codex reads: the request leaves through
 * the operator's own `agy` under its own sign-in, Exawatt reads no credential
 * and makes no network call itself, and no distribution capability gates it.
 * Antigravity's conversation history (`history.jsonl`) is never read.
 *
 * Units: the vendor reports a REMAINING fraction of each window with an ISO
 * reset instant; the meter model wants percent USED, so the fraction is
 * inverted here and nowhere else. The report states no plan tier, so none is
 * shown. Every unrecognized shape degrades to a NAMED failure ("couldn't
 * read" with a cause), never to 0% and never to a stale figure shown as
 * fresh; a bucket the grammar cannot read fails the whole report, because a
 * half-read limit list could hide the limit about to bite.
 *
 * There is no local ledger for this account, so the composite cannot learn
 * from the corpus whether the harness exists; `installed()` states it from
 * the presence of Antigravity's state directory, the only thing read there.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PlanAccountFailureCause, PlanWindow } from '@exawatt/core';
import {
  COMMAND_NOT_FOUND,
  createLoginShellCommandRunner,
  lastJsonObject,
  type HarnessCommandRun,
  type HarnessCommandRunner,
} from './harness-command-run';
import {
  PlanAccountService,
  type PlanAccountRead,
  type PlanAccountReader,
  type PlanAccountReadFailure,
} from './plan-account-service';

const STATE_FILE = 'google-plan.json';
/** The real answer took about five seconds on 2026-10-05. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** The exact invocation. Pinned by a test; every flag matters. */
export const AGY_USAGE_ARGS = ['-p', '/usage', '--output-format', 'json'] as const;

/** The vendor's window names, in minutes. An unknown name is unrecognized:
 *  absence over a guessed denominator. */
const WINDOW_MINUTES: Readonly<Record<string, number>> = {
  weekly: 10_080,
  daily: 1_440,
  monthly: 43_200,
};

/** A report that names its own sign-in problem. Not yet captured from a real
 *  signed-out `agy`; the shape is a guess the test records as one. */
const SIGN_IN_NEEDED = /sign in|signed out|log ?in|not authenticated|authenticat/i;

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** "Gemini Models" -> "Gemini"; "Claude and GPT models" -> "Claude and GPT".
 *  The group name is the model scope the limit applies to. */
export function groupScope(name: string | null): string | null {
  const scope = (name ?? '').trim().replace(/(?:^|\s+)models?$/i, '').trim();
  return scope ? scope : null;
}

/** What `agy -p … --output-format json` printed, judged. */
type AgyUsageOutputParse =
  | { kind: 'windows'; windows: PlanWindow[] }
  | { kind: 'failure'; cause: PlanAccountFailureCause; detail: string };

const failure = (
  cause: PlanAccountFailureCause,
  detail: string
): AgyUsageOutputParse => ({ kind: 'failure', cause, detail });

/**
 * The JSON envelope to windows. Throw-free. `status` must be `SUCCESS` and
 * the envelope must carry the handled `usage` command: an answer with no
 * command is the model talking, not the account reporting.
 */
export function parseAgyUsageOutput(
  stdout: string,
  nowMs: number
): AgyUsageOutputParse {
  const envelope = lastJsonObject(stdout);
  if (!envelope) return failure('unrecognized', 'no JSON envelope');
  const status = text(envelope.status);
  if (status !== 'SUCCESS') {
    const said = `${text(envelope.response) ?? ''} ${text(envelope.error) ?? ''}`;
    return failure(
      SIGN_IN_NEEDED.test(said) ? 'no-plan' : 'exited',
      `status ${status ?? 'missing'}`
    );
  }
  const command = record(envelope.command);
  const data = record(command?.data);
  const groups = Array.isArray(data?.groups) ? data.groups : null;
  if (text(command?.name) !== 'usage' || !groups) {
    return failure('unrecognized', 'no usage report in the answer');
  }
  const observedAt = new Date(nowMs).toISOString();
  const byId = new Map<string, PlanWindow>();
  for (const rawGroup of groups) {
    const group = record(rawGroup);
    const buckets = group && Array.isArray(group.buckets) ? group.buckets : null;
    if (!group || !buckets) {
      return failure('unrecognized', 'a model group has no buckets');
    }
    const limitName = groupScope(text(group.name));
    for (const rawBucket of buckets) {
      const bucket = record(rawBucket);
      const id = text(bucket?.id);
      if (!bucket || !id) return failure('unrecognized', 'a bucket has no id');
      const windowName = text(bucket.window) ?? '';
      const windowMinutes = WINDOW_MINUTES[windowName];
      if (!windowMinutes) {
        return failure('unrecognized', `window "${windowName}" not understood in "${id}"`);
      }
      const remaining = finite(bucket.remaining_fraction);
      if (remaining === null || remaining < 0 || remaining > 1) {
        return failure('unrecognized', `remaining fraction out of range in "${id}"`);
      }
      const resetsAtMs = Date.parse(text(bucket.reset_time) ?? '');
      if (Number.isNaN(resetsAtMs)) {
        return failure('unrecognized', `reset time not understood in "${id}"`);
      }
      if (byId.has(id)) {
        return failure('unrecognized', `two buckets with the id "${id}"`);
      }
      byId.set(id, {
        source: 'antigravity',
        limitId: id,
        limitName,
        scope: 'primary',
        // The vendor states what is LEFT; the meters state what is used.
        usedPercent: Math.round((1 - remaining) * 1000) / 10,
        windowMinutes,
        resetsAt: new Date(resetsAtMs).toISOString(),
        planType: null,
        observedAt,
        providerSessionId: '',
        origin: 'provider-account',
      });
    }
  }
  if (byId.size === 0) {
    return failure('unrecognized', 'no limit buckets in the report');
  }
  return { kind: 'windows', windows: [...byId.values()] };
}

/**
 * One run, judged: windows, or the one named reason there are none. Each of a
 * missing binary, a timeout, a non-zero exit and an unknown format is its own
 * cause; none of them is ever a zero.
 */
export function judgeAgyUsageRun(
  run: HarnessCommandRun,
  nowMs: number
): PlanAccountRead | PlanAccountReadFailure {
  if (run.kind === 'timed-out') return { failure: 'timed-out' };
  if (run.kind === 'spawn-failed') return { failure: 'exited' };
  if (run.exitCode !== 0) {
    return {
      failure:
        run.exitCode === 127 || COMMAND_NOT_FOUND.test(run.stderr)
          ? 'not-installed'
          : 'exited',
    };
  }
  const parsed = parseAgyUsageOutput(run.stdout, nowMs);
  if (parsed.kind === 'failure') return { failure: parsed.cause };
  return { windows: parsed.windows, planType: null, spend: null };
}

/**
 * Runs the operator's own `agy` through their login shell, so it is found
 * where their terminal finds it, from Exawatt's scratch directory. Antigravity
 * exposes no switch for its own update check (it runs one at most every
 * fifteen minutes on any invocation), so the read is simply the same
 * invocation the operator's own use makes.
 */
export function createAgyUsageRunner(
  options: { resolveShell?: () => Promise<string> } = {}
): HarnessCommandRunner {
  return createLoginShellCommandRunner({
    command: 'agy',
    args: AGY_USAGE_ARGS,
    resolveShell: options.resolveShell,
  });
}

const runAgyUsage = createAgyUsageRunner();

function googlePlanReader(options: {
  run: HarnessCommandRunner;
  now: () => number;
  timeoutMs: number;
}): PlanAccountReader {
  return async () => {
    const run = await options
      .run(options.timeoutMs)
      .catch((): HarnessCommandRun => ({ kind: 'spawn-failed' }));
    return judgeAgyUsageRun(run, options.now());
  };
}

/** Where Antigravity keeps its state. Its PRESENCE is all Exawatt reads. */
export function defaultAntigravityHome(home = os.homedir()): string {
  return path.join(home, '.gemini', 'antigravity-cli');
}

interface GooglePlanAccountOptions {
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  /** Seeded from settings; `setEnabled` applies the toggle live. */
  enabled: boolean;
  /** False in automated test launches: no Settings write can start it. */
  allowed?: boolean;
  /** The process run; injectable so tests replay recorded output. */
  run?: HarnessCommandRunner;
  /** Antigravity's state directory; its presence means the operator uses it. */
  antigravityHome?: string;
  now?: () => number;
  minFetchIntervalMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
}

export class GooglePlanAccountService extends PlanAccountService {
  private readonly antigravityHome: string;
  private present = false;

  constructor(options: GooglePlanAccountOptions) {
    const now = options.now ?? Date.now;
    super({
      source: 'antigravity',
      stateDir: options.stateDir,
      stateFileName: STATE_FILE,
      stateLabel: 'Google plan history',
      enabled: options.enabled,
      allowed: options.allowed,
      read: googlePlanReader({
        run: options.run ?? runAgyUsage,
        now,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
      now,
      minFetchIntervalMs: options.minFetchIntervalMs,
      jitterMs: options.jitterMs,
    });
    this.antigravityHome = options.antigravityHome ?? defaultAntigravityHome();
  }

  /**
   * Whether Antigravity is on this machine: its state directory exists. A
   * stat, never a read. Sticky once true, so an operator who installs it
   * mid-launch is picked up and one who removes it keeps the last reading at
   * its true age until the next read says why it failed.
   */
  installed(): boolean {
    if (this.present) return true;
    try {
      this.present = fs.statSync(this.antigravityHome).isDirectory();
    } catch {
      this.present = false;
    }
    return this.present;
  }
}
