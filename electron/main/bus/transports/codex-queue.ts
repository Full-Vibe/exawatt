/**
 * Codex's peer door (B0 verdicts, 2026-10-15; Codex 0.162.1).
 *
 * `codex queue --thread <uuid> --message <text>` queues the text for the
 * thread; Codex runs it as the thread's next turn (at once when idle, right
 * after the running turn when busy; no steer). It must run with the launch's
 * own `CODEX_HOME`, which is why it goes through the Session's login shell
 * and launch environment rather than Exawatt's. The result is `queued` until
 * the recipient's next turn starts.
 *
 * A queue to a thread whose TUI has exited is accepted and never read, so a
 * send to an ended Session is refused by the bus from its own roster before
 * this door is ever reached.
 */
import type { DeliveryResult } from '@exawatt/core';
import type { BusTransport } from './types';

const ADAPTER = 'codex-queue';

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim().slice(0, 200) ?? '';
}

export function codexQueueTransport(executable = 'codex'): BusTransport {
  return {
    kind: ADAPTER,
    holdWhile: [],
    queuedUntilTurnStart: true,
    async deliver(_envelope, target, context): Promise<DeliveryResult> {
      if (!target.harnessSessionId) {
        return {
          state: 'undeliverable',
          // Measured on 0.162.1: a Codex tab creates its thread with its first
          // turn, and `codex queue` needs the thread.
          reason:
            'Codex starts its conversation with its first task; give it one first',
          adapter: ADAPTER,
        };
      }
      const result = await context.runSourceCommand(executable, [
        'queue',
        '--thread',
        target.harnessSessionId,
        '--message',
        { env: 'EXAWATT_BUS_MESSAGE', value: context.text },
      ]);
      if (result.exitCode === 0) {
        return {
          state: 'queued',
          reason: 'Codex runs it as the thread’s next turn',
          adapter: ADAPTER,
        };
      }
      const detail = firstLine(result.stderr) || firstLine(result.stdout);
      return {
        state: 'undeliverable',
        reason: detail
          ? `codex queue refused it: ${detail}`
          : 'codex queue refused it',
        adapter: ADAPTER,
      };
    },
  };
}
