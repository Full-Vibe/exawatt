/**
 * Agent names (ENG-029 C4, operator decision 2026-10-15): the short, stable,
 * renameable name an Agent wears on its tab, tile and Fleet label, and the
 * address the operator and other Agents use (`send this to @codex-2`).
 *
 * Assigned at launch as the harness's short name and an ordinal per Project
 * (`claude-1`, `codex-2`, `gemini-1` for Antigravity), stable across relaunch
 * and resume because it is keyed by the durable Session, and changed only by
 * an operator rename. Names are unique within a Project, compared without
 * case; a rename onto a taken name is refused with the reason, never
 * suffixed. The descriptive context label is a separate, changing thing and
 * never feeds the name.
 *
 * Pure data and pure functions: Electron main persists the records
 * (`electron/main/pty/agent-name-store.ts`) and is the one truth; the
 * renderer reads them; Demo Mode runs the same allocation over its fixtures.
 */

export const AGENT_NAME_MAX_LENGTH = 32;

/** Who chose the name: allocation at launch, or the operator. */
type AgentNameOrigin = 'assigned' | 'operator';

export interface AgentNameRecord {
  /** The Exawatt Session id: the address beneath the name. */
  durableSessionId: string;
  /** The Project the name is unique within (the workspace's Project key). */
  projectKey: string;
  harness: string;
  name: string;
  origin: AgentNameOrigin;
  updatedAt: number;
}

/** One Session that needs a name, in the order names should be dealt. */
export interface AgentNameRequest {
  durableSessionId: string;
  projectKey: string;
  harness: string;
  /**
   * A name the operator already chose under an older build (a renamed tab's
   * title). Honored when it is a valid, free name once whitespace becomes
   * hyphens; otherwise the Session is allocated like any other.
   */
  preferredName?: string | null;
}

type AgentNameRefusal = 'empty' | 'length' | 'characters' | 'reserved';

type AgentNameValidation =
  | { ok: true; name: string }
  | { ok: false; code: AgentNameRefusal; reason: string };

export type AgentRenameResult =
  | { ok: true; record: AgentNameRecord }
  | {
      ok: false;
      code: AgentNameRefusal | 'taken' | 'unknown';
      reason: string;
    };

/** Short names where the harness id is not what the operator calls it. */
const HARNESS_NAME_PREFIX: Readonly<Record<string, string>> = {
  // ENG-003 S5.3.1: the source reads "Gemini"; Antigravity CLI is its engine.
  antigravity: 'gemini',
};

/**
 * Held back for the bus's own vocabulary: the operator's stamp on a message,
 * a future broadcast, and the product itself.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'operator',
  'all',
  'everyone',
  'exawatt',
]);

const NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}_-]*[\p{L}\p{N}])?$/u;

/** Shell tabs are terminals, not Agents: they carry no name. */
export function harnessCarriesAgentName(harness: string): boolean {
  return harness !== 'shell' && !!harness.trim();
}

/** `claude`, `codex`, `gemini` (Antigravity), `opencode`, `grok`, `qwen`… */
export function agentNamePrefix(harness: string): string {
  const mapped = HARNESS_NAME_PREFIX[harness];
  if (mapped) return mapped;
  const cleaned = harness
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'agent';
}

/** The comparison key: names are unique and addressed without case. */
function agentNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * What the operator typed, as a name or the reason it is not one. A leading
 * `@` is the address sigil, not part of the name, and whitespace becomes a
 * hyphen so `code reviewer` reads back as `code-reviewer`.
 */
export function validateAgentName(input: string): AgentNameValidation {
  const name = input
    .normalize('NFC')
    .trim()
    .replace(/^@+/, '')
    .trim()
    .replace(/\s+/g, '-');
  if (!name) return { ok: false, code: 'empty', reason: 'Enter a name' };
  if ([...name].length > AGENT_NAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'length',
      reason: `Use at most ${AGENT_NAME_MAX_LENGTH} characters`,
    };
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      code: 'characters',
      reason:
        'Use letters, numbers, - and _, starting and ending with a letter or number',
    };
  }
  if (RESERVED_NAMES.has(agentNameKey(name))) {
    return { ok: false, code: 'reserved', reason: `${name} is reserved` };
  }
  return { ok: true, name };
}

/** The lowest free `<prefix>-<n>` among the names already taken. */
export function allocateAgentName(
  harness: string,
  taken: ReadonlySet<string>
): string {
  const prefix = agentNamePrefix(harness);
  for (let ordinal = 1; ; ordinal += 1) {
    const candidate = `${prefix}-${ordinal}`;
    if (!taken.has(agentNameKey(candidate))) return candidate;
  }
}

function takenInProject(
  records: Iterable<AgentNameRecord>,
  projectKey: string,
  except?: string
): Set<string> {
  const taken = new Set<string>();
  for (const record of records) {
    if (record.projectKey !== projectKey) continue;
    if (record.durableSessionId === except) continue;
    taken.add(agentNameKey(record.name));
  }
  return taken;
}

/**
 * Give every requested Session a name, keeping the ones it already has.
 *
 * Deterministic: the same records and the same requests in the same order
 * always deal the same names (operator-chosen names first), which is what lets a first read name a whole
 * existing layout (tab order within each Project) without surprising anyone.
 * A Session that moved Project keeps its name when it is free there and is
 * dealt a fresh one when it is not.
 */
export function assignAgentNames(
  records: readonly AgentNameRecord[],
  requests: readonly AgentNameRequest[],
  now: number
): { records: AgentNameRecord[]; changed: boolean } {
  const byId = new Map(
    records.map(record => [record.durableSessionId, record])
  );
  let changed = false;
  // A name the operator chose is dealt before any allocation, so an older
  // rename is never pre-empted by a neighbour's ordinal.
  const ordered = [
    ...requests.filter(request => request.preferredName),
    ...requests.filter(request => !request.preferredName),
  ];
  for (const request of ordered) {
    if (!harnessCarriesAgentName(request.harness)) continue;
    const existing = byId.get(request.durableSessionId);
    if (existing && existing.projectKey === request.projectKey) continue;
    const taken = takenInProject(
      byId.values(),
      request.projectKey,
      request.durableSessionId
    );
    if (existing && !taken.has(agentNameKey(existing.name))) {
      byId.set(request.durableSessionId, {
        ...existing,
        projectKey: request.projectKey,
        updatedAt: now,
      });
      changed = true;
      continue;
    }
    const preferred = request.preferredName
      ? validateAgentName(request.preferredName)
      : null;
    const keepsPreferred =
      !existing &&
      preferred?.ok === true &&
      !taken.has(agentNameKey(preferred.name));
    byId.set(request.durableSessionId, {
      durableSessionId: request.durableSessionId,
      projectKey: request.projectKey,
      harness: request.harness,
      name:
        keepsPreferred && preferred?.ok
          ? preferred.name
          : allocateAgentName(request.harness, taken),
      origin: keepsPreferred ? 'operator' : 'assigned',
      updatedAt: now,
    });
    changed = true;
  }
  return { records: [...byId.values()], changed };
}

/**
 * The operator's rename. Refused, with the reason, when the name is not a
 * name or another Agent in the same Project already wears it.
 */
export function renameAgentName(
  records: readonly AgentNameRecord[],
  durableSessionId: string,
  input: string,
  now: number
): AgentRenameResult {
  const current = records.find(
    record => record.durableSessionId === durableSessionId
  );
  if (!current) {
    return { ok: false, code: 'unknown', reason: 'This Agent has no name yet' };
  }
  const validation = validateAgentName(input);
  if (!validation.ok) return validation;
  const taken = takenInProject(records, current.projectKey, durableSessionId);
  if (taken.has(agentNameKey(validation.name))) {
    return {
      ok: false,
      code: 'taken',
      reason: `Another Agent in this Project is named ${validation.name}`,
    };
  }
  return {
    ok: true,
    record: {
      ...current,
      name: validation.name,
      origin: 'operator',
      updatedAt: now,
    },
  };
}

/** What the resolver needs to know about one addressable Agent. */
export interface AgentDirectoryEntry {
  durableSessionId: string;
  projectKey: string;
  harness: string;
  name: string;
}

type AgentAddressResolution<T extends AgentDirectoryEntry> =
  | { kind: 'agent'; agent: T }
  | { kind: 'ambiguous'; reason: string; candidates: T[] }
  | { kind: 'none'; reason: string; elsewhere: T[] };

/**
 * Resolve `@name`, `name`, or a Session id to one Agent in `projectKey`
 * (decision 0052: an address resolves within the Project only).
 *
 * An exact name wins. A harness's short name (`@codex`) reaches the one
 * Agent of that harness in the Project other than the sender, and lists the
 * candidates when there are several: an Agent saying `@claude` means its
 * peer, never itself. A name that exists only in another Project fails with
 * that reason, and the matches are returned so a caller can name them.
 * Exact names and Session ids still resolve to the sender; refusing a send
 * to oneself is the bus's rule, with its own reason.
 */
export function resolveAgentAddress<T extends AgentDirectoryEntry>(
  directory: readonly T[],
  projectKey: string,
  address: string,
  options: { sender?: string | null } = {}
): AgentAddressResolution<T> {
  const raw = address.trim();
  if (!raw) return { kind: 'none', reason: 'Name an Agent', elsewhere: [] };

  const bySession = directory.find(entry => entry.durableSessionId === raw);
  if (bySession) {
    return bySession.projectKey === projectKey
      ? { kind: 'agent', agent: bySession }
      : {
          kind: 'none',
          reason: `${bySession.name} is in another Project`,
          elsewhere: [bySession],
        };
  }

  const wanted = raw.replace(/^@+/, '');
  const key = agentNameKey(wanted);
  const inProject = directory.filter(entry => entry.projectKey === projectKey);

  const exact = inProject.filter(entry => agentNameKey(entry.name) === key);
  if (exact.length === 1) return { kind: 'agent', agent: exact[0]! };
  if (exact.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `Several Agents here are named ${wanted}`,
      candidates: exact,
    };
  }

  const wholeFamily = inProject.filter(
    entry =>
      agentNamePrefix(entry.harness) === key ||
      agentNameKey(entry.harness) === key
  );
  const family = wholeFamily.filter(
    entry => entry.durableSessionId !== options.sender
  );
  if (family.length === 1) return { kind: 'agent', agent: family[0]! };
  if (family.length > 1) {
    return {
      kind: 'ambiguous',
      reason: `Several ${wanted} Agents here: ${family
        .map(entry => entry.name)
        .join(', ')}`,
      candidates: family,
    };
  }

  if (wholeFamily.length > 0) {
    return {
      kind: 'none',
      reason: `No other ${wanted} Agent in this Project`,
      elsewhere: [],
    };
  }

  const elsewhere = directory.filter(
    entry => entry.projectKey !== projectKey && agentNameKey(entry.name) === key
  );
  return {
    kind: 'none',
    reason: elsewhere.length
      ? `@${wanted} is in another Project`
      : `No Agent named @${wanted} in this Project`,
    elsewhere,
  };
}
