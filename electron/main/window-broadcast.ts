interface BroadcastWindow {
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
}

export function broadcastToWindows(
  windows: readonly BroadcastWindow[],
  channel: string,
  payload: unknown
): void {
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
