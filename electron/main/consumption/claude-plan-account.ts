/**
 * ENG-038 slice 3 — the Claude plan-account read, through Claude Code's own
 * `/usage`.
 *
 * Claude Code records no plan, quota, or rate-limit data in its local files
 * (`docs/engineering/projects/consumption-spine.md` §4), so plan truth for
 * Claude can only come from the vendor. Slice 1 got it by reading Claude
 * Code's OAuth token out of the macOS Keychain; that path is gone. The
 * request now leaves through the operator's own `claude` binary and sign-in:
 *
 *   claude -p "/usage" --no-session-persistence --output-format json
 *
 * which answers with the account's windows and costs zero turns, zero money
 * and no saved session (verified 2026-10-04 on Claude Code 2.1.289). Custody
 * is SOURCE-OWNED, the same shape as the Codex app-server read: Exawatt never
 * reads, holds, or sends a Claude credential, makes no network call itself,
 * and so no distribution capability gates it.
 *
 * `/usage` prints prose, not a schema, so every unrecognized shape degrades
 * to a NAMED failure ("couldn't read" with a cause), never to 0% and never to
 * a stale figure shown as fresh. The parser is strict about the lines it
 * reads (`Current session|week …`) and ignores everything else, because the
 * report also carries free-text sections that change freely.
 *
 * Throttle and persistence are the shared `PlanAccountService`: one read per
 * five minutes riding snapshot pulls, the last good value kept at its true
 * `observedAt`.
 */
import { spawn } from 'node:child_process';
import type { PlanAccountFailureCause, PlanWindow } from '@exawatt/core';
import { defaultShell } from '../pty/session-manager';
import { planLoginShell, shellQuote } from '../pty/login-shell';
import {
  PlanAccountService,
  type PlanAccountRead,
  type PlanAccountReader,
  type PlanAccountReadFailure,
} from './plan-account-service';

const STATE_FILE = 'claude-plan.json';
/**
 * `/usage` also analyses the local session history, which took four seconds
 * of CPU on a 316-session machine, so the wait has to be generous.
 */
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** The exact invocation. Pinned by a test; every flag matters. */
export const CLAUDE_USAGE_ARGS = [
  '-p',
  '/usage',
  '--no-session-persistence',
  '--output-format',
  'json',
] as const;

const WEEK_MINUTES = 7 * 24 * 60;
const SESSION_MINUTES = 5 * 60;

/* ------------------------------------------------------------------ */
/* reset time — "Oct 4 at 6:59pm (America/Los_Angeles)" to an instant   */
/* ------------------------------------------------------------------ */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** `Oct`, `Sept` and `October` name month 10; `Octember` names none. */
function monthNumber(token: string): number {
  const lowered = token.toLowerCase();
  if (lowered.length < 3) return 0;
  return MONTHS.findIndex(name => name.startsWith(lowered)) + 1;
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** The zone's offset from UTC at an instant, in ms. Throws on an unknown zone. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant a wall-clock reading names in a zone. Two passes settle DST. */
function zonedInstantMs(wall: WallClock, timeZone: string): number {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute
  );
  const first = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(first, timeZone);
}

function yearInZone(instantMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(
      new Date(instantMs)
    )
  );
}

const RESET_PATTERN =
  /^(?:([A-Za-z]{3,9}) (\d{1,2}) (?:at )?)?(\d{1,2})(?::(\d{2}))? ?(am|pm) \(([^()]+)\)$/i;

/**
 * Resolves the printed reset to an absolute instant, or null when the text is
 * not that grammar. `/usage` prints no year, and a reset is always ahead of
 * the read, so the year is the zone's current one unless that lands more than
 * a day behind `nowMs`, which means the reset is in the new year (a Dec 31
 * read of a "Jan 1" reset). A time with no date is the next such time.
 */
export function parseClaudeResetTime(
  text: string,
  nowMs: number
): string | null {
  const match = RESET_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, timeZone] =
    match;
  const hour12 = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  try {
    if (monthName === undefined) {
      const zoneYear = yearInZone(nowMs, timeZone);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(new Date(nowMs));
      const get = (type: string) =>
        Number(parts.find(part => part.type === type)?.value);
      const today = {
        year: zoneYear,
        month: get('month'),
        day: get('day'),
        hour,
        minute,
      };
      const todayMs = zonedInstantMs(today, timeZone);
      if (todayMs >= nowMs) return new Date(todayMs).toISOString();
      const tomorrow = new Date(
        Date.UTC(today.year, today.month - 1, today.day + 1)
      );
      return new Date(
        zonedInstantMs(
          {
            year: tomorrow.getUTCFullYear(),
            month: tomorrow.getUTCMonth() + 1,
            day: tomorrow.getUTCDate(),
            hour,
            minute,
          },
          timeZone
        )
      ).toISOString();
    }
    const month = monthNumber(monthName);
    const day = Number(dayText);
    if (month < 1 || day < 1 || day > 31) return null;
    const year = yearInZone(nowMs, timeZone);
    let instant = zonedInstantMs({ year, month, day, hour, minute }, timeZone);
    if (instant < nowMs - 24 * 60 * 60_000) {
      instant = zonedInstantMs(
        { year: year + 1, month, day, hour, minute },
        timeZone
      );
    }
    // A date the calendar rolled over (Feb 30) is not a reset time.
    const back = new Date(instant + zoneOffsetMs(instant, timeZone));
    if (back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) {
      return null;
    }
    return new Date(instant).toISOString();
  } catch {
    // Not an IANA zone Intl knows: unrecognized, never guessed.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* the report — pure, fixture-drivable                                  */
/* ------------------------------------------------------------------ */

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * `Current session: 4% used · resets Oct 4 at 7pm (America/Los_Angeles)`
 * `Current week (Fable): 58% used · resets Oct 5 at 2am (America/Los_Angeles)`
 * The model scope is whatever Claude Code prints, never a fixed list.
 */
const LIMIT_LINE =
  /^Current (session|week)(?: \(([^()]+)\))?: (\d+(?:\.\d+)?)% used(?: · resets (.+))?$/;

/** Printed when `/usage` has no plan to report: signed out, or an API key. */
const COST_SUMMARY_LINE = /^Total cost:\s/m;

type ClaudeUsageReportParse =
  | { kind: 'windows'; windows: PlanWindow[] }
  | { kind: 'no-plan' }
  | { kind: 'unrecognized'; detail: string };

function windowOf(
  line: RegExpExecArray,
  observedAt: string,
  nowMs: number
): (PlanWindow & { limitId: string }) | string {
  const [, kind, scopeText, percentText, resetText] = line;
  const usedPercent = Number(percentText);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return `percent out of range in "${line[0]}"`;
  }
  let resetsAt: string | null = null;
  if (resetText !== undefined) {
    resetsAt = parseClaudeResetTime(resetText, nowMs);
    if (resetsAt === null) return `reset time not understood in "${line[0]}"`;
  }
  let limitId: string;
  let limitName: string | null = null;
  let windowMinutes: number;
  if (kind === 'session') {
    limitId = 'claude-session';
    windowMinutes = SESSION_MINUTES;
  } else {
    windowMinutes = WEEK_MINUTES;
    const scope = scopeText?.replace(/\s+only$/i, '').trim() ?? '';
    if (!scope || /^all models$/i.test(scope)) {
      limitId = 'claude-weekly-all';
    } else {
      limitId = `claude-weekly-${slug(scope)}`;
      limitName = scope;
    }
  }
  return {
    source: 'claude-code',
    limitId,
    limitName,
    scope: 'primary',
    usedPercent,
    windowMinutes,
    resetsAt,
    planType: null,
    observedAt,
    providerSessionId: '',
    origin: 'provider-account',
  };
}

/**
 * The `/usage` text to windows. Throw-free. A `Current …` line this grammar
 * cannot read fails the WHOLE report: a half-read limit list could hide the
 * very limit that is about to bite, so nothing partial is served.
 */
export function parseClaudeUsageReport(
  text: string,
  nowMs: number
): ClaudeUsageReportParse {
  const observedAt = new Date(nowMs).toISOString();
  const byId = new Map<string, PlanWindow>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('Current ')) continue;
    const match = LIMIT_LINE.exec(line);
    if (!match)
      return { kind: 'unrecognized', detail: `unreadable line "${line}"` };
    const parsed = windowOf(match, observedAt, nowMs);
    if (typeof parsed === 'string') {
      return { kind: 'unrecognized', detail: parsed };
    }
    if (byId.has(parsed.limitId)) {
      return {
        kind: 'unrecognized',
        detail: `two lines for the same limit "${parsed.limitId}"`,
      };
    }
    byId.set(parsed.limitId, parsed);
  }
  if (byId.size > 0) return { kind: 'windows', windows: [...byId.values()] };
  if (COST_SUMMARY_LINE.test(text)) return { kind: 'no-plan' };
  return { kind: 'unrecognized', detail: 'no limit lines in the report' };
}

/** What `claude -p … --output-format json` printed, judged. */
type ClaudeUsageOutputParse =
  | { kind: 'windows'; windows: PlanWindow[] }
  | { kind: 'failure'; cause: PlanAccountFailureCause; detail: string };

/**
 * The JSON envelope to windows. The report is the envelope's `result` text;
 * a login shell may print startup noise around it, so the envelope is the
 * last stdout line that is a JSON object.
 */
export function parseClaudeUsageOutput(
  stdout: string,
  nowMs: number
): ClaudeUsageOutputParse {
  let envelope: Record<string, unknown> | null = null;
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        envelope = parsed as Record<string, unknown>;
        break;
      }
    } catch {
      // Not the envelope; keep looking upward.
    }
  }
  if (!envelope) {
    return {
      kind: 'failure',
      cause: 'unrecognized',
      detail: 'no JSON envelope',
    };
  }
  if (envelope.is_error === true) {
    return {
      kind: 'failure',
      cause: 'exited',
      detail: 'claude reported an error',
    };
  }
  if (envelope.type !== 'result' || typeof envelope.result !== 'string') {
    return {
      kind: 'failure',
      cause: 'unrecognized',
      detail: 'envelope has no result text',
    };
  }
  const report = parseClaudeUsageReport(envelope.result, nowMs);
  if (report.kind === 'windows') return report;
  if (report.kind === 'no-plan') {
    return {
      kind: 'failure',
      cause: 'no-plan',
      detail: 'no plan limits reported',
    };
  }
  return { kind: 'failure', cause: 'unrecognized', detail: report.detail };
}

/**
 * State written before ENG-008 E15 stored display sentences as `limitName`
 * ("Weekly — Fable"). The field now names only a model scope, so a saved
 * window is re-read in the current meaning rather than rendered verbatim.
 */
export function migratePersistedLimitName(window: PlanWindow): PlanWindow {
  if (
    window.limitId === 'claude-session' ||
    window.limitId === 'claude-weekly-all'
  ) {
    return window.limitName === null ? window : { ...window, limitName: null };
  }
  const legacy = /^Weekly\s+\S\s+(.+)$/u.exec(window.limitName ?? '');
  return legacy ? { ...window, limitName: legacy[1] } : window;
}

/* ------------------------------------------------------------------ */
/* the process — the operator's own claude, asked once                  */
/* ------------------------------------------------------------------ */

/** What one run of the command produced. Nothing here is a credential. */
export type ClaudeUsageRun =
  | { kind: 'finished'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timed-out' }
  | { kind: 'spawn-failed' };

export type ClaudeUsageRunner = (timeoutMs: number) => Promise<ClaudeUsageRun>;

/** A shell that cannot find the command says so in one of these ways. */
const COMMAND_NOT_FOUND =
  /command not found|unknown command|is not recognized/i;

/**
 * Runs the operator's own `claude` through their login shell, so it is found
 * where their terminal finds it (a packaged app has a bare PATH). Pinned to
 * Exawatt's scratch directory, with the auto-updater off so a read can never
 * change anyone's install.
 */
export function createClaudeUsageRunner(
  options: { resolveShell?: () => Promise<string> } = {}
): ClaudeUsageRunner {
  const resolveShell = options.resolveShell ?? defaultShell;
  return async timeoutMs => {
    const shell = await resolveShell();
    const plan = planLoginShell(shell, {
      command: `claude ${CLAUDE_USAGE_ARGS.map(shellQuote).join(' ')}`,
    });
    return new Promise<ClaudeUsageRun>(resolve => {
      let settled = false;
      const settle = (run: ClaudeUsageRun) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(run);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, plan.args, {
          cwd: plan.cwd,
          env: { ...process.env, SHELL: shell, DISABLE_AUTOUPDATER: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
      } catch {
        resolve({ kind: 'spawn-failed' });
        return;
      }
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
        settle({ kind: 'timed-out' });
      }, timeoutMs);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < 64 * 1024) stderr += data.toString();
      });
      child.on('error', () => settle({ kind: 'spawn-failed' }));
      child.on('close', code =>
        settle({ kind: 'finished', exitCode: code ?? -1, stdout, stderr })
      );
    });
  };
}

const runClaudeUsage: ClaudeUsageRunner = createClaudeUsageRunner();

/**
 * One run, judged: windows, or the one named reason there are none. Each of a
 * missing binary, a timeout, a non-zero exit, a signed-out `claude` and an
 * unknown format is its own cause.
 */
export function judgeClaudeUsageRun(
  run: ClaudeUsageRun,
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
  const parsed = parseClaudeUsageOutput(run.stdout, nowMs);
  if (parsed.kind === 'failure') return { failure: parsed.cause };
  return { windows: parsed.windows, planType: null, spend: null };
}

function claudePlanReader(options: {
  run: ClaudeUsageRunner;
  now: () => number;
  timeoutMs: number;
}): PlanAccountReader {
  return async () => {
    const run = await options
      .run(options.timeoutMs)
      .catch((): ClaudeUsageRun => ({ kind: 'spawn-failed' }));
    return judgeClaudeUsageRun(run, options.now());
  };
}

/* ------------------------------------------------------------------ */
/* the service — the shared account-read life, with Claude's reader     */
/* ------------------------------------------------------------------ */

export interface ClaudePlanAccountOptions {
  /** Directory this service may write. Its ONLY write path. */
  stateDir: string;
  /** Seeded from settings; `setEnabled` applies the toggle live. */
  enabled: boolean;
  /** False in automated test launches: no Settings write can start it. */
  allowed?: boolean;
  /** The process run; injectable so tests replay recorded output. */
  run?: ClaudeUsageRunner;
  now?: () => number;
  minFetchIntervalMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
}

export class ClaudePlanAccountService extends PlanAccountService {
  constructor(options: ClaudePlanAccountOptions) {
    const now = options.now ?? Date.now;
    super({
      source: 'claude-code',
      stateDir: options.stateDir,
      stateFileName: STATE_FILE,
      stateLabel: 'Claude plan history',
      enabled: options.enabled,
      allowed: options.allowed,
      read: claudePlanReader({
        run: options.run ?? runClaudeUsage,
        now,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
      migrateWindow: migratePersistedLimitName,
      now,
      minFetchIntervalMs: options.minFetchIntervalMs,
      jitterMs: options.jitterMs,
    });
  }
}
