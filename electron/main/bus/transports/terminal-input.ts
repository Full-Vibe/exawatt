/**
 * The keystroke door (decision `0052` §7, B0 verdicts 2026-10-15).
 *
 * The text arrives as one bracketed paste when the recipient's TUI has
 * bracketed paste switched on, so newlines stay text instead of submitting
 * early; and Enter is a SEPARATE write once the TUI has answered the paste.
 * Claude Code and Codex read a burst that ends in `\r` as a paste and insert
 * a newline instead of submitting (measured), so text and Enter in one write
 * would leave the message sitting unsent in the prompt.
 *
 * Control characters never reach the terminal: the bus strips them when it
 * accepts a send, so a message cannot press Ctrl-C, close the paste early, or
 * answer a dialog.
 */
import type { DeliveryResult } from '@exawatt/core';
import type { BusTransport, RecipientState } from './types';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

interface TerminalInputOptions {
  /** What a completed write records: `terminal` for a peer message (the
   *  degraded door, named as such), `delivered` for the operator's own turn,
   *  for which the terminal is the right door. */
  delivered: Extract<DeliveryResult['state'], 'terminal' | 'delivered'>;
  /** Where the core waits before typing. A harness that queues a pasted
   *  message itself needs only `blocked` (a paste must never answer a
   *  permission dialog); an unmeasured one waits for its turn to end too. */
  holdWhile: readonly Exclude<RecipientState, 'ready' | 'ended'>[];
}

export function terminalInputTransport(
  options: TerminalInputOptions
): BusTransport {
  return {
    kind: 'terminal-input',
    holdWhile: options.holdWhile,
    async deliver(_envelope, _target, context) {
      const terminal = context.terminal;
      if (!terminal) {
        return {
          state: 'undeliverable',
          reason: 'This Session has no terminal to type into',
          adapter: 'terminal-input',
        };
      }
      // A write to an exited Session lands nowhere, so each write says
      // whether it landed, and only one that did counts.
      const exited = {
        state: 'undeliverable',
        reason: 'The Agent exited before it could read this',
        adapter: 'terminal-input',
      } as const;
      const pasted = terminal.write(
        terminal.bracketedPaste()
          ? `${PASTE_START}${context.text}${PASTE_END}`
          : // Without bracketed paste a newline would submit early, so the
            // message arrives as one line.
            context.text.replace(/\s*\n\s*/g, ' ')
      );
      if (!pasted) return exited;
      await terminal.settled();
      if (!terminal.submit()) return exited;
      return { state: options.delivered, adapter: 'terminal-input' };
    },
  };
}
