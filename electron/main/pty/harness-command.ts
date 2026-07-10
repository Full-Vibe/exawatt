import type { PtyHarness } from './session-manager';

const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]{8,128}$/;

export function buildHarnessCommand(
  harness: Exclude<PtyHarness, 'shell'>,
  harnessSessionId: string | null,
  resume: boolean
): string {
  if (harnessSessionId && !SAFE_SESSION_ID.test(harnessSessionId)) {
    throw new Error('Invalid harness session ID');
  }
  if (resume) {
    if (!harnessSessionId) throw new Error('Exact session ID required to resume');
    return harness === 'claude'
      ? `claude --resume ${harnessSessionId}`
      : `codex resume ${harnessSessionId}`;
  }
  return harness === 'claude' && harnessSessionId
    ? `claude --session-id ${harnessSessionId}`
    : harness;
}
