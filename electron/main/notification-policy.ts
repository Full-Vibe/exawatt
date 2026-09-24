import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';
import type {
  PtyAttention,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';

export function shouldDeliverNativeNotification(
  enabled: boolean,
  windowFocused: boolean,
  attention: PtyAttention | null
): boolean {
  return enabled && !windowFocused && attention !== null;
}

export function nativeNotificationCopy(session: PtySessionRecord): {
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
