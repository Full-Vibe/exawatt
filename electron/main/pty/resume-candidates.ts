import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PtyHarness } from './session-manager';
import {
  CodexConversationAdapter,
  RecentConversationCatalog,
  parseOpencodeSessionList,
} from './conversation-catalog';

export { parseOpencodeSessionList } from './conversation-catalog';

const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

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

async function listOpencodeResumeCandidates(
  cwd: string,
  shell: string,
  timeoutMs = 15_000
): Promise<HarnessResumeCandidate[]> {
  const testExecutable =
    process.env.EXAWATT_TEST === '1' &&
    process.env.EXAWATT_TEST_HARNESS_BIN &&
    path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
      ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, 'opencode')
      : null;
  const invocation = testExecutable ? shellQuote(testExecutable) : 'opencode';
  let stdout = '';
  try {
    const result = await execFileAsync(
      shell,
      [
        '-l',
        '-c',
        `${invocation} --pure session list --format json --max-count 200`,
      ],
      {
        cwd,
        timeout: Math.max(1, Math.min(15_000, timeoutMs)),
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      }
    );
    stdout = result.stdout;
  } catch {
    throw new Error('OpenCode session catalog command failed');
  }
  try {
    if (!Array.isArray(JSON.parse(stdout) as unknown)) {
      throw new Error('not an array');
    }
  } catch {
    throw new Error('OpenCode session catalog returned invalid JSON');
  }
  const canonicalCwd = await fs.promises
    .realpath(cwd)
    .catch(() => path.resolve(cwd));
  const rows = await Promise.all(
    parseOpencodeSessionList(stdout).map(async session => ({
      session,
      canonicalDirectory: await fs.promises
        .realpath(session.directory)
        .catch(() => path.resolve(session.directory)),
    }))
  );
  return rows
    .filter(row => row.canonicalDirectory === canonicalCwd)
    .map(({ session, canonicalDirectory }) => ({
      id: session.id,
      cwd: canonicalDirectory,
      startedAt: session.created,
      updatedAt: session.updated,
      label: session.title.trim() || 'OpenCode session',
      description: null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/**
 * Read the source-owned first-turn agent marker for one OpenCode session.
 * S2 gives every launch a collision-resistant agent name, so this proves
 * causal ownership without relying on directory, recency, or timing.
 */
export async function opencodeSessionAgent(
  sessionId: string,
  cwd: string,
  shell: string,
  timeoutMs = 15_000
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new Error('Invalid OpenCode session identity');
  }
  const testExecutable =
    process.env.EXAWATT_TEST === '1' &&
    process.env.EXAWATT_TEST_HARNESS_BIN &&
    path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
      ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, 'opencode')
      : null;
  const invocation = testExecutable ? shellQuote(testExecutable) : 'opencode';
  let stdout = '';
  try {
    const result = await execFileAsync(
      shell,
      ['-l', '-c', `${invocation} --pure export ${shellQuote(sessionId)}`],
      {
        cwd,
        timeout: Math.max(1, Math.min(15_000, timeoutMs)),
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      }
    );
    stdout = result.stdout;
  } catch {
    throw new Error('OpenCode session export command failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error('OpenCode session export returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const messages = (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const info = (message as { info?: unknown }).info;
    if (!info || typeof info !== 'object') continue;
    const record = info as { role?: unknown; agent?: unknown };
    if (record.role === 'user') {
      return typeof record.agent === 'string' ? record.agent : null;
    }
  }
  return null;
}

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
  sessionsRoot = path.join(os.homedir(), '.codex', 'sessions'),
  shell = process.env.SHELL || '/bin/zsh',
  timeoutMs = 15_000
): Promise<HarnessResumeCandidate[]> {
  if (harness === 'shell') return [];
  if (harness === 'opencode') {
    return listOpencodeResumeCandidates(cwd, shell, timeoutMs);
  }
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
