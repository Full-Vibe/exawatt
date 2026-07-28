import { EventEmitter } from 'events';
import type { PtySessionManager } from './session-manager';

/**
 * Attention monitor (ENG-015 S1): detects "this session needs the operator"
 * from the raw PTY stream, so no stalled or asking agent goes unnoticed.
 *
 * Two signal classes:
 *   bell      — explicit: a REAL BEL (0x07) or a terminal notification
 *               sequence (OSC 9, OSC 777). BELs that merely terminate OSC
 *               sequences (window-title updates end in BEL) do NOT count.
 *   turn-end  — inferred, harness sessions only: a work burst (≥ minBurst
 *               raw bytes) followed by output quiescence (≥ quietMs) is a
 *               turn boundary — the agent stopped and is likely waiting.
 *               Shells are exempt (quiet is their normal state).
 *
 * "Looked at" means the session's tab is active AND the app window has OS
 * focus — an active tab behind another app still flags (that's the single-
 * tab case this system exists for). Attention clears when the operator
 * looks (focus) or answers (input while looking). Once a turn crosses a
 * finished boundary, passive provider output cannot silently reopen it; a
 * guaranteed-human engagement begins the next turn. A spawn grace period
 * keeps auto-revived tabs from all lighting up at app start.
 *
 * Pure Node (no Electron imports) so it unit-tests directly. Env knobs:
 *   EXAWATT_ATTENTION=0               disable entirely
 *   EXAWATT_ATTENTION_QUIET_MS=<ms>   quiescence window (default 4000)
 *   EXAWATT_ATTENTION_MIN_BURST=<n>   raw bytes that count as work (default
 *                                     600; 0 = every quiet turn flags)
 */

export type AttentionKind = 'bell' | 'turn-end';

export interface SessionAttention {
  kind: AttentionKind;
  /** when the attention was raised — the queue orders oldest-first */
  since: number;
}

export interface AttentionMonitorOptions {
  sweepMs?: number;
  quietMs?: number;
  minBurstBytes?: number;
  spawnGraceMs?: number;
  /** injectable clock for tests */
  now?: () => number;
}

/** honors an explicit 0 (Number(x) || fallback would silently discard it) */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const DEFAULTS = {
  sweepMs: 1000,
  quietMs: envInt('EXAWATT_ATTENTION_QUIET_MS', 4000),
  minBurstBytes: envInt('EXAWATT_ATTENTION_MIN_BURST', 600),
  spawnGraceMs: 20_000,
};

/** Output arriving this soon after WE resized the PTY is the TUI's WINCH
 *  redraw, not the agent working (D24: clicking an idle tab attaches the
 *  pane, resizes, and must not spin the glyph). Covers the pane's 1.5s
 *  wiggle resync, which renews the window itself. */
const RESIZE_GRACE_MS = 2000;

/** Output within this window means the session is visibly WORKING (D18:
 *  running vs waiting must read at a glance). Below quietMs so a session
 *  goes visually quiet before a turn-end flag can raise. */
const WORKING_WINDOW_MS = 3000;

/** carry cap for an OSC sequence split across chunks */
const OSC_CARRY_LIMIT = 4096;

export class AttentionMonitor extends EventEmitter {
  private manager: PtySessionManager | null = null;
  private attention = new Map<string, SessionAttention>();
  private lastDataAt = new Map<string, number>();
  private lastResizeAt = new Map<string, number>();
  private burstBytes = new Map<string, number>();
  /** sessions currently emitting output — the renderer's "working" glyphs */
  private working = new Set<string>();
  /** Agent turns that have crossed a visible quiet/BEL boundary. This latch
   *  prevents an idle TUI repaint from reopening a finished turn; only the
   *  guaranteed-human engagement channel can begin the next one. Shells do
   *  not have turns and therefore never enter this set. */
  private settled = new Set<string>();
  /** sessions ever given work (D22: composer task, exact resume, or a human
   *  keystroke via pty:engage) or that ever raised attention (a turn-end
   *  implies a turn happened) — the strip's started/unstarted truth */
  private engaged = new Set<string>();
  /** unterminated escape-sequence tail carried to the next chunk */
  private carry = new Map<string, string>();
  private focusedId: string | null = null;
  /** OS focus of the app window: an active tab behind another app is NOT
   *  being looked at — start false; the startup focus event corrects it */
  private windowFocused = false;
  /** Does this Session have outstanding delegated work? (ENG-023) Injected so
   *  the monitor stays pure Node and testable without the event channel. */
  private delegatedBusy: (id: string) => boolean = () => false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<Omit<AttentionMonitorOptions, 'now'>>;
  private readonly now: () => number;
  private readonly disabled = process.env.EXAWATT_ATTENTION === '0';

  constructor(options: AttentionMonitorOptions = {}) {
    super();
    this.opts = {
      sweepMs: options.sweepMs ?? DEFAULTS.sweepMs,
      quietMs: options.quietMs ?? DEFAULTS.quietMs,
      minBurstBytes: options.minBurstBytes ?? DEFAULTS.minBurstBytes,
      spawnGraceMs: options.spawnGraceMs ?? DEFAULTS.spawnGraceMs,
    };
    this.now = options.now ?? (() => Date.now());
  }

  attach(manager: PtySessionManager): void {
    this.manager = manager;
    manager.on('data', (id: string, data: string) => this.onData(id, data));
    manager.on('exit', (id: string) => this.drop(id));
  }

  start(): void {
    if (this.disabled || this.timer) return;
    this.timer = setInterval(() => this.sweepNow(), this.opts.sweepMs);
    // never keep the app alive just to watch for attention
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(id: string): SessionAttention | null {
    return this.attention.get(id) ?? null;
  }

  count(): number {
    return this.attention.size;
  }

  /** is this session actively producing output right now? */
  isWorking(id: string): boolean {
    return this.working.has(id);
  }

  /** Install the redraw guard BEFORE resize() can synchronously emit PTY
   *  output. Keeping the side effect inside this boundary makes that order
   *  impossible for callers to accidentally reverse (D24/D33). */
  runWithResizeGuard<T>(id: string, resize: () => T): T {
    this.lastResizeAt.set(id, this.now());
    return resize();
  }

  /** The operator gave this session work (task, resume, or keystroke).
   *  Deliberately NOT gated on `disabled`: startedness is explicit fact,
   *  not stream inference. Emits 'engaged' once per session. */
  noteEngaged(id: string): void {
    // A finished Agent turn is sticky across passive PTY output. Explicit
    // operator engagement is the sole boundary that opens the next turn.
    // Mark it working from that semantic fact instead of waiting for echo:
    // a guarded resize can overlap the first prompt bytes, and some TUIs do
    // not echo input at all.
    this.settled.delete(id);
    this.burstBytes.set(id, 0);
    this.markEngaged(id);
    const session = this.manager?.list().find(item => item.id === id);
    if (
      !this.disabled &&
      session &&
      !session.exited &&
      session.harness !== 'shell'
    ) {
      this.lastDataAt.set(id, this.now());
      this.setWorking(id, true);
    }
  }

  /** Teach the monitor which Sessions still have delegated children running
   *  (ENG-023). Byte quiescence cannot see them. */
  setDelegationSource(delegatedBusy: (id: string) => boolean): void {
    this.delegatedBusy = delegatedBusy;
  }

  /**
   * The harness REPORTED that a new turn began (ENG-023).
   *
   * The `settled` latch exists because inferred signals are unreliable — an
   * idle TUI repaint must not reopen a finished turn. A turn boundary the
   * source itself declares is exactly the reliable evidence that latch was
   * waiting for, so it opens the next turn just as operator engagement does.
   * This is what keeps a parent from reading "quiet" while it works through a
   * child's returned result, which is a turn no keystroke ever opened.
   */
  noteHarnessTurnStart(id: string): void {
    if (this.disabled) return;
    const session = this.manager?.list().find(item => item.id === id);
    if (!session || session.exited || session.harness === 'shell') return;
    this.settled.delete(id);
    this.markEngaged(id);
    this.lastDataAt.set(id, this.now());
    this.setWorking(id, true);
  }

  private markEngaged(id: string): void {
    if (this.engaged.has(id)) return;
    this.engaged.add(id);
    this.emit('engaged', id);
  }

  /** has this session ever been given work? (D22 started/unstarted truth) */
  isEngaged(id: string): boolean {
    return this.engaged.has(id);
  }

  /** which session's tab is active (null = none) */
  setFocus(id: string | null): void {
    this.focusedId = id;
    if (id && this.windowFocused) this.clear(id);
  }

  /** OS focus of the app window — regaining it means the operator is now
   *  looking at whatever tab is active */
  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
    if (focused && this.focusedId) this.clear(this.focusedId);
  }

  /** truly looked at = active tab in a focused window */
  private isWatched(id: string): boolean {
    return this.windowFocused && id === this.focusedId;
  }

  /**
   * Input reached this session. Only counts as operator engagement when the
   * session is actually being watched — pty:write also carries xterm.js
   * AUTO-replies (cursor-position/device queries answered by hidden panes,
   * backlog replay on reload), which must never clear a flag nobody saw.
   */
  noteInput(id: string): void {
    if (this.isWatched(id)) this.clear(id);
  }

  private onData(id: string, data: string): void {
    if (this.disabled) return;
    const { bell } = this.scan(id, data);
    // Once the UI has truthfully shown "turn finished," provider-owned idle
    // redraws, title updates, and terminal protocol chatter cannot turn it
    // back into "working." They are observable bytes, not a new operator
    // command. A real next turn arrives through noteEngaged().
    if (!bell && this.settled.has(id)) return;
    this.lastDataAt.set(id, this.now());
    const sinceResize = this.now() - (this.lastResizeAt.get(id) ?? -Infinity);
    if (bell) {
      // BEL is an explicit turn boundary: the agent is now waiting, not
      // working. Consume the burst too, otherwise acknowledging the bell
      // can reveal stale working state or re-flag the same turn as quiet.
      this.settleAgent(id);
      this.setWorking(id, false);
      this.burstBytes.set(id, 0);
    } else {
      if (sinceResize >= RESIZE_GRACE_MS) this.setWorking(id, true);
      this.burstBytes.set(id, (this.burstBytes.get(id) ?? 0) + data.length);
    }
    if (bell && !this.isWatched(id)) this.raise(id, 'bell');
  }

  /** turn-boundary detection; public so tests can drive time explicitly */
  sweepNow(): void {
    if (this.disabled || !this.manager) return;
    const now = this.now();
    const live = new Set<string>();
    for (const s of this.manager.list()) {
      live.add(s.id);
      // working → quiet transition (activity truth for status glyphs)
      if (this.working.has(s.id)) {
        const last = this.lastDataAt.get(s.id);
        if (s.exited || last === undefined || now - last >= WORKING_WINDOW_MS) {
          if (!s.exited && s.harness !== 'shell') this.settled.add(s.id);
          this.setWorking(s.id, false);
        }
      }
      if (s.exited || s.harness === 'shell') continue;
      const last = this.lastDataAt.get(s.id);
      if (last === undefined || now - last < this.opts.quietMs) continue;
      // quiescence reached: the burst is consumed whether or not it flags
      const burst = this.burstBytes.get(s.id) ?? 0;
      this.burstBytes.set(s.id, 0);
      if (burst < this.opts.minBurstBytes) continue;
      // revived/new tabs printing their banner then waiting is not news
      if (now - s.startedAt < this.opts.spawnGraceMs) continue;
      if (this.isWatched(s.id)) continue;
      // The Session's own turn ended, but its team has not: a parent waiting
      // on delegated children has produced no result for the operator to
      // read. Quiescence cannot tell those apart — the harness can (ENG-023).
      if (this.delegatedBusy(s.id)) continue;
      this.raise(s.id, 'turn-end');
    }
    // sessions killed without an exit event (tab closed) leave no residue
    for (const id of Array.from(this.lastDataAt.keys())) {
      if (!live.has(id)) this.drop(id);
    }
  }

  private raise(id: string, kind: AttentionKind): void {
    if (this.attention.has(id)) return; // keep the original since (queue order)
    // a turn-end or bell means a turn happened — the session has started
    this.markEngaged(id);
    const att = { kind, since: this.now() };
    this.attention.set(id, att);
    this.emit('attention', id, att);
  }

  private clear(id: string): void {
    if (!this.attention.delete(id)) return;
    this.emit('attention', id, null);
  }

  private setWorking(id: string, working: boolean): void {
    if (working) {
      if (this.working.has(id)) return;
      this.working.add(id);
    } else if (!this.working.delete(id)) {
      return;
    }
    this.emit('activity', id, working);
  }

  private settleAgent(id: string): void {
    const session = this.manager?.list().find(item => item.id === id);
    if (session && session.harness !== 'shell') this.settled.add(id);
  }

  private drop(id: string): void {
    this.lastDataAt.delete(id);
    this.lastResizeAt.delete(id);
    this.burstBytes.delete(id);
    this.carry.delete(id);
    this.engaged.delete(id);
    this.settled.delete(id);
    this.setWorking(id, false);
    this.clear(id);
  }

  /**
   * Scan a raw chunk for a REAL bell. The subtlety: BEL both rings the bell
   * AND terminates OSC sequences (every title update is `ESC ] 0;… BEL`), so
   * a naive includes('\x07') would flag every TUI constantly. OSC bodies are
   * skipped (their notify variants 9/777 count as bells); sequences split
   * across chunks are carried per-session and re-scanned when the rest lands.
   */
  private scan(id: string, data: string): { bell: boolean } {
    let text = (this.carry.get(id) ?? '') + data;
    this.carry.delete(id);
    let bell = false;
    let i = 0;
    while (i < text.length) {
      const esc = text.indexOf('\x1b]', i);
      const plain = esc === -1 ? text.slice(i) : text.slice(i, esc);
      if (plain.includes('\x07')) bell = true;
      if (esc === -1) {
        // a chunk ending mid "ESC ]" must not leak its BEL terminator into
        // the next chunk's plain text
        if (text.endsWith('\x1b')) this.carry.set(id, '\x1b');
        return { bell };
      }
      const belEnd = text.indexOf('\x07', esc + 2);
      const stEnd = text.indexOf('\x1b\\', esc + 2);
      let end: number;
      let skip: number;
      if (belEnd !== -1 && (stEnd === -1 || belEnd < stEnd)) {
        end = belEnd;
        skip = 1;
      } else if (stEnd !== -1) {
        end = stEnd;
        skip = 2;
      } else {
        // unterminated OSC — carry it (bounded) into the next chunk. When
        // capping an oversized fragment (giant OSC 52 clipboard / OSC 1337
        // image payloads), the ESC ] introducer MUST survive the cap or the
        // remainder rescans as plain text and its BEL terminator rings a
        // phantom bell
        const frag = text.slice(esc);
        this.carry.set(
          id,
          frag.length > OSC_CARRY_LIMIT
            ? '\x1b]' + frag.slice(-OSC_CARRY_LIMIT)
            : frag
        );
        return { bell };
      }
      const body = text.slice(esc + 2, end);
      // terminal notifications ARE bells: OSC 9;<msg> / OSC 777;notify;…
      if (body.startsWith('9;') || body.startsWith('777;notify;')) bell = true;
      i = end + skip;
    }
    return { bell };
  }
}

export const attentionMonitor = new AttentionMonitor();
