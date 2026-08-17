/**
 * The command engine's own state, as a fact the renderer can read (BUG-016).
 *
 * `bootstrapCommandSurface` brings up every local service the desktop app has:
 * the session manager, the PTY and Agent IPC, the roadmap watcher, the
 * consumption scanner. When it throws, the splash says "Command engine paused"
 * and that string is where the knowledge STOPPED — it lives on a `data:` URL
 * document that only main can write to, so no product surface could tell a
 * dead engine from a machine that simply has no desktop bridge. `/usage` then
 * rendered a complete, zeroed local read, which is a stronger claim than the
 * demo corpus it was accused of showing.
 *
 * This module is deliberately dependency-free — no `@exawatt/core`, no
 * service imports — so it survives the failures it reports. It is registered
 * before bootstrap starts and outlives it either way.
 */
import { broadcastToWindows } from './window-broadcast';
import { handleTrusted } from './ipc-security';

export type CommandEnginePhase = 'starting' | 'ready' | 'paused';

export const COMMAND_ENGINE_CHANNEL = 'app:command-engine';
export const COMMAND_ENGINE_CHANGED_CHANNEL = 'app:command-engine-changed';

interface BroadcastWindow {
  isDestroyed: () => boolean;
  webContents: { send: (channel: string, payload: unknown) => void };
}

let phase: CommandEnginePhase = 'starting';
let windows: () => readonly BroadcastWindow[] = () => [];

/** Terminal states win: an engine that paused does not drift back to
 *  `starting`, and a ready engine is only demoted by an explicit pause. */
export function setCommandEnginePhase(next: CommandEnginePhase): void {
  if (phase === next) return;
  phase = next;
  broadcastToWindows(windows(), COMMAND_ENGINE_CHANGED_CHANNEL, phase);
}

export function registerCommandEngineIPC(
  allWindows: () => readonly BroadcastWindow[]
): void {
  windows = allWindows;
  handleTrusted(COMMAND_ENGINE_CHANNEL, () => phase);
}
