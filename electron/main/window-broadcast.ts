import type {
  DesktopBridgePush,
  DesktopBridgePushChannel,
} from '@exawatt/core/desktop-bridge';

/**
 * Main → renderer pushes, typed by the desktop bridge contract. Every push
 * goes through one of these two, so a payload that drifts from what preload
 * relays and the renderer subscribes to fails `tsc` here.
 */

/** What a push is sent through: a `webContents`, or a stand-in for one. */
interface PushTarget {
  send: (channel: string, ...args: unknown[]) => void;
}

interface BroadcastWindow {
  isDestroyed: () => boolean;
  webContents: PushTarget;
}

/** A channel with no payload is sent with no argument at all. */
type PushPayload<C extends DesktopBridgePushChannel> = [
  DesktopBridgePush<C>,
] extends [void]
  ? []
  : [payload: DesktopBridgePush<C>];

export function pushToRenderer<C extends DesktopBridgePushChannel>(
  target: PushTarget,
  channel: C,
  ...payload: PushPayload<C>
): void {
  target.send(channel, ...payload);
}

export function broadcastToWindows<C extends DesktopBridgePushChannel>(
  windows: readonly BroadcastWindow[],
  channel: C,
  ...payload: PushPayload<C>
): void {
  for (const win of windows) {
    if (!win.isDestroyed())
      pushToRenderer(win.webContents, channel, ...payload);
  }
}
