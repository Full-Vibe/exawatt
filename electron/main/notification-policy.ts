import type { SessionAttention } from './pty/attention-monitor';
import type { PtySessionInfo } from './pty/session-manager';

export function shouldDeliverNativeNotification(
  enabled: boolean,
  windowFocused: boolean,
  attention: SessionAttention | null
): boolean {
  return enabled && !windowFocused && attention !== null;
}

export function nativeNotificationCopy(session: PtySessionInfo): {
  title: string;
  body: string;
} {
  const harness =
    session.harness === 'claude'
      ? 'Claude Code'
      : session.harness === 'codex'
        ? 'Codex'
        : 'Session';
  return {
    title: session.title || harness,
    body: `${harness} needs your attention in ${session.projectName}.`,
  };
}
