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
 * looks (focus), answers (input while looking), or the session demonstrably
 * resumes working on its own (substantial output after the flag — a bell
 * mid-run must not read 'blocked' forever). A spawn grace period keeps
 * auto-revived tabs from all lighting up at app start.
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
  private burstBytes = new Map<string, number>();
  /** sessions currently emitting output — the renderer's "working" glyphs */
  private working = new Set<string>();
  /** output since a flag was raised — substantial resumption clears it */
  private bytesSinceFlag = new Map<string, number>();
  /** unterminated escape-sequence tail carried to the next chunk */
  private carry = new Map<string, string>();
  private focusedId: string | null = null;
  /** OS focus of the app window: an active tab behind another app is NOT
   *  being looked at — start false; the startup focus event corrects it */
  private windowFocused = false;
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
    this.lastDataAt.set(id, this.now());
    if (!this.working.has(id)) {
      this.working.add(id);
      this.emit('activity', id, true);
    }
    this.burstBytes.set(id, (this.burstBytes.get(id) ?? 0) + data.length);
    // a flagged session that RESUMES real work was not actually waiting —
    // clear once post-flag output is substantial (repaint noise stays under
    // the burst bar; a true prompt-wait produces ~nothing)
    if (this.attention.has(id)) {
      const since = (this.bytesSinceFlag.get(id) ?? 0) + data.length;
      if (since >= Math.max(1, this.opts.minBurstBytes)) {
        this.clear(id);
      } else {
        this.bytesSinceFlag.set(id, since);
      }
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
          this.working.delete(s.id);
          this.emit('activity', s.id, false);
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
      this.raise(s.id, 'turn-end');
    }
    // sessions killed without an exit event (tab closed) leave no residue
    for (const id of Array.from(this.lastDataAt.keys())) {
      if (!live.has(id)) this.drop(id);
    }
  }

  private raise(id: string, kind: AttentionKind): void {
    if (this.attention.has(id)) return; // keep the original since (queue order)
    const att = { kind, since: this.now() };
    this.attention.set(id, att);
    this.bytesSinceFlag.set(id, 0);
    this.emit('attention', id, att);
  }

  private clear(id: string): void {
    this.bytesSinceFlag.delete(id);
    if (!this.attention.delete(id)) return;
    this.emit('attention', id, null);
  }

  private drop(id: string): void {
    this.lastDataAt.delete(id);
    this.burstBytes.delete(id);
    this.carry.delete(id);
    if (this.working.delete(id)) this.emit('activity', id, false);
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
