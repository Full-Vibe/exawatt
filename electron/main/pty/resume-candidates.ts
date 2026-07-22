import os from 'os';
import path from 'path';
import type { PtyHarness } from './session-manager';
import {
  CodexConversationAdapter,
  RecentConversationCatalog,
} from './conversation-catalog';

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  /** Provider session creation time, used to associate parallel launches. */
  startedAt: number;
  updatedAt: number;
  label: string;
}

const catalogs = new Map<string, RecentConversationCatalog>();

export async function listResumeCandidates(
  harness: PtyHarness,
  cwd: string,
  sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')
): Promise<HarnessResumeCandidate[]> {
  if (harness === 'shell') return [];
  // The third argument is the legacy Codex fixture/injection seam. Do not
  // reinterpret a custom Codex root as a Claude projects root.
  if (
    harness !== 'codex' &&
    sessionsRoot !== path.join(os.homedir(), '.codex', 'sessions')
  ) {
    return [];
  }
  const key = harness === 'codex' ? sessionsRoot : `default:${harness}`;
  let catalog = catalogs.get(key);
  if (!catalog) {
    catalog =
      harness === 'codex'
        ? new RecentConversationCatalog({
            adapters: [new CodexConversationAdapter(sessionsRoot)],
          })
        : new RecentConversationCatalog();
    catalogs.set(key, catalog);
  }
  return (await catalog.listForHarness(harness, cwd)).map(candidate => ({
    id: candidate.id,
    cwd: candidate.cwd,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    label: candidate.title,
  }));
}
