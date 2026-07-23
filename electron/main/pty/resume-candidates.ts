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
  description: string | null;
}

export interface ResumeIdentityHint {
  durableSessionId: string;
  harness: Exclude<PtyHarness, 'shell'>;
  cwd: string;
  initialTask: string | null;
  harnessSessionId: string | null;
}

export interface ReconciledResumeIdentity {
  durableSessionId: string;
  harness: Exclude<PtyHarness, 'shell'>;
  cwd: string;
  harnessSessionId: string;
  source: 'durable-index' | 'task-correlation';
}

const catalogs = new Map<string, RecentConversationCatalog>();

function catalogFor(
  harness: Exclude<PtyHarness, 'shell'>,
  sessionsRoot = path.join(os.homedir(), '.codex', 'sessions')
): RecentConversationCatalog {
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
  return catalog;
}

export function invalidateResumeCandidates(
  harness: Exclude<PtyHarness, 'shell'>,
  cwd: string
): void {
  catalogFor(harness).invalidate(cwd);
}

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
  return (
    await catalogFor(harness, sessionsRoot).listForHarness(harness, cwd)
  ).map(candidate => ({
    id: candidate.id,
    cwd: candidate.cwd,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    label: candidate.title,
    description: candidate.description,
  }));
}

/**
 * Repair legacy identity-less Sessions conservatively. Durable-index matches
 * win; task correlation is accepted only when the relation is one-to-one on
 * both sides and the provider identity is not already owned by another tab.
 */
export async function reconcileResumeIdentities(
  hints: ResumeIdentityHint[],
  durableIdentities: ReadonlyMap<
    string,
    {
      harness: Exclude<PtyHarness, 'shell'>;
      harnessSessionId: string;
      cwd: string;
    }
  >,
  findCandidates: (hint: ResumeIdentityHint) => Promise<string[]> = hint =>
    hint.initialTask
      ? catalogFor(hint.harness).providerIdentityCandidates(
          hint.harness,
          hint.cwd,
          hint.initialTask
        )
      : Promise.resolve([])
): Promise<ReconciledResumeIdentity[]> {
  const repaired: ReconciledResumeIdentity[] = [];
  const identityKey = (harness: ResumeIdentityHint['harness'], id: string) =>
    `${harness}:${id}`;
  const claimed = new Set(
    hints.flatMap(hint =>
      hint.harnessSessionId
        ? [identityKey(hint.harness, hint.harnessSessionId)]
        : []
    )
  );
  const unresolved: ResumeIdentityHint[] = [];
  const durableOwners = new Map<string, string[]>();
  for (const hint of hints) {
    if (hint.harnessSessionId) continue;
    const durable = durableIdentities.get(hint.durableSessionId);
    if (!durable || durable.harness !== hint.harness) continue;
    const key = identityKey(hint.harness, durable.harnessSessionId);
    durableOwners.set(key, [
      ...(durableOwners.get(key) ?? []),
      hint.durableSessionId,
    ]);
  }

  for (const hint of hints) {
    if (hint.harnessSessionId) continue;
    const durable = durableIdentities.get(hint.durableSessionId);
    if (
      durable &&
      durable.harness === hint.harness &&
      !claimed.has(identityKey(hint.harness, durable.harnessSessionId)) &&
      durableOwners.get(identityKey(hint.harness, durable.harnessSessionId))
        ?.length === 1
    ) {
      repaired.push({
        durableSessionId: hint.durableSessionId,
        harness: hint.harness,
        cwd: hint.cwd,
        harnessSessionId: durable.harnessSessionId,
        source: 'durable-index',
      });
      claimed.add(identityKey(hint.harness, durable.harnessSessionId));
    } else {
      unresolved.push(hint);
    }
  }

  const candidateSets = await Promise.all(
    unresolved.map(async hint => ({
      hint,
      candidates: hint.initialTask
        ? (await findCandidates(hint)).filter(
            candidate => !claimed.has(identityKey(hint.harness, candidate))
          )
        : [],
    }))
  );
  const owners = new Map<string, string[]>();
  for (const { hint, candidates } of candidateSets) {
    for (const candidate of candidates) {
      const key = identityKey(hint.harness, candidate);
      owners.set(key, [...(owners.get(key) ?? []), hint.durableSessionId]);
    }
  }
  for (const { hint, candidates } of candidateSets) {
    if (candidates.length !== 1) continue;
    const harnessSessionId = candidates[0];
    if (owners.get(identityKey(hint.harness, harnessSessionId))?.length !== 1) {
      continue;
    }
    repaired.push({
      durableSessionId: hint.durableSessionId,
      harness: hint.harness,
      cwd: hint.cwd,
      harnessSessionId,
      source: 'task-correlation',
    });
  }
  return repaired;
}
