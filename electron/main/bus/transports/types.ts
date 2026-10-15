/**
 * What a bus transport plugin is handed (ENG-029 C4, decision `0052`'s
 * plugin boundary).
 *
 * A transport is the one place that knows a mechanism — a socket, a CLI
 * queue, a terminal — and it is declared by the recipient harness's launch
 * descriptor (`messaging` in `harness-registry.ts`). The bus core resolves it
 * from the descriptor and calls `deliver`; it never branches on a harness id.
 */
import type { AgentHarness, MessagingTransport } from '@exawatt/core';

/** The live Session a message is for. */
export interface BusTarget {
  /** Durable Session id: the address. */
  sessionId: string;
  /** The running process's id (`pty-3`), for the doors that need it. */
  ptyId: string;
  name: string;
  harness: AgentHarness;
  /** The source's own conversation id, once known. */
  harnessSessionId: string | null;
  cwd: string;
}

/** The recipient's terminal, for the keystroke door. */
export interface TerminalDoor {
  /** True while the recipient's TUI has bracketed paste switched on. */
  bracketedPaste(): boolean;
  /** One write to the PTY. */
  write(data: string): void;
  /** Resolves once the TUI has answered the last write (its echo went
   *  quiet), or at a bound if it never does. */
  settled(): Promise<void>;
  /** Press Enter, as its own write: the turn this opens is work given to
   *  the Session, exactly as if the operator had pressed it. */
  submit(): void;
}

/** One argument of a source command. A literal is shell-quoted; free text
 *  travels in the environment and is referenced as `"$NAME"`, so no shell's
 *  quoting rules (fish reads `\\` inside single quotes) can alter it. */
export type SourceCommandArg = string | { env: string; value: string };

export interface SourceCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface BusDeliveryContext {
  /** Exactly what the recipient receives: the stamped text for a peer
   *  message, the operator's own words for an operator message. */
  text: string;
  /** Null when the Session has no terminal Exawatt can write to. */
  terminal: TerminalDoor | null;
  /** Run the source's own CLI the way its launch resolved it: the login
   *  shell, the launch environment, the Session's directory. */
  runSourceCommand(
    executable: string,
    args: readonly SourceCommandArg[]
  ): Promise<SourceCommandResult>;
}

/** What the recipient is doing, from the existing turn truth and its
 *  terminal. `starting`: its TUI has not drawn its input yet, and input
 *  typed then reaches a program still probing its terminal (measured: a
 *  Claude Code tab given keystrokes in its first instant never drew). */
export type RecipientState =
  | 'starting'
  | 'running'
  | 'blocked'
  | 'ready'
  | 'ended';

/** A transport plugin, plus the two facts the core needs to schedule it. */
export interface BusTransport extends MessagingTransport<
  BusTarget,
  BusDeliveryContext
> {
  /** States in which the core holds a message for this door, delivering it
   *  when the recipient leaves them. A door that never answers a dialog
   *  (a socket, a CLI queue) declares none. */
  holdWhile: readonly Exclude<RecipientState, 'ready' | 'ended'>[];
  /** A `queued` result from this door becomes `delivered` when the
   *  recipient's next turn starts (the harness runs it as that turn). */
  queuedUntilTurnStart?: boolean;
}
