/**
 * ENG-008 E12 — the vendor-multiplexer view model, shared by all three
 * directions in this study.
 *
 * THE ARCHITECTURE IS SETTLED (E12 research, 2026-08-14) and lives here, once,
 * so the three directions differ in EXPRESSION only. Anything a direction
 * derives for itself is a bug in this file.
 *
 * The settled rules this module enforces:
 *
 * 1. ORDER — headline (bound-framed, with coverage) → needs-attention rows
 *    (only when non-empty) → the full source roster → per-source detail.
 * 2. MONOTONICITY — losing information must never move the headline in the
 *    reassuring direction. Not just "never render 0": a dropped row, a shrunk
 *    denominator, and a silently narrowed source set violate it identically.
 *    Enforced structurally here: the roster is a FIXED list (`ROSTER`), the
 *    coverage denominator comes from that list rather than from what
 *    succeeded, and a failed read keeps its last-good windows at their TRUE
 *    `observedAtMs` instead of dropping them.
 * 3. LOWER-BOUND FRAMING — a knowably-incomplete total is stated as a bound
 *    ("At least X"), with coverage in the same line. No product in the E12
 *    corpus does this.
 * 4. GLANCE IS A PROJECTION — `ambientProjection()` drops columns from the
 *    same rows in the same order; it never computes its own summary. Every
 *    corpus failure (`ccusage`, AIQuotaBar, Codex Ratelimit, CodexBar #2707)
 *    happened where a glance ran a second code path.
 * 5. PERMANENTLY PARTIAL IS NORMAL — `unreadable` (broken, has a repair verb)
 *    is a different row state from `unavailable` (a settled fact about this
 *    account or plan, product language, no repair verb and no alarm color).
 *    A red dot that is always on trains the operator to ignore red dots.
 *
 * Pace, projection, opportunity and the pace vocabulary are NOT re-derived
 * here: every window reads through the production `readWindowPace` so this
 * study and the shipped title-bar meter are structurally incapable of
 * disagreeing.
 */
import {
  opportunityOf,
  readWindowPace,
  type MeterReading,
  type OpportunityRead,
} from '@/components/consumption/meter/meter-model';
import type {
  CapacityWindowView,
  ConsumptionSourceView,
} from '@/components/consumption/model';
import { duration, tokens } from '@/components/consumption/flux';
import { CAPTURE, type FixtureWindow } from './snapshot';

/* ------------------------------------------------------------------ */
/* row state — six states, not one                                     */
/* ------------------------------------------------------------------ */

/**
 * The read health of one source. Six states because the E12 corpus proved
 * one `—` discards the only actionable information (OpenUsage ships eleven
 * error categories; the four that matter to a desktop cockpit are here).
 *
 * `unreadable` and `unavailable` are the load-bearing split: the first is a
 * malfunction with a repair verb, the second is a fact about the account.
 */
export type RowState =
  | 'reporting'
  | 'stale'
  | 'reading'
  | 'unreadable'
  | 'unavailable'
  | 'not-connected';

/** Only these two ever appear in the needs-attention block. */
export const ATTENTION_STATES: readonly RowState[] = ['unreadable', 'stale'];

export const STATE_WORD: Record<RowState, string> = {
  reporting: 'Reporting',
  stale: 'Last read',
  reading: 'Reading',
  unreadable: 'Not readable',
  unavailable: 'Not available',
  'not-connected': 'Not connected',
};

/** Where a figure came from. Travels with the number, never a settings page. */
export type Provenance = 'account read' | 'local log' | 'no read';

/* ------------------------------------------------------------------ */
/* the roster — a fixed list, because the denominator may never shrink */
/* ------------------------------------------------------------------ */

export interface RosterEntry {
  id: string;
  vendor: string;
  /** What the operator calls the tab he keeps open for this. */
  account: string;
  lane: 'plan' | 'api';
  /** True when this source is one the headline is defined over (YNAB's tier
   *  rule: scope the reliability promise to the sources the number needs). */
  definesHeadline: boolean;
}

export const ROSTER: readonly RosterEntry[] = [
  {
    id: 'anthropic-plan',
    vendor: 'Anthropic',
    account: 'Claude Max',
    lane: 'plan',
    definesHeadline: true,
  },
  {
    id: 'openai-plan',
    vendor: 'OpenAI',
    account: 'Codex Pro',
    lane: 'plan',
    definesHeadline: true,
  },
  {
    id: 'xai-plan',
    vendor: 'xAI',
    account: 'Grok Build',
    lane: 'plan',
    definesHeadline: true,
  },
  {
    id: 'anthropic-console',
    vendor: 'Anthropic',
    account: 'Console workspace',
    lane: 'api',
    definesHeadline: false,
  },
  {
    id: 'openai-platform',
    vendor: 'OpenAI',
    account: 'Platform billing',
    lane: 'api',
    definesHeadline: false,
  },
];

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

export interface WindowRow {
  key: string;
  label: string;
  /** The production reading — pace, projection, state, exhaustion. */
  read: MeterReading;
  /** Firing opportunity, from the shared trigger. null when it does not. */
  opportunity: OpportunityRead | null;
  /** Meters the whole plan, not just this tool. Said once, per window. */
  planLevel: boolean;
  /** null when a rate is not derivable from one observation. */
  ratePerHour: number | null;
  history: readonly (readonly [number, number])[];
}

export interface SourceRow extends RosterEntry {
  state: RowState;
  /** Windows, soonest-to-bite first. Kept through failure at their true as-of. */
  windows: WindowRow[];
  /** ms epoch of the last successful read. null when there has never been one. */
  asOfMs: number | null;
  provenance: Provenance;
  /** Product language, not error language. Present on settled facts. */
  note: string | null;
  /** Only ever on `unreadable` / `not-connected` — never on a spent plan. */
  repair: { label: string; verb: string } | null;
  statusPage: string | null;
  /** Locally observed work over the corpus window. null when unmeasurable. */
  observedNt: number | null;
  observedRaw: number | null;
  sessions: number | null;
  spend: {
    used: number;
    limit: number | null;
    currency: string;
    enabled: boolean;
  } | null;
  planLabel: string | null;
}

/* ------------------------------------------------------------------ */
/* headline                                                            */
/* ------------------------------------------------------------------ */

export type VerdictTone = 'calm' | 'hot' | 'unknown';

export interface Verdict {
  /** The 2s answer, in words. A verdict, never a measurement. */
  word: string;
  tone: VerdictTone;
  /** One clause naming the window the verdict is about. */
  because: string;
  /** Set when the read set is incomplete — the verdict may not read plain. */
  degraded: boolean;
  degradedNote: string | null;
  /** Severity for the monotonicity assertion. Higher is less reassuring. */
  rank: number;
}

export interface Coverage {
  /** Sources returning a fresh read. */
  reporting: number;
  /** Sources the headline is defined over. NEVER derived from what worked. */
  defined: number;
  /** The whole roster, including lanes outside the headline's definition. */
  roster: number;
  line: string;
}

export interface Bound {
  /** "At least 1.4B normalized tokens" — one-sided on purpose. */
  label: string;
  value: number;
  /** True when something known-missing makes this a strict lower bound. */
  isBound: boolean;
  basis: string;
}

export interface Headline {
  verdict: Verdict;
  bound: Bound;
  coverage: Coverage;
  /** The window that bites first. The "what runs out first?" answer. */
  binding: WindowRow | null;
  bindingSource: SourceRow | null;
  /** The largest allocation that expires unused at this pace. */
  expiring: WindowRow | null;
  expiringSource: SourceRow | null;
}

/* ------------------------------------------------------------------ */
/* attribution — the 20-minute zone                                    */
/* ------------------------------------------------------------------ */

export type PivotId = 'project' | 'model' | 'session' | 'source';

export const PIVOTS: readonly { id: PivotId; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'source', label: 'Source' },
  { id: 'model', label: 'Model' },
  { id: 'session', label: 'Session' },
];

export interface LedgerRow {
  key: string;
  label: string;
  /** null is a real answer: not measurable in this unit. Never 0. */
  nt: number | null;
  raw: number | null;
  color: string | null;
  meta: string | null;
  /** A residual is drawn, named, and never absorbed into a neighbour. */
  residual: boolean;
  /** Provenance for this row, when it differs from the table's. */
  provenance: Provenance;
  asOfMs: number | null;
}

export interface Ledger {
  pivot: PivotId;
  /** Row zero. Computed INDEPENDENTLY of the rows so the two can disagree. */
  total: { nt: number; label: string; isBound: boolean };
  rows: LedgerRow[];
  /** Sum of the drawn rows. Disagreement with `total` is a rendered fact. */
  attributed: number;
}

/* ------------------------------------------------------------------ */
/* the five (plus one) study states                                    */
/* ------------------------------------------------------------------ */

export type StateId =
  | 'all-reporting'
  | 'unreadable'
  | 'unavailable'
  | 'dual-signal'
  | 'first-scan'
  | 'all-clear';

export interface StudyState {
  id: StateId;
  label: string;
  /** What this state asks the direction to prove. */
  question: string;
  /** Real capture, or the one authored state and why it had to be authored. */
  origin: 'measured' | 'authored';
  originNote: string;
}

export const STATES: readonly StudyState[] = [
  {
    id: 'all-reporting',
    label: 'Every source reporting',
    question:
      'Nothing needs attention. Does the page stay quiet without going blank?',
    origin: 'measured',
    originNote: 'The capture, unmodified.',
  },
  {
    id: 'unreadable',
    label: 'Claude read expired',
    question: 'One source breaks. Does the headline get more reassuring?',
    origin: 'measured',
    originNote:
      'The capture with the Claude account read removed; its last good windows keep their true as-of.',
  },
  {
    id: 'unavailable',
    label: 'Grok has no plan window',
    question:
      'A settled fact, not a fault. Does it read as product state or as an error?',
    origin: 'measured',
    originNote:
      'Real: Grok Build keeps no plan record locally and xAI publishes no per-tier limits.',
  },
  {
    id: 'dual-signal',
    label: 'Hot window + expiring window',
    question:
      'Two opposite signals at once. Can one headline carry both without either being ignored?',
    origin: 'measured',
    originNote:
      'The capture: Weekly — Fable is spent before its reset while the Codex weekly expires 80% unused.',
  },
  {
    id: 'first-scan',
    label: 'First read in progress',
    question:
      'Every local figure is a lower bound. Does the page say so where the numbers are?',
    origin: 'measured',
    originNote:
      'The capture with the scan rewound to a partial pass; plan windows are unaffected.',
  },
  {
    id: 'all-clear',
    label: 'All clear',
    question: 'The dangerous state: the page is allowed to say "you are fine".',
    origin: 'authored',
    originNote:
      'The only authored state here. Three days of recorded plan history on this machine never put the Fable weekly below 96%, so no measured all-clear exists to render.',
  },
];

export const DEFAULT_STATE: StateId = 'dual-signal';

/* ------------------------------------------------------------------ */
/* construction                                                        */
/* ------------------------------------------------------------------ */

/** A minimal source view so windows read through the production derivation. */
function sourceViewFor(entry: RosterEntry): ConsumptionSourceView {
  return {
    key: entry.id,
    harness:
      entry.id === 'openai-plan'
        ? 'codex'
        : entry.id === 'xai-plan'
          ? 'grok'
          : 'claude-code',
    label: `${entry.vendor} · ${entry.account}`,
    planType: null,
    credits: null,
    windows: [],
    observedTokens5h: 0,
    observedSessions: 0,
    observedDelegatedShare: null,
    burn: [],
  };
}

function capacityOf(w: FixtureWindow, asOfMs: number): CapacityWindowView {
  return {
    limitId: w.key,
    label: w.label,
    usedPercent: w.usedPercent,
    windowMinutes: w.windowMinutes,
    resetsAtMs: w.resetsAtMs,
    burnPercentPerHour: w.ratePerHour ?? 0,
    observedAtMs: asOfMs,
    ...(w.planLevel ? { planLevel: true } : {}),
  };
}

function windowRow(
  entry: RosterEntry,
  w: FixtureWindow,
  asOfMs: number,
  nowMs: number
): WindowRow {
  const read = readWindowPace(
    sourceViewFor(entry),
    capacityOf(w, asOfMs),
    nowMs
  );
  return {
    key: w.key,
    label: w.label,
    read,
    opportunity: w.ratePerHour === null ? null : opportunityOf(read),
    planLevel: w.planLevel,
    ratePerHour: w.ratePerHour,
    history: w.history,
  };
}

/** Soonest to bite first — the fix for `/usage`'s "most consumed" ordering. */
function byBite(a: WindowRow, b: WindowRow): number {
  const ae = a.read.exhaustsBeforeReset ? a.read.msToExhaust : Infinity;
  const be = b.read.exhaustsBeforeReset ? b.read.msToExhaust : Infinity;
  if (ae !== be) return ae - be;
  return b.read.usedPercent - a.read.usedPercent;
}

export interface RosterView {
  state: StudyState;
  nowMs: number;
  rows: SourceRow[];
  attention: SourceRow[];
  headline: Headline;
  scan: {
    phase: 'idle' | 'first-scan';
    filesSeen: number;
    filesTotal: number;
    lastScanAtMs: number | null;
    complete: boolean;
  };
  corpus: typeof CAPTURE.corpus;
}

/**
 * The one builder. Every direction renders this; none of them re-derives.
 */
export function buildRoster(stateId: StateId): RosterView {
  const state = STATES.find(s => s.id === stateId) ?? STATES[0];
  const nowMs = CAPTURE.capturedAtMs;
  const clear = stateId === 'all-clear';

  /* ---- Anthropic · Claude Max ---- */
  const claudeBroken = stateId === 'unreadable';
  // A failed read never destroys good data (CodexBar #1220): the row keeps the
  // last SUCCESSFUL observation, which is a real earlier point in this
  // machine's own history, at its true instant.
  const lastGood = claudeBroken ? lastGoodClaudeRead() : null;
  const claudeWindows = clear
    ? allClearClaudeWindows()
    : (lastGood?.windows ?? CAPTURE.claude.windows);
  const claudeAsOf = lastGood?.atMs ?? CAPTURE.claude.observedAtMs;
  const anthropicPlan: SourceRow = {
    ...ROSTER[0],
    state: claudeBroken ? 'unreadable' : 'reporting',
    windows: claudeWindows
      .map(w => windowRow(ROSTER[0], w, claudeAsOf, nowMs))
      .sort(byBite),
    asOfMs: claudeAsOf,
    provenance: 'account read',
    note: claudeBroken
      ? null
      : 'Plan truth: meters everything on the account, claude.ai chat included.',
    repair: claudeBroken
      ? { label: 'Re-login in Claude Code', verb: 'claude /login' }
      : null,
    statusPage: 'status.anthropic.com',
    observedNt: CAPTURE.claude.observedNt,
    observedRaw: CAPTURE.claude.observedRaw,
    sessions: CAPTURE.claude.sessions,
    spend: CAPTURE.claude.spend
      ? {
          used: CAPTURE.claude.spend.usedMinor / 100,
          limit:
            CAPTURE.claude.spend.limitMinor === null
              ? null
              : CAPTURE.claude.spend.limitMinor / 100,
          currency: CAPTURE.claude.spend.currency,
          enabled: CAPTURE.claude.spend.enabled,
        }
      : null,
    planLabel: CAPTURE.claude.planType,
  };

  /* ---- OpenAI · Codex Pro ---- */
  // The Codex window is a passive echo of the last API response, so an hour of
  // silence is ordinary, not a fault. It only stops being usable once the
  // reading outlives the shorter of its own window and a working session —
  // the escalation-threshold discipline that keeps the attention block from
  // being permanently lit (YNAB publishes 72 hours for the same reason).
  const codexAgeMs = nowMs - CAPTURE.codex.observedAtMs;
  const codexWindowMs =
    (CAPTURE.codex.windows[0]?.windowMinutes ?? 10080) * 60_000;
  const codexStaleAfter = Math.min(codexWindowMs, 6 * 3_600_000);
  const openaiPlan: SourceRow = {
    ...ROSTER[1],
    state: codexAgeMs > codexStaleAfter ? 'stale' : 'reporting',
    windows: (clear ? allClearCodexWindows() : CAPTURE.codex.windows)
      .map(w => windowRow(ROSTER[1], w, CAPTURE.codex.observedAtMs, nowMs))
      .sort(byBite),
    asOfMs: CAPTURE.codex.observedAtMs,
    provenance: 'local log',
    note: 'Written by Codex on its own turns — it only moves when Codex runs.',
    repair: null,
    statusPage: 'status.openai.com',
    observedNt: CAPTURE.codex.observedNt,
    observedRaw: CAPTURE.codex.observedRaw,
    sessions: CAPTURE.codex.sessions,
    spend: null,
    planLabel: CAPTURE.codex.planType,
  };

  /* ---- xAI · Grok Build ---- */
  const xaiPlan: SourceRow = {
    ...ROSTER[2],
    state: stateId === 'unavailable' ? 'unavailable' : 'not-connected',
    windows: [],
    asOfMs: null,
    provenance: 'no read',
    note:
      stateId === 'unavailable'
        ? 'Connected. This tier has no published plan window — xAI meters Grok Build against credits instead.'
        : 'Grok Build is not installed on this machine.',
    repair:
      stateId === 'unavailable'
        ? null
        : { label: 'Install Grok Build', verb: 'grok login' },
    statusPage: 'status.x.ai',
    observedNt: null,
    observedRaw: null,
    sessions: null,
    spend: null,
    planLabel: null,
  };

  /* ---- Anthropic Console (API lane) ---- */
  const anthropicConsole: SourceRow = {
    ...ROSTER[3],
    state: 'unavailable',
    windows: [],
    asOfMs: null,
    provenance: 'no read',
    note: 'Console usage needs an organization admin key. Individual accounts cannot issue one.',
    repair: null,
    statusPage: 'status.anthropic.com',
    observedNt: null,
    observedRaw: null,
    sessions: null,
    spend: null,
    planLabel: null,
  };

  /* ---- OpenAI Platform (API lane) ---- */
  const openaiPlatform: SourceRow = {
    ...ROSTER[4],
    state: 'not-connected',
    windows: [],
    asOfMs: null,
    provenance: 'no read',
    note: 'Platform billing needs an organization admin key.',
    repair: { label: 'Connect', verb: 'Add an admin key' },
    statusPage: 'status.openai.com',
    observedNt: null,
    observedRaw: null,
    sessions: null,
    spend: null,
    planLabel: null,
  };

  const rows = [
    anthropicPlan,
    openaiPlan,
    xaiPlan,
    anthropicConsole,
    openaiPlatform,
  ];
  const scanning = stateId === 'first-scan';
  const scan = {
    phase: (scanning ? 'first-scan' : 'idle') as 'idle' | 'first-scan',
    filesSeen: scanning ? 2_341 : CAPTURE.corpus.filesSeen,
    filesTotal: CAPTURE.corpus.filesSeen,
    lastScanAtMs: scanning ? null : CAPTURE.corpus.lastScanAtMs,
    complete: !scanning,
  };

  return {
    state,
    nowMs,
    rows,
    attention: rows.filter(r => ATTENTION_STATES.includes(r.state)),
    headline: headlineOf(rows, scanning, nowMs),
    scan,
    corpus: CAPTURE.corpus,
  };
}

/**
 * The one authored dataset in the study, kept in one function so it can never
 * be mistaken for a measurement. Same window identities and reset instants as
 * the capture; only the consumed figures move.
 */
/**
 * The last SUCCESSFUL Claude read before the capture, taken straight from this
 * machine's own observation history — real figures at a real instant, three
 * hours old. Nothing here is invented; the read simply stopped.
 */
function lastGoodClaudeRead(): {
  atMs: number;
  windows: FixtureWindow[];
} | null {
  const target = CAPTURE.capturedAtMs - 3 * 3_600_000;
  const series = CAPTURE.claude.windows[0]?.history ?? [];
  if (series.length === 0) return null;
  let atMs = series[0][0];
  for (const [t] of series) {
    if (Math.abs(t - target) < Math.abs(atMs - target)) atMs = t;
  }
  const at = (w: FixtureWindow): number => {
    let best = w.history[0]?.[1] ?? w.usedPercent;
    let bestDelta = Infinity;
    for (const [t, v] of w.history) {
      const d = Math.abs(t - atMs);
      if (d < bestDelta) {
        bestDelta = d;
        best = v;
      }
    }
    return best;
  };
  return {
    atMs,
    windows: CAPTURE.claude.windows.map(w => ({
      ...w,
      usedPercent: at(w),
      history: w.history.filter(([t]) => t <= atMs),
    })),
  };
}

function allClearClaudeWindows(): FixtureWindow[] {
  return CAPTURE.claude.windows.map(w => {
    const used = w.label.includes('Fable')
      ? 31
      : w.label.includes('all models')
        ? 44
        : 12;
    return {
      ...w,
      usedPercent: used,
      history: w.history.map(
        ([t, v]) => [t, Math.round(v * 0.4)] as [number, number]
      ),
    };
  });
}

function allClearCodexWindows(): FixtureWindow[] {
  return CAPTURE.codex.windows.map(w => ({ ...w, usedPercent: 24 }));
}

/* ------------------------------------------------------------------ */
/* the headline                                                        */
/* ------------------------------------------------------------------ */

const VERDICT_RANK: Record<string, number> = {
  Clear: 0,
  Tight: 1,
  'Runs out before reset': 2,
  Spent: 3,
  Unknown: 2,
};

export function headlineOf(
  rows: readonly SourceRow[],
  scanning: boolean,
  nowMs: number
): Headline {
  // Every window on every row — including rows whose read failed, because a
  // failed read keeps its last good observation. This is the mechanism that
  // makes the verdict monotone: losing the read cannot delete the evidence.
  const all = rows.flatMap(r => r.windows.map(w => ({ row: r, w })));
  const live = all.filter(x => x.row.state !== 'not-connected');

  const binding =
    live
      .filter(
        x => x.w.read.exhaustsBeforeReset || x.w.read.state === 'exhausted'
      )
      .sort((a, b) => a.w.read.msToExhaust - b.w.read.msToExhaust)[0] ??
    live.sort((a, b) => b.w.read.usedPercent - a.w.read.usedPercent)[0] ??
    null;

  const expiring =
    live
      .filter(x => x.w.opportunity !== null)
      .sort(
        (a, b) =>
          (b.w.opportunity?.coursePts ?? 0) - (a.w.opportunity?.coursePts ?? 0)
      )[0] ?? null;

  const definedRows = rows.filter(r => r.definesHeadline);
  // "Reporting" means a read landed — fresh or last-good. A source whose read
  // is merely older than we would like still contributes evidence; a source
  // that never reported does not, and is counted out separately.
  const reporting = definedRows.filter(
    r => r.state === 'reporting' || r.state === 'stale'
  ).length;
  const degradedRow = definedRows.find(r => r.state === 'unreadable') ?? null;

  let word = 'Clear';
  let tone: VerdictTone = 'calm';
  let because = 'No window is projected to run out before it resets.';
  if (binding) {
    const b = binding.w.read;
    if (b.state === 'exhausted') {
      word = 'Spent';
      tone = 'hot';
      because = `${binding.row.account} · ${binding.w.label} holds until it resets in ${duration(b.msToReset)}.`;
    } else if (b.exhaustsBeforeReset) {
      word = 'Runs out before reset';
      tone = 'hot';
      because = `${binding.row.account} · ${binding.w.label} is spent in ${duration(b.msToExhaust)}, ${duration(b.msToReset)} before it resets.`;
    } else if (b.state === 'hot' || b.state === 'warm') {
      word = 'Tight';
      tone = 'calm';
      because = `${binding.row.account} · ${binding.w.label} is the closest limit at ${Math.round(b.usedPercent)}% used, resetting in ${duration(b.msToReset)}.`;
    } else {
      because = `Closest limit is ${binding.row.account} · ${binding.w.label} at ${Math.round(b.usedPercent)}% used.`;
    }
  } else {
    word = 'Unknown';
    tone = 'unknown';
    because = 'No source on this machine reports a plan window.';
  }

  const unread = definedRows.filter(r => r.state === 'unreadable').length;
  const coverage: Coverage = {
    reporting,
    defined: definedRows.length,
    roster: rows.length,
    line: [
      `${reporting} of ${definedRows.length} plan sources reporting`,
      unread > 0 ? `${unread} not readable` : null,
      `${rows.length} in the roster`,
    ]
      .filter(Boolean)
      .join(' · '),
  };

  // The bound. Stated only when the total is KNOWABLY incomplete: a partial
  // scan, or a source that should be contributing and is not. A source that is
  // simply not connected contributes nothing by definition, so it lowers
  // coverage without making the token total one-sided.
  const observed = rows.reduce((n, r) => n + (r.observedNt ?? 0), 0);
  const isBound =
    scanning ||
    rows.some(
      r =>
        r.state === 'unreadable' || r.state === 'stale' || r.state === 'reading'
    );

  return {
    verdict: {
      word,
      tone,
      because,
      degraded: degradedRow !== null,
      degradedNote: degradedRow
        ? `${degradedRow.account} stopped reporting ${duration(nowMs - (degradedRow.asOfMs ?? nowMs))} ago — this reads its last good figures.`
        : null,
      rank: VERDICT_RANK[word] ?? 0,
    },
    bound: {
      label: `${isBound ? 'At least ' : ''}${tokens(observed)} normalized tokens`,
      value: observed,
      isBound,
      basis: `${CAPTURE.corpus.windowDays} days · local logs, normalized`,
    },
    coverage,
    binding: binding?.w ?? null,
    bindingSource: binding?.row ?? null,
    expiring: expiring?.w ?? null,
    expiringSource: expiring?.row ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* the glance — a projection, not a summary                            */
/* ------------------------------------------------------------------ */

export interface AmbientCell {
  id: string;
  short: string;
  state: RowState;
  /** null whenever the source has no readable window. Never 0. */
  usedPercent: number | null;
  hot: boolean;
}

export interface AmbientView {
  word: string;
  tone: VerdictTone;
  /** Same rows, same order, fewer columns. */
  cells: AmbientCell[];
  coverage: string;
}

const SHORT: Record<string, string> = {
  'anthropic-plan': 'CL',
  'openai-plan': 'CX',
  'xai-plan': 'GK',
  'anthropic-console': 'AC',
  'openai-platform': 'OP',
};

/**
 * The ambient meter's whole input. Derived by DROPPING COLUMNS from the same
 * rows in the same order — never by a second computation, which is where
 * every glance/detail divergence in the E12 corpus happened.
 */
export function ambientProjection(view: RosterView): AmbientView {
  return {
    word: view.headline.verdict.word,
    tone: view.headline.verdict.tone,
    coverage: `${view.headline.coverage.reporting}/${view.headline.coverage.defined}`,
    cells: view.rows.map(r => {
      const binding = r.windows.slice().sort(byBite)[0] ?? null;
      return {
        id: r.id,
        short: SHORT[r.id] ?? r.id.slice(0, 2).toUpperCase(),
        state: r.state,
        usedPercent: binding ? binding.read.usedPercent : null,
        hot: binding
          ? binding.read.exhaustsBeforeReset ||
            binding.read.state === 'exhausted'
          : false,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* read timeline — how often each source was actually readable         */
/* ------------------------------------------------------------------ */

export interface TimelineSegment {
  startMs: number;
  endMs: number;
  state: 'reporting' | 'gap' | 'never';
}

export interface TimelineRow {
  id: string;
  label: string;
  segments: TimelineSegment[];
  /** Share of the span with a live observation. */
  coverage: number;
}

/**
 * The read-health history, straight from the observation series each source
 * actually produced. A source whose figure is a passive echo of its own CLI
 * (Codex) has real multi-hour gaps in here; a credentialed pull (Claude) does
 * not. Nothing in the corpus renders this, and it is the only way to see that
 * a number stopped moving because nobody asked, not because nothing happened.
 */
export function readTimeline(view: RosterView, spanMs: number): TimelineRow[] {
  const end = view.nowMs;
  const start = end - spanMs;
  // A gap longer than this reads as "no observation", not as sampling noise.
  const GAP_MS = 40 * 60_000;
  return view.rows.map(row => {
    const points = row.windows
      .flatMap(w => w.history.map(([t]) => t))
      .filter(t => t >= start && t <= end)
      .sort((a, b) => a - b);
    if (points.length === 0) {
      return {
        id: row.id,
        label: row.account,
        segments: [{ startMs: start, endMs: end, state: 'never' as const }],
        coverage: 0,
      };
    }
    // An observation covers forward until the next one, capped at the gap
    // threshold: a source that answered at 13:00 was readable at 13:05, but a
    // reading that then goes eighteen hours without a successor covered
    // nothing after the first forty minutes. Merging the covered intervals is
    // what makes the strip legible instead of a comb of hairlines.
    const covers: [number, number][] = [];
    for (let i = 0; i < points.length; i += 1) {
      const from = points[i];
      const next = points[i + 1] ?? Infinity;
      covers.push([from, Math.min(end, Math.min(next, from + GAP_MS))]);
    }
    const merged: [number, number][] = [];
    for (const [from, to] of covers) {
      const last = merged[merged.length - 1];
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    }
    const segments: TimelineSegment[] = [];
    let covered = 0;
    let cursor = start;
    for (const [from, to] of merged) {
      if (from > cursor)
        segments.push({ startMs: cursor, endMs: from, state: 'gap' });
      segments.push({ startMs: from, endMs: to, state: 'reporting' });
      covered += to - from;
      cursor = to;
    }
    if (cursor < end)
      segments.push({ startMs: cursor, endMs: end, state: 'gap' });
    return {
      id: row.id,
      label: row.account,
      segments,
      coverage: covered / spanMs,
    };
  });
}

/* ------------------------------------------------------------------ */
/* the ledger — row-zero totals and named residuals                    */
/* ------------------------------------------------------------------ */

const A = CAPTURE.attribution;

/**
 * One pivot over the same corpus, with the residual drawn as a named row.
 *
 * `total` is computed independently of `rows` (LiteLLM's schema rule), so a
 * breakdown that lost a source visibly disagrees with the total instead of
 * silently shrinking it.
 */
export function buildLedger(pivot: PivotId, view: RosterView): Ledger {
  const scanning = view.scan.phase === 'first-scan';
  const factor = scanning ? 0.61 : 1;
  const total = (A.operatorNt + A.overheadNt) * factor;

  const base: LedgerRow[] = (() => {
    switch (pivot) {
      case 'project':
        return A.projects.map(p => ({
          key: p.label,
          label: p.label,
          nt: p.nt * factor,
          raw: p.raw * factor,
          color: p.color,
          meta: null,
          residual: p.label === 'No Project',
          provenance: 'local log' as Provenance,
          asOfMs: view.scan.lastScanAtMs,
        }));
      case 'model':
        return A.models.map(m => ({
          key: m.label,
          label: m.label,
          nt: m.nt * factor,
          raw: m.raw * factor,
          color: null,
          meta: m.source === 'codex' ? 'Codex Pro' : 'Claude Max',
          residual: false,
          provenance: 'local log' as Provenance,
          asOfMs: view.scan.lastScanAtMs,
        }));
      case 'source':
        return view.rows.map(r => ({
          key: r.id,
          label: `${r.vendor} · ${r.account}`,
          nt: r.observedNt === null ? null : r.observedNt * factor,
          raw: r.observedRaw === null ? null : r.observedRaw * factor,
          color: null,
          meta:
            r.observedNt === null
              ? STATE_WORD[r.state]
              : `${r.sessions} sessions`,
          residual: false,
          provenance: r.provenance,
          asOfMs: r.asOfMs,
        }));
      case 'session':
        return A.sessions.map(s => ({
          key: s.id,
          label: s.title ?? `Session ${s.id}`,
          nt: s.nt * factor,
          raw: s.raw * factor,
          color: A.projects.find(p => p.label === s.project)?.color ?? null,
          meta: `${s.project} · ${s.model ?? 'model not recorded'}${s.title ? '' : ' · no session record'}`,
          residual: false,
          provenance: 'local log' as Provenance,
          asOfMs: s.lastAtMs,
        }));
    }
  })();

  const rows: LedgerRow[] = [...base];

  // Residual 0 — the tail a capped list drops. A "top N" that quietly loses
  // the remainder is the same failure as a dropped source, one altitude down.
  if (pivot === 'session') {
    const shown = base.reduce((n, r) => n + (r.nt ?? 0), 0);
    const tail = total - shown - A.overheadNt * factor;
    if (tail > 0) {
      rows.push({
        key: 'residual-tail',
        label: `Sessions below the top ${base.length}`,
        nt: tail,
        raw: null,
        color: null,
        meta: 'drawn so the rows still reconcile to the total',
        residual: true,
        provenance: 'local log',
        asOfMs: view.scan.lastScanAtMs,
      });
    }
  }

  // Residual 1 — Exawatt's own machine-invoked calls, named rather than mixed
  // into the Projects they book against.
  if (pivot === 'project' || pivot === 'source' || pivot === 'session') {
    rows.push({
      key: 'residual-overhead',
      label: 'Exawatt overhead',
      nt: A.overheadNt * factor,
      raw: A.overheadRaw * factor,
      color: null,
      meta: 'machine-invoked summaries, not operator work',
      residual: true,
      provenance: 'local log',
      asOfMs: view.scan.lastScanAtMs,
    });
  }

  // Residual 2 — the gap the shipped page has nowhere to put: plan windows
  // meter everything on the account, local logs see only harness sessions.
  rows.push({
    key: 'residual-offtool',
    label: 'Plan burn with no local session',
    nt: null,
    raw: null,
    color: null,
    meta: 'claude.ai chat and anything else on the plan — metered by Anthropic, invisible here',
    residual: true,
    provenance: 'no read',
    asOfMs: null,
  });

  // Residual 3 — sources that could not be attributed at all this pass.
  const dark = view.rows.filter(
    r => r.definesHeadline && r.observedNt === null
  );
  if (dark.length > 0) {
    rows.push({
      key: 'residual-dark',
      label: `${dark.length} source${dark.length > 1 ? 's' : ''} contributing nothing measurable`,
      nt: null,
      raw: null,
      color: null,
      meta: dark
        .map(d => `${d.account} — ${STATE_WORD[d.state].toLowerCase()}`)
        .join(' · '),
      residual: true,
      provenance: 'no read',
      asOfMs: null,
    });
  }

  const attributed = rows.reduce((n, r) => n + (r.nt ?? 0), 0);

  return {
    pivot,
    total: {
      nt: total,
      label: scanning ? `At least ${tokens(total)} nt` : `${tokens(total)} nt`,
      isBound: scanning,
    },
    rows: rows.sort((a, b) => (b.nt ?? -1) - (a.nt ?? -1)),
    attributed,
  };
}
