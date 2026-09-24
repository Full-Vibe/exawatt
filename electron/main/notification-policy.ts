import type { SessionAttention } from './pty/attention-monitor';
import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';
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
    session.harness === 'shell'
      ? 'Session'
      : agentSourceDeclaration(session.harness).label;
  return {
    title: session.title || harness,
    body: `${harness} needs your attention in ${session.projectName}.`,
  };
}
