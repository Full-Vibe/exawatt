import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  beginMainThreadActivity,
  endMainThreadActivity,
} from './main-thread-stall-trace';

type TrustedHandler = (
  event: IpcMainInvokeEvent,
  ...args: never[]
) => unknown | Promise<unknown>;

let trustedOrigin: string | null = null;

export function setTrustedRendererOrigin(url: string): void {
  trustedOrigin = new URL(url).origin;
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent | IpcMainEvent
): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  let senderOrigin: string;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    throw new Error('Rejected IPC from an invalid renderer URL');
  }
  if (!trustedOrigin || senderOrigin !== trustedOrigin) {
    throw new Error(`Rejected IPC from untrusted origin: ${senderOrigin}`);
  }
}

/**
 * The single door for renderer→main work, which is why the stall trace hangs
 * here: one wrapper names every unit of IPC work without touching ~90 call
 * sites. `begin`/`end` are a Map write and a Map delete when the trace is on,
 * and a returned 0 when it is off.
 */
export function handleTrusted(channel: string, handler: TrustedHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    const token = beginMainThreadActivity(channel);
    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      endMainThreadActivity(token);
    };
    try {
      const result = handler(event, ...(args as never[]));
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          value => {
            close();
            return value;
          },
          error => {
            close();
            throw error;
          }
        );
      }
      close();
      return result;
    } catch (error) {
      close();
      throw error;
    }
  });
}
