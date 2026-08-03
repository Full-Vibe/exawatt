import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

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

export function handleTrusted(channel: string, handler: TrustedHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...(args as never[]));
  });
}
