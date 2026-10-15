import { BrowserWindow } from 'electron';
import { handleTrusted } from './ipc-security';
import { broadcastToWindows } from './window-broadcast';
import {
  drainMainAnalyticsEvents,
  setMainAnalyticsNotifier,
} from './analytics-bridge';
import {
  readAnalyticsIdentity,
  setAnalyticsOptOut,
} from './analytics-identity';
import { recordAgentFinished } from './analytics-activity';
import { ptySessions } from './pty/session-manager';

/**
 * ENG-030 OS1.5b — the IPC half of the main→renderer analytics bridge.
 *
 * Narrow channels:
 *  - `analytics:main-process-events` (main→renderer): a payload-free nudge
 *    that events are waiting. Sent on every enqueue; harmless when no window
 *    is listening yet, because the renderer also drains once at startup.
 *  - `analytics:drain-main-events` (renderer→main, trusted-sender only): the
 *    atomic drain. Only the packaged renderer origin may call it, exactly like
 *    every other `handleTrusted` channel.
 *  - `analytics:identity` and `analytics:set-opt-out` (BUG-171): the device's
 *    opt-out and anonymous installation id, which main holds in settings so
 *    a launch on a fallback port reads the same answer as every other one.
 *
 * Events that arrive before any renderer exists sit in the bridge's bounded
 * queue; events a quitting app never drains are accepted losses (documented in
 * `analytics-bridge.ts` — no persistence on purpose).
 */
export function registerAnalyticsIPC(): void {
  setMainAnalyticsNotifier(() => {
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'analytics:main-process-events',
      null
    );
  });
  handleTrusted('analytics:drain-main-events', () =>
    drainMainAnalyticsEvents()
  );
  // ENG-047 F5: an Agent's process ending is Session-level activity.
  ptySessions.on('exit', (id: string) => recordAgentFinished(id));
  handleTrusted('analytics:identity', (_event, request) =>
    readAnalyticsIdentity(request)
  );
  handleTrusted('analytics:set-opt-out', (_event, optedOut) =>
    setAnalyticsOptOut(optedOut)
  );
}
