import { BrowserWindow } from 'electron';
import { handleTrusted } from './ipc-security';
import { broadcastToWindows } from './window-broadcast';
import {
  drainMainAnalyticsEvents,
  setMainAnalyticsNotifier,
} from './analytics-bridge';

/**
 * ENG-030 OS1.5b — the IPC half of the main→renderer analytics bridge.
 *
 * Two channels, both narrow:
 *  - `analytics:main-process-events` (main→renderer): a payload-free nudge
 *    that events are waiting. Sent on every enqueue; harmless when no window
 *    is listening yet, because the renderer also drains once at startup.
 *  - `analytics:drain-main-events` (renderer→main, trusted-sender only): the
 *    atomic drain. Only the packaged renderer origin may call it, exactly like
 *    every other `handleTrusted` channel.
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
}
