import type { EventEmitter } from 'events';

/** Subscribe before sampling: the foreground window can predate async IPC setup. */
export function observeNativeWindowFocus(
  events: Pick<EventEmitter, 'on' | 'removeListener'>,
  readFocused: () => boolean,
  receive: (focused: boolean) => void
): () => void {
  const focus = () => receive(true);
  const blur = () => receive(false);
  events.on('browser-window-focus', focus);
  events.on('browser-window-blur', blur);
  receive(readFocused());
  return () => {
    events.removeListener('browser-window-focus', focus);
    events.removeListener('browser-window-blur', blur);
  };
}
