/**
 * Session liveness (ENG-002, ENG-016): which side stopped when a working
 * Session's terminal stops moving.
 *
 * A Claude Code Agent redraws its working line ("Clauding… 3m 20s") every
 * second while it works. When that counter freezes on screen (BUG-330), one of
 * two things stopped: the harness process stopped writing, or the pane stopped
 * painting what main delivered. A wedged Session (BUG-102) poses the same
 * question after the fact. Before this nothing recorded either, so the two
 * were indistinguishable once the moment passed.
 *
 * Main already sees every byte the process writes (`output`; Exawatt's own
 * bytes, such as the exit marker, are not the process writing and do not
 * count). The renderer
 * reports, per window, which panes it is showing and the highest output
 * cursor each has painted (`report`, `PtyPaintReport`). From those two facts:
 *
 * - **harness**: a reported turn is open, no operator gate is open, and the
 *   process has written nothing past the attention monitor's stale bound.
 *   That monitor already measures exactly this silence to reclaim turns a
 *   harness left open (`reported-turn-stale`), so the harness side reuses its
 *   one measurement instead of keeping a second clock, on the awake clock
 *   (`awake-clock.ts`), so a Mac's sleep is never a harness's silence. The
 *   record says whether the operator typed just before or during the
 *   silence (a keystroke nothing echoed), with input taken from the one
 *   engagement owner, so a paste or a bus door's Enter counts as a keystroke
 *   does. A turn the operator stopped with Escape closes at ordinary quiet
 *   and is not a stall (BUG-342).
 * - **pane**: main has kept delivering output to a pane a visible page lists
 *   as shown, and for `paintStallMs` none of it has been painted. A renderer
 *   too busy or too frozen to report at all reads the same way, which is
 *   right: its panes stopped painting.
 *
 * Each episode writes one `liveness.stall` naming the side, and one
 * `liveness.stall-cleared` when it ends (output or paint resumed, the pane or
 * page was hidden, the renderer went away, the Session exited) with how long
 * it lasted, in awake time. Lines land in `logs/harness-events.jsonl` beside the Session's
 * start and exit, keyed by durable Session id. Content-free: ids, counts and
 * durations, never terminal text.
 *
 * Cost (ENG-008 E14): no timers at all. The pane check runs on output arrival,
 * which is O(windows showing that pane) field writes per chunk; reports come
 * at most every couple of seconds per window and only while panes paint. A
 * hidden page is owed nothing and reports nothing.
 *
 * Absence is not an answer. A pane is watched only between a window's first
 * report and its last (`liveness.paint-reporting` marks both), so a log with
 * no pane stall says something only inside those brackets. A report main
 * cannot read is refused at the IPC boundary, never read as "caught up". The
 * harness side exists only for harnesses that report turns; a harness that
 * reports none never writes one, and that is "unknown", not "fine". Any throw
 * in here records `liveness.failed` once and switches the watch off: an
 * instrument that breaks the output path is worse than none.
 */
import type { PtyPaintReport } from '@exawatt/core/desktop-bridge';
import type { DiagnosticFields, DiagnosticRecorder } from '../diagnostics-log';
import type { StaleReportEvidence } from './attention-monitor';
import type { PtyDataOrigin } from './session-manager';

/** Unpainted delivery for this long, while delivery continues, is a stall. */
export const PAINT_STALL_MS = 15_000;
/** A gap this long between deliveries restarts the unpainted clock: main was
 *  blocked or the machine slept, and the time in between proves nothing. */
export const DELIVERY_GAP_MS = 5_000;
/** Operator input this close before the last output "preceded the silence". */
const INPUT_BEFORE_SILENCE_MS = 2_000;

type StallSide = 'harness' | 'pane';

type StallClearedCause =
  | 'output'
  | 'painted'
  | 'pane-hidden'
  | 'page-hidden'
  | 'renderer-gone'
  | 'exited';

interface LivenessSessionIdentity {
  durableSessionId: string;
  harness: string;
  harnessSessionId: string | null;
}

export interface SessionLivenessOptions {
  record: DiagnosticRecorder;
  /** The live Session behind a PTY id, read only when a line is written. */
  session(id: string): LivenessSessionIdentity | undefined;
  /** Main's own view of a reporting window, for the record only. */
  windowFacts?(windowId: number): { shown: boolean; focused: boolean } | null;
  now?: () => number;
  paintStallMs?: number;
  deliveryGapMs?: number;
}

interface SessionLiveness {
  /** Main delivered output up to `cursor` (the `pty:data` cursor). */
  output(id: string, cursor: number): void;
  /** The operator wrote to the Session (a keystroke, not a protocol reply). */
  input(id: string): void;
  /** The attention monitor found a reported turn silent past its bound. */
  turnStale(
    id: string,
    evidence: Pick<StaleReportEvidence, 'quietMs' | 'children' | 'cause'>
  ): void;
  /** The Session's process ended or its record was dropped. */
  ended(id: string): void;
  /** One window's report of its shown panes. */
  report(windowId: number, report: PtyPaintReport): void;
  /** A reporting window's page went away (closed, crashed, navigated). */
  windowGone(
    windowId: number,
    reason: 'closed' | 'renderer-gone' | 'reloaded'
  ): void;
}

interface Output {
  cursor: number;
  at: number;
  /** last operator keystroke, if any */
  inputAt: number | null;
}

interface HarnessStall {
  lastOutputAt: number;
}

interface PaneWatch {
  painted: number;
  lastDeliveryAt: number;
  /** when the oldest still-unpainted run of delivery began */
  unpaintedSince: number | null;
  /** the open episode: since when, for the cleared line */
  stalledSince: number | null;
}

interface ReportingWindow {
  shown: Set<string>;
}

export function createSessionLiveness(
  options: SessionLivenessOptions
): SessionLiveness {
  const now = options.now ?? Date.now;
  const paintStallMs = options.paintStallMs ?? PAINT_STALL_MS;
  const deliveryGapMs = options.deliveryGapMs ?? DELIVERY_GAP_MS;
  const outputs = new Map<string, Output>();
  const harnessStalls = new Map<string, HarnessStall>();
  const windows = new Map<number, ReportingWindow>();
  /** PTY id → reporting window id → watch */
  const panes = new Map<string, Map<number, PaneWatch>>();
  let failed = false;

  const identity = (id: string): DiagnosticFields => {
    const session = options.session(id);
    return session
      ? {
          durableSessionId: session.durableSessionId,
          ptyId: id,
          harness: session.harness,
          harnessSessionId: session.harnessSessionId,
        }
      : { ptyId: id };
  };

  const cleared = (
    id: string,
    side: StallSide,
    cause: StallClearedCause,
    stalledMs: number,
    extra: DiagnosticFields = {}
  ) => {
    options.record('liveness.stall-cleared', {
      ...identity(id),
      side,
      cause,
      stalledMs,
      ...extra,
    });
  };

  const closePane = (
    id: string,
    windowId: number,
    watch: PaneWatch,
    cause: StallClearedCause,
    at: number
  ) => {
    if (watch.stalledSince === null) return;
    cleared(id, 'pane', cause, at - watch.stalledSince, { windowId });
    watch.stalledSince = null;
  };

  const dropWatch = (
    id: string,
    windowId: number,
    cause: StallClearedCause,
    at: number
  ) => {
    const watches = panes.get(id);
    const watch = watches?.get(windowId);
    if (!watches || !watch) return;
    closePane(id, windowId, watch, cause, at);
    watches.delete(windowId);
    if (watches.size === 0) panes.delete(id);
  };

  const openPane = (
    id: string,
    windowId: number,
    watch: PaneWatch,
    cursor: number,
    at: number
  ) => {
    watch.stalledSince = watch.unpaintedSince ?? at;
    const facts = options.windowFacts?.(windowId) ?? null;
    options.record('liveness.stall', {
      ...identity(id),
      side: 'pane',
      unpaintedMs: at - watch.stalledSince,
      unpaintedChars: cursor - watch.painted,
      windowId,
      windowShown: facts?.shown ?? null,
      windowFocused: facts?.focused ?? null,
    });
  };

  // Every entry point is guarded the same way: a throw records once and
  // switches the watch off rather than reaching the output path.
  const guard =
    <A extends unknown[]>(where: string, run: (...args: A) => void) =>
    (...args: A): void => {
      if (failed) return;
      try {
        run(...args);
      } catch (error) {
        failed = true;
        try {
          options.record('liveness.failed', {
            where,
            error: error instanceof Error ? error.name : 'unknown',
          });
        } catch {
          // the recorder itself failed; nothing left to tell
        }
      }
    };

  return {
    output: guard('output', (id: string, cursor: number) => {
      const at = now();
      const output = outputs.get(id);
      if (output) {
        output.cursor = cursor;
        output.at = at;
      } else {
        outputs.set(id, { cursor, at, inputAt: null });
      }
      const stall = harnessStalls.get(id);
      if (stall) {
        harnessStalls.delete(id);
        cleared(id, 'harness', 'output', at - stall.lastOutputAt);
      }
      const watches = panes.get(id);
      if (!watches) return;
      for (const [windowId, watch] of watches) {
        if (at - watch.lastDeliveryAt > deliveryGapMs) {
          // Nothing arrived for a while (main blocked, the machine slept, or
          // the harness paused): what was unpainted before the gap is judged
          // from now, not from before the gap.
          if (watch.unpaintedSince !== null) watch.unpaintedSince = at;
        }
        watch.lastDeliveryAt = at;
        if (cursor <= watch.painted) continue;
        if (watch.unpaintedSince === null) {
          watch.unpaintedSince = at;
          continue;
        }
        if (
          watch.stalledSince === null &&
          at - watch.unpaintedSince >= paintStallMs
        ) {
          openPane(id, windowId, watch, cursor, at);
        }
      }
    }),

    input: guard('input', (id: string) => {
      const at = now();
      const output = outputs.get(id);
      if (output) output.inputAt = at;
      else outputs.set(id, { cursor: 0, at: Number.NaN, inputAt: at });
    }),

    turnStale: guard(
      'turn-stale',
      (
        id: string,
        evidence: Pick<StaleReportEvidence, 'quietMs' | 'children' | 'cause'>
      ) => {
        // The operator's Escape stopped the turn; its quiet is his doing.
        if (evidence.cause === 'interrupt') return;
        if (harnessStalls.has(id)) return;
        const at = now();
        const output = outputs.get(id);
        const lastOutputAt =
          output && Number.isFinite(output.at)
            ? output.at
            : at - evidence.quietMs;
        const inputAt = output?.inputAt ?? null;
        harnessStalls.set(id, { lastOutputAt });
        options.record('liveness.stall', {
          ...identity(id),
          side: 'harness',
          silentMs: evidence.quietMs,
          childCount: evidence.children,
          inputBeforeSilence:
            inputAt !== null &&
            inputAt <= lastOutputAt &&
            lastOutputAt - inputAt <= INPUT_BEFORE_SILENCE_MS,
          inputDuringSilence: inputAt !== null && inputAt > lastOutputAt,
        });
      }
    ),

    ended: guard('ended', (id: string) => {
      const at = now();
      const stall = harnessStalls.get(id);
      if (stall) {
        harnessStalls.delete(id);
        cleared(id, 'harness', 'exited', at - stall.lastOutputAt);
      }
      for (const windowId of [...(panes.get(id)?.keys() ?? [])]) {
        dropWatch(id, windowId, 'exited', at);
      }
      outputs.delete(id);
    }),

    report: guard('report', (windowId: number, report: PtyPaintReport) => {
      const at = now();
      let window = windows.get(windowId);
      if (!window) {
        window = { shown: new Set() };
        windows.set(windowId, window);
        options.record('liveness.paint-reporting', {
          windowId,
          state: 'started',
        });
      }
      const listed = new Map<string, number>();
      if (report.visible) {
        for (const pane of report.panes) {
          // two panes of one Session: the one further behind is the answer
          const known = listed.get(pane.id);
          listed.set(
            pane.id,
            known === undefined ? pane.painted : Math.min(known, pane.painted)
          );
        }
      }
      for (const id of window.shown) {
        if (listed.has(id)) continue;
        dropWatch(
          id,
          windowId,
          report.visible ? 'pane-hidden' : 'page-hidden',
          at
        );
        window.shown.delete(id);
      }
      for (const [id, painted] of listed) {
        const output = outputs.get(id);
        // a pane whose Session has written nothing in this run is owed nothing
        if (!output) continue;
        window.shown.add(id);
        let watches = panes.get(id);
        if (!watches) panes.set(id, (watches = new Map()));
        const watch = watches.get(windowId);
        if (!watch) {
          watches.set(windowId, {
            painted,
            lastDeliveryAt: at,
            unpaintedSince: painted >= output.cursor ? null : at,
            stalledSince: null,
          });
          continue;
        }
        if (painted >= output.cursor) {
          watch.unpaintedSince = null;
          closePane(id, windowId, watch, 'painted', at);
        } else if (painted > watch.painted) {
          // painting, if behind: the clock restarts from this progress
          watch.unpaintedSince = at;
          closePane(id, windowId, watch, 'painted', at);
        }
        watch.painted = Math.max(watch.painted, painted);
      }
    }),

    windowGone: guard(
      'window-gone',
      (windowId: number, reason: 'closed' | 'renderer-gone' | 'reloaded') => {
        const window = windows.get(windowId);
        if (!window) return;
        const at = now();
        for (const id of window.shown) {
          dropWatch(
            id,
            windowId,
            reason === 'closed' ? 'page-hidden' : 'renderer-gone',
            at
          );
        }
        windows.delete(windowId);
        options.record('liveness.paint-reporting', {
          windowId,
          state: 'stopped',
          reason,
        });
      }
    ),
  };
}

/** The Session owner as liveness reads it: `PtySessionManager`'s events. */
interface LivenessSessions {
  on(
    event: 'data',
    listener: (
      id: string,
      data: string,
      cursor: number,
      durableSessionId: string,
      origin: PtyDataOrigin
    ) => void
  ): unknown;
  on(event: 'exit', listener: (id: string) => void): unknown;
  list(): Array<LivenessSessionIdentity & { id: string }>;
}

/** The attention monitor: its stale-turn measurement, and the one place
 *  input reaches a Session as work (a keystroke, a paste, a door's Enter). */
interface LivenessAttention {
  on(
    event: 'reported-turn-stale',
    listener: (id: string, evidence: StaleReportEvidence) => void
  ): unknown;
  on(event: 'input', listener: (id: string) => void): unknown;
}

/** The parts of a reporting renderer's `webContents` liveness listens to. */
interface LivenessSender {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
  on(event: 'render-process-gone', listener: () => void): unknown;
  on(event: 'did-navigate', listener: (...args: unknown[]) => void): unknown;
}

/** `EXAWATT_LIVENESS_PAINT_STALL_MS` shortens the pane bound for evals. */
export function livenessTuning(
  env: NodeJS.ProcessEnv
): Pick<SessionLivenessOptions, 'paintStallMs'> {
  const raw = env.EXAWATT_LIVENESS_PAINT_STALL_MS;
  if (raw === undefined || raw === '') return {};
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? { paintStallMs: value } : {};
}

/**
 * Wire liveness to the Session owner and the attention monitor, and return
 * the door IPC adds: a window's paint report.
 */
export function attachSessionLiveness({
  record,
  sessions,
  attention,
  windowFacts,
  now,
  ...tuning
}: {
  record: DiagnosticRecorder;
  sessions: LivenessSessions;
  attention: LivenessAttention;
} & Omit<SessionLivenessOptions, 'record' | 'session'>): {
  report(sender: LivenessSender, report: PtyPaintReport): void;
} {
  const liveness = createSessionLiveness({
    record,
    session: id => sessions.list().find(session => session.id === id),
    windowFacts,
    now,
    ...tuning,
  });
  // Only the process writing counts as output: the exit marker arrives as
  // data just before `exit`, and read as output it closed a harness stall
  // as "output" when the process had in fact ended.
  sessions.on('data', (id, _data, cursor, _durable, origin) => {
    if (origin !== 'exawatt') liveness.output(id, cursor);
  });
  sessions.on('exit', id => liveness.ended(id));
  attention.on('reported-turn-stale', (id, evidence) =>
    liveness.turnStale(id, evidence)
  );
  attention.on('input', id => liveness.input(id));
  const watched = new Set<number>();
  return {
    report(sender, report) {
      if (!watched.has(sender.id)) {
        watched.add(sender.id);
        const id = sender.id;
        sender.once('destroyed', () => {
          watched.delete(id);
          liveness.windowGone(id, 'closed');
        });
        sender.on('render-process-gone', () =>
          liveness.windowGone(id, 'renderer-gone')
        );
        sender.on('did-navigate', () => liveness.windowGone(id, 'reloaded'));
      }
      liveness.report(sender.id, report);
    },
  };
}
