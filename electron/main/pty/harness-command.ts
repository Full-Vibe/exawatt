import type { PtyHarness } from './session-manager';

const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]{8,128}$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildHarnessCommand(
  harness: Exclude<PtyHarness, 'shell'>,
  harnessSessionId: string | null,
  resume: boolean,
  executable?: string
): string {
  if (harnessSessionId && !SAFE_SESSION_ID.test(harnessSessionId)) {
    throw new Error('Invalid harness session ID');
  }
  if (executable && !executable.startsWith('/')) {
    throw new Error('Harness executable override must be absolute');
  }
  const command = executable ? shellQuote(executable) : harness;
  if (resume) {
    if (!harnessSessionId) throw new Error('Exact session ID required to resume');
    return harness === 'claude'
      ? `${command} --resume ${harnessSessionId}`
      : `${command} resume ${harnessSessionId}`;
  }
  return harness === 'claude' && harnessSessionId
    ? `${command} --session-id ${harnessSessionId}`
    : command;
}
