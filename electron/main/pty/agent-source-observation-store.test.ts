import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AgentSourceAdapterId,
  AgentSourceSnapshot,
  AgentSourceState,
} from '@exawatt/core';
import { RETENTION_ANCHOR_FUTURE_TOLERANCE_MS } from '@exawatt/core';
import {
  AgentSourceObservationStore,
  OBSERVATION_MAX_AGE_MS,
  evictObservationRows,
} from './agent-source-observation-store';
import { agentSourceDeclaration } from './generated-agent-source-declarations';

const FISH = '/opt/homebrew/bin/fish';
/** Wall time for the pure bound; well past every fixture row. */
const WALL = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;
const ZSH = '/bin/zsh';

function snapshot(
  adapterId: AgentSourceAdapterId,
  overrides: Partial<AgentSourceSnapshot> = {}
): AgentSourceSnapshot {
  const fact = {
    basis: 'observed' as const,
    state: 'ready' as const,
    value: 'ok',
    detail: '',
    provenance: {
      kind: 'source-command' as const,
      label: 'CLI',
      observedAt: 1,
    },
  };
  return {
    ...agentSourceDeclaration(adapterId),
    id: `${adapterId}-local`,
    configured: true,
    launchable: true,
    state: 'ready' as AgentSourceState,
    stateLabel: 'Ready',
    summary: '',
    observedAt: 1_000,
    observation: { origin: 'live' },
    unobservedProbes: [],
    facts: {
      installation: fact,
      reachability: fact,
      authentication: fact,
      identity: fact,
      compatibility: fact,
      modelDiscovery: fact,
    },
    actions: {
      recheck: true,
      authenticate: false,
      chooseModel: false,
      installGuide: true,
    },
    ...overrides,
  };
}

let directory: string;

beforeEach(async () => {
  directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-source-observations-')
  );
});

afterEach(async () => {
  await fs.promises.rm(directory, { recursive: true, force: true });
});

const makeStore = () => new AgentSourceObservationStore(() => directory);

describe('AgentSourceObservationStore', () => {
  it('remembers a complete live observation and serves it back for the same shell', async () => {
    const store = makeStore();
    await store.remember(FISH, snapshot('claude'));
    const remembered = await store.read(FISH);
    expect(remembered.get('claude')?.state).toBe('ready');
    expect(await store.read(ZSH)).toEqual(new Map());
  });

  it('survives the process: a fresh store reads what the last one wrote', async () => {
    await makeStore().remember(FISH, snapshot('codex', { observedAt: 5 }));
    const reread = await makeStore().read(FISH);
    expect(reread.get('codex')?.observedAt).toBe(5);
  });

  // The whole point: a probe that timed out must not overwrite the memory.
  it('writes nothing for an incomplete observation, so the last-known-good stays', async () => {
    const store = makeStore();
    await store.remember(FISH, snapshot('claude', { observedAt: 10 }));
    await store.remember(
      FISH,
      snapshot('claude', {
        observedAt: 20,
        state: 'unknown',
        unobservedProbes: ['version'],
      })
    );
    expect((await store.read(FISH)).get('claude')?.observedAt).toBe(10);
  });

  it('never remembers a declared, remembered, or simulated snapshot', async () => {
    const store = makeStore();
    await store.remember(
      FISH,
      snapshot('claude', { observation: { origin: 'declared' } })
    );
    await store.remember(
      FISH,
      snapshot('codex', {
        observation: { origin: 'remembered', revalidation: null },
      })
    );
    await store.remember(FISH, snapshot('demo'));
    expect(await store.size()).toBe(0);
  });

  it('does not let an older observation overwrite a newer one', async () => {
    const store = makeStore();
    await store.remember(FISH, snapshot('claude', { observedAt: 50 }));
    await store.remember(
      FISH,
      snapshot('claude', { observedAt: 40, state: 'not-installed' })
    );
    expect((await store.read(FISH)).get('claude')?.state).toBe('ready');
  });

  it('holds at most one row per adapter and drops the other shell at the write', async () => {
    const store = makeStore();
    await store.remember(ZSH, snapshot('claude', { observedAt: 1 }));
    await store.remember(ZSH, snapshot('codex', { observedAt: 2 }));
    await store.remember(FISH, snapshot('claude', { observedAt: 3 }));
    // A shell change replaces the set: the zsh rows read a different PATH.
    expect(await store.size()).toBe(1);
    expect((await store.read(FISH)).get('claude')?.observedAt).toBe(3);
  });

  it('starts clean from a file it cannot parse', async () => {
    await fs.promises.writeFile(
      path.join(directory, 'agent-source-observations.json'),
      '{not json'
    );
    expect(await makeStore().read(FISH)).toEqual(new Map());
  });
});

describe('evictObservationRows (decision 0039 bound)', () => {
  it('anchors the age bound on the newest row, not the clock', () => {
    const file = {
      schemaVersion: 1,
      rows: {
        claude: { shell: FISH, observedAt: 1_000, snapshot: snapshot('claude') },
        codex: {
          shell: FISH,
          observedAt: 1_000 + OBSERVATION_MAX_AGE_MS + 1,
          snapshot: snapshot('codex'),
        },
      },
    };
    expect(evictObservationRows(file, { shell: FISH, nowMs: WALL })).toBe(1);
    expect(Object.keys(file.rows)).toEqual(['codex']);
  });

  it('evicts rows from another shell only when a shell is named', () => {
    const rows = () => ({
      schemaVersion: 1,
      rows: {
        claude: { shell: ZSH, observedAt: 1, snapshot: snapshot('claude') },
      },
    });
    const sweep = rows();
    expect(evictObservationRows(sweep, { shell: null, nowMs: WALL })).toBe(0);
    const write = rows();
    expect(evictObservationRows(write, { shell: FISH, nowMs: WALL })).toBe(1);
  });
});

// BUG-182, the sibling of BUG-141's consumption clamp (decision 0039
// amendment). One observation stamped while the clock ran two years fast
// used to become the anchor: every real row more than thirty days behind it
// was deleted, and every later real observation was refused as "older".
describe('a future-dated observation (decision 0039 future tolerance)', () => {
  const file = (rows: Record<string, number>) => ({
    schemaVersion: 1,
    rows: Object.fromEntries(
      Object.entries(rows).map(([adapterId, observedAt]) => [
        adapterId,
        {
          shell: FISH,
          observedAt,
          snapshot: snapshot(adapterId as AgentSourceAdapterId, { observedAt }),
        },
      ])
    ),
  });

  it('does not let one fast-clock row evict the real rows behind it', () => {
    const rows = file({ claude: WALL + 730 * DAY, codex: WALL - DAY });
    evictObservationRows(rows, { shell: FISH, nowMs: WALL });
    expect(Object.keys(rows.rows)).toContain('codex');
    // The misdated row itself cannot be dated honestly, so it goes.
    expect(Object.keys(rows.rows)).not.toContain('claude');
  });

  it('keeps an ordinary clock skew inside the tolerance', () => {
    const rows = file({
      claude: WALL + RETENTION_ANCHOR_FUTURE_TOLERANCE_MS / 2,
      codex: WALL - DAY,
    });
    expect(evictObservationRows(rows, { shell: FISH, nowMs: WALL })).toBe(0);
  });

  it('remembers a real observation over a row stamped in the future', async () => {
    for (const ahead of [730 * DAY, RETENTION_ANCHOR_FUTURE_TOLERANCE_MS / 2]) {
      await fs.promises.writeFile(
        path.join(directory, 'agent-source-observations.json'),
        JSON.stringify(file({ claude: WALL + ahead }))
      );
      const store = new AgentSourceObservationStore(() => directory, () => WALL);
      await store.remember(
        FISH,
        snapshot('claude', { observedAt: WALL, state: 'not-installed' })
      );
      const remembered = (await store.read(FISH)).get('claude');
      expect(remembered?.observedAt, `ahead=${ahead}`).toBe(WALL);
      expect(remembered?.state).toBe('not-installed');
    }
  });
});
