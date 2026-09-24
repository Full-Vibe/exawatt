/**
 * One launch verdict, every surface (decision `0043` §7; BUG-181).
 *
 * The composer once refused a Start that main would have allowed: main's gate
 * held "a remembered negative never refuses" in its own wrapper, while the
 * shared verdict every renderer surface read did not know where a fact came
 * from. Each unit test passed; the disagreement lived between them.
 *
 * So this file runs the REAL main-process gate and every renderer surface
 * that can refuse a launch over the same snapshots, and requires one answer.
 * The matrix is provenance x state x coverage, including the shapes no
 * producer emits today, because a surface that only agrees on today's
 * producers is a second predicate waiting for tomorrow's.
 */
import { describe, expect, it } from 'vitest';
import {
  createAgentLaunchConfiguration,
  launchableAgentSourceState,
  type AgentSourceObservation,
  type AgentSourceProbeName,
  type AgentSourceRegistrySnapshot,
  type AgentSourceSnapshot,
  type AgentSourceState,
} from '@exawatt/core';
import { agentSourceLaunchReadiness } from '../../../electron/main/pty/agent-source-registry';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import { recommendLaunchableAgentSource } from './agent-sources';
import { launchTargetAvailability } from './launch-target-catalog';
import { launcherReadiness } from './launcher/launcher-model';
import { cloneTargetSourceReady } from './session-clone';
import type { AgentModelCatalog } from '@exawatt/core/desktop-bridge';

const NOW = 1_800_000_000_000;
const MODEL = 'fixture-model';

const STATES: readonly AgentSourceState[] = [
  'ready',
  'action-required',
  'not-installed',
  'incompatible',
  'degraded',
  'unavailable',
  'unknown',
];

const PROVENANCE: ReadonlyArray<[string, AgentSourceObservation]> = [
  ['live', { origin: 'live' }],
  [
    'remembered, not yet revalidated',
    { origin: 'remembered', revalidation: null },
  ],
  [
    'remembered, revalidation unanswered',
    {
      origin: 'remembered',
      revalidation: { attemptedAt: NOW, unobservedProbes: ['version'] },
    },
  ],
  ['declared', { origin: 'declared' }],
];

const COVERAGE: ReadonlyArray<[string, readonly AgentSourceProbeName[]]> = [
  ['complete', []],
  ['incomplete', ['version']],
];

function snapshot(
  state: AgentSourceState,
  observation: AgentSourceObservation,
  unobservedProbes: readonly AgentSourceProbeName[]
): AgentSourceSnapshot {
  const fact = {
    basis: 'observed' as const,
    state: 'ready' as const,
    value: 'fixture',
    detail: '',
    provenance: {
      kind: 'source-command' as const,
      label: 'fixture',
      observedAt: NOW,
    },
  };
  return {
    ...agentSourceDeclaration('codex'),
    id: 'codex-local',
    configured: true,
    launchable: launchableAgentSourceState(state),
    state,
    stateLabel: state,
    summary: '',
    observedAt: NOW - 26 * 60 * 60_000,
    observation,
    unobservedProbes,
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
  };
}

function registry(source: AgentSourceSnapshot): AgentSourceRegistrySnapshot {
  return {
    sources: [source],
    available: [],
    comingSoon: [],
    observedAt: source.observedAt,
  };
}

/** A catalog that carries the target's model, so only the source can refuse. */
const catalog = {
  harness: 'codex',
  effectiveModel: MODEL,
  effectiveModelLabel: MODEL,
  effectiveModelSource: 'config',
  effectiveEffort: null,
  effectiveEffortLabel: 'Model default',
  effectiveEffortSource: 'model-default',
  effortLocked: false,
  models: [
    {
      id: MODEL,
      label: MODEL,
      description: '',
      defaultEffort: null,
      efforts: [],
    },
  ],
  catalogMode: 'live-catalog',
  catalogProvenance: 'fixture',
  observedAt: NOW,
  selectionAction: null,
} satisfies AgentModelCatalog;

/** Does each surface refuse this source? `true` means it refuses. */
function refusals(source: AgentSourceSnapshot) {
  const sources = registry(source);
  const readiness = agentSourceLaunchReadiness(sources, 'codex');
  const composer = launcherReadiness({
    preferencesReady: true,
    poolReady: true,
    registry: { snapshot: sources, checking: false, painted: 'live' },
    now: NOW,
  }).facts.find(fact => fact.harness === 'codex');
  const target = createAgentLaunchConfiguration({
    sourceId: 'codex-local',
    modelId: MODEL,
    effort: null,
    labels: { source: 'Codex', model: MODEL },
  });
  const launchSources = sources.sources as Array<
    AgentSourceSnapshot & { harness: 'codex' }
  >;
  const oneClick = recommendLaunchableAgentSource(
    { projectLastUsed: {}, sourceRecency: {}, projectPermissionModes: {} },
    '/repo',
    sources
  );
  return {
    main: readiness.known && readiness.blocked,
    composer: !composer?.available,
    savedSetup: !launchTargetAvailability(target, {
      sources: launchSources,
      catalogs: { codex: catalog },
    }).available,
    clone: !cloneTargetSourceReady(sources, {
      sourceId: 'codex-local',
      source: 'codex',
    }),
    roadmapOneClick: oneClick.kind === 'none',
  };
}

describe('launch verdict parity across main and every renderer surface', () => {
  for (const [provenance, observation] of PROVENANCE) {
    for (const [coverage, unobserved] of COVERAGE) {
      for (const state of STATES) {
        it(`${provenance} · ${coverage} · ${state}`, () => {
          const answers = refusals(snapshot(state, observation, unobserved));
          expect(answers).toEqual({
            main: answers.main,
            composer: answers.main,
            savedSetup: answers.main,
            clone: answers.main,
            roadmapOneClick: answers.main,
          });
        });
      }
    }
  }

  it('refuses only a LIVE, complete negative the source cannot repair by running', () => {
    const refused = (
      state: AgentSourceState,
      observation: AgentSourceObservation
    ) => refusals(snapshot(state, observation, [])).main;
    for (const state of [
      'not-installed',
      'incompatible',
      'degraded',
    ] as const) {
      expect(refused(state, { origin: 'live' }), state).toBe(true);
      expect(
        refused(state, {
          origin: 'remembered',
          revalidation: { attemptedAt: NOW, unobservedProbes: ['version'] },
        }),
        `remembered ${state}`
      ).toBe(false);
    }
    expect(refused('action-required', { origin: 'live' })).toBe(false);
  });
});
