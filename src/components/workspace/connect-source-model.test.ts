/**
 * The Connect flow's product rules, one test each (ENG-010 C2).
 *
 * Every fixture value is invented. No hostname, address, user, or key path in
 * this file belongs to anyone's real infrastructure.
 */

import { describe, expect, it } from 'vitest';
import type { SshHostAlias } from '@exawatt/core';
import {
  CONNECTABLE_ADAPTER_IDS,
  CONNECT_FAILURE_COPY,
  CONNECT_ISSUE_CODES,
  CONNECT_STAGES,
  CONNECT_STAGE_COPY,
  CREDENTIAL_OWNER_LABELS,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_SSH_PORT,
  NOT_REPORTED,
  PLACEMENT_LABELS,
  canGoBack,
  cancelConnectFlow,
  connectFlowReducer,
  connectionFacts,
  credentialOwnerForTransport,
  emptyManualDraft,
  existingSourceIdForAlias,
  initialConnectFlowState,
  isConnectableAdapter,
  mappingRowsFor,
  partitionAgents,
  placementForTransport,
  preselectedAgentIds,
  resolvedDisplayName,
  savedSourceId,
  validateManualDraft,
  validateMappingRows,
  type AgentMappingRow,
  type ConnectAction,
  type ConnectFlowState,
  type DiscoveredAgent,
} from './connect-source-model';

const ALIASES: readonly SshHostAlias[] = [
  {
    alias: 'atlas-box',
    hasHostName: true,
    hasUser: true,
    hasIdentityFile: false,
  },
  {
    alias: 'beacon-box',
    hasHostName: false,
    hasUser: false,
    hasIdentityFile: false,
  },
];

const AGENTS: readonly DiscoveredAgent[] = [
  {
    nativeAgentId: 'agent-alpha',
    displayName: 'social-poster',
    discoveryState: 'configured',
    contextCount: 75,
    hasPrimaryConversation: true,
  },
  {
    nativeAgentId: 'agent-beta',
    displayName: 'Beacon',
    discoveryState: 'configured',
    contextCount: 3,
    hasPrimaryConversation: false,
  },
  {
    nativeAgentId: 'agent-gamma',
    displayName: 'former-helper',
    discoveryState: 'retired',
    contextCount: 12,
    hasPrimaryConversation: false,
  },
];

const FACTS = connectionFacts({
  observed: {
    identity: 'gateway-alpha',
    version: '2.4.0',
    capabilities: ['operator.read'],
    observedAt: 1,
  },
  placement: 'customer-hosted',
  credentialOwner: 'source-owned-ssh',
});

function run(
  actions: readonly ConnectAction[],
  from: ConnectFlowState = initialConnectFlowState()
): ConnectFlowState {
  return actions.reduce(connectFlowReducer, from);
}

const TO_SERVER: readonly ConnectAction[] = [
  { type: 'choose-adapter', adapterId: 'openclaw' },
  {
    type: 'aliases-loaded',
    aliases: ALIASES,
    configPresent: true,
    incompleteIncludes: false,
  },
];

const TO_TESTING: readonly ConnectAction[] = [
  ...TO_SERVER,
  {
    type: 'test-started',
    alias: 'atlas-box',
    sourceId: 'source-1',
    operatorAuthored: false,
  },
];

const TO_AGENTS: readonly ConnectAction[] = [
  ...TO_TESTING,
  { type: 'agents-discovered', agents: AGENTS, facts: FACTS },
];

const TO_MAPPING: readonly ConnectAction[] = [
  ...TO_AGENTS,
  { type: 'to-mapping' },
];

const TO_SAVED: readonly ConnectAction[] = [
  ...TO_MAPPING,
  { type: 'save', knownProjectIds: [] },
];

describe('Connect flow: choosing a source', () => {
  it('opens on the adapter choice with nothing pending', () => {
    const state = initialConnectFlowState();
    expect(state.step.kind).toBe('choose-source');
    expect(state.pendingSourceId).toBeNull();
    expect(savedSourceId(state)).toBeNull();
  });

  it('moves to the server choice once OpenClaw is chosen', () => {
    const state = run([{ type: 'choose-adapter', adapterId: 'openclaw' }]);
    expect(state.step.kind).toBe('choose-server');
    expect(state.adapterId).toBe('openclaw');
    expect(state.issues).toEqual([]);
  });

  it('reports an adapter it cannot carry instead of advancing', () => {
    const state = run([{ type: 'choose-adapter', adapterId: 'claude' }]);
    expect(state.step.kind).toBe('choose-source');
    expect(state.issues.map(issue => issue.code)).toEqual([
      'adapter-not-connectable',
    ]);
  });

  it('names OpenClaw as the connectable adapter', () => {
    expect(CONNECTABLE_ADAPTER_IDS).toEqual(['openclaw']);
    expect(isConnectableAdapter('openclaw')).toBe(true);
    expect(isConnectableAdapter('codex')).toBe(false);
  });
});

describe('Connect flow: choosing a server', () => {
  it('lists the operator aliases without contacting anything', () => {
    const state = run(TO_SERVER);
    if (state.step.kind !== 'choose-server') throw new Error('wrong step');
    expect(state.step.aliases).toEqual(ALIASES);
    expect(state.step.manual).toBe(false);
    expect(state.pendingSourceId).toBeNull();
  });

  it('offers manual entry as the path when no SSH config exists', () => {
    const state = run([
      { type: 'choose-adapter', adapterId: 'openclaw' },
      {
        type: 'aliases-loaded',
        aliases: [],
        configPresent: false,
        incompleteIncludes: false,
      },
    ]);
    if (state.step.kind !== 'choose-server') throw new Error('wrong step');
    expect(state.step.manual).toBe(true);
  });

  it('keeps the operator in manual entry once they ask for it', () => {
    const state = run([
      ...TO_SERVER,
      { type: 'set-manual', manual: true },
      {
        type: 'aliases-loaded',
        aliases: ALIASES,
        configPresent: true,
        incompleteIncludes: false,
      },
    ]);
    if (state.step.kind !== 'choose-server') throw new Error('wrong step');
    expect(state.step.manual).toBe(true);
  });

  it('carries the manual draft defaults', () => {
    const draft = emptyManualDraft();
    expect(draft.port).toBe(DEFAULT_SSH_PORT);
    expect(draft.gatewayPort).toBe(DEFAULT_GATEWAY_PORT);
    expect(validateManualDraft(draft).map(issue => issue.code)).toEqual([
      'server-label-required',
      'server-host-required',
      'server-user-required',
    ]);
  });

  it('reports an unusable port rather than throwing', () => {
    const issues = validateManualDraft({
      ...emptyManualDraft(),
      label: 'Studio box',
      host: 'studio.invalid',
      user: 'operator',
      port: 0,
      gatewayPort: 70_000,
    });
    expect(issues.map(issue => issue.code)).toEqual([
      'server-port-invalid',
      'gateway-port-invalid',
    ]);
  });

  it('derives placement and credential custody from the transport', () => {
    expect(placementForTransport('ssh-alias')).toBe('customer-hosted');
    expect(placementForTransport('local-loopback')).toBe('local');
    expect(credentialOwnerForTransport('ssh-alias')).toBe('source-owned-ssh');
    expect(credentialOwnerForTransport('ssh-manual')).toBe('exawatt-keychain');
  });
});

describe('Connect flow: the bounded test', () => {
  it('starts at the tunnel and advances one named stage at a time', () => {
    let state = run(TO_TESTING);
    if (state.step.kind !== 'testing') throw new Error('wrong step');
    expect(state.step.stage).toBe('tunnel');
    for (const stage of CONNECT_STAGES) {
      state = connectFlowReducer(state, { type: 'test-stage', stage });
      if (state.step.kind !== 'testing') throw new Error('wrong step');
      expect(state.step.stage).toBe(stage);
    }
  });

  it('remembers the record so a retry reuses one server', () => {
    const state = run(TO_TESTING);
    expect(existingSourceIdForAlias(state, 'atlas-box')).toBe('source-1');
    expect(existingSourceIdForAlias(state, 'beacon-box')).toBeNull();
  });

  it('creates no roster Agents when discovery fails', () => {
    const state = run([
      ...TO_TESTING,
      {
        type: 'test-failed',
        failure: 'gateway-down',
        message: 'The Gateway did not answer.',
      },
    ]);
    if (state.step.kind !== 'failed') throw new Error('wrong step');
    expect(state.step.failure).toBe('gateway-down');
    expect(savedSourceId(state)).toBeNull();
  });

  it('retries from the failure without stacking a second server', () => {
    const state = run([
      ...TO_TESTING,
      { type: 'test-failed', failure: 'host-unreachable', message: '' },
      {
        type: 'test-started',
        alias: 'atlas-box',
        sourceId: 'source-1',
        operatorAuthored: false,
      },
    ]);
    expect(state.step.kind).toBe('testing');
    expect(
      state.history.filter(step => step.kind === 'choose-server')
    ).toHaveLength(1);
  });

  it('names every stage and every failure class in operator language', () => {
    for (const stage of CONNECT_STAGES) {
      expect(CONNECT_STAGE_COPY[stage].length).toBeGreaterThan(0);
    }
    expect(CONNECT_FAILURE_COPY['host-unreachable'].headline).toBe(
      'Server unreachable'
    );
    expect(CONNECT_FAILURE_COPY['gateway-down'].headline).toBe(
      'Gateway not responding'
    );
    expect(CONNECT_FAILURE_COPY['auth-rejected'].headline).toBe(
      'Sign-in rejected'
    );
    expect(CONNECT_FAILURE_COPY['approval-required'].headline).toBe(
      'Approval needed'
    );
    expect(CONNECT_FAILURE_COPY.incompatible.headline).toBe(
      'Version not supported'
    );
  });

  it('never suggests remote work changed, in any stage or failure string', () => {
    const strings = [
      ...Object.values(CONNECT_STAGE_COPY),
      ...Object.values(CONNECT_FAILURE_COPY).flatMap(copy => [
        copy.headline,
        copy.nextStep,
      ]),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/stopped|paused|lost/i);
      expect(text).not.toContain('—');
    }
  });
});

describe('Connect flow: the connection facts', () => {
  it('keeps identity, version, placement, credentials, and capabilities apart', () => {
    expect(FACTS.map(fact => fact.id)).toEqual([
      'identity',
      'version',
      'placement',
      'credential',
      'capabilities',
    ]);
    expect(FACTS[2]?.value).toBe(PLACEMENT_LABELS['customer-hosted']);
    expect(FACTS[3]?.value).toBe(CREDENTIAL_OWNER_LABELS['source-owned-ssh']);
    expect(FACTS[4]?.value).toBe('Read');
  });

  it('marks a fact the source did not declare rather than inventing one', () => {
    const facts = connectionFacts({
      observed: null,
      placement: 'customer-hosted',
      credentialOwner: 'exawatt-keychain',
    });
    expect(facts[0]?.value).toBe(NOT_REPORTED);
    expect(facts[1]?.value).toBe(NOT_REPORTED);
    expect(facts[4]?.value).toBe(NOT_REPORTED);
    expect(facts[3]?.value).toBe('Exawatt keychain');
  });
});

describe('Connect flow: choosing Agents', () => {
  it('preselects configured Agents and no others', () => {
    const state = run(TO_AGENTS);
    if (state.step.kind !== 'choose-agents') throw new Error('wrong step');
    expect([...state.step.selected]).toEqual(['agent-alpha', 'agent-beta']);
  });

  it('separates retired identities from the active roster', () => {
    const { configured, retired } = partitionAgents(AGENTS);
    expect(configured.map(agent => agent.nativeAgentId)).toEqual([
      'agent-alpha',
      'agent-beta',
    ]);
    expect(retired.map(agent => agent.nativeAgentId)).toEqual(['agent-gamma']);
    expect([...preselectedAgentIds(AGENTS)]).not.toContain('agent-gamma');
  });

  it('imports a retired Agent only by an explicit act', () => {
    const before = run(TO_AGENTS);
    if (before.step.kind !== 'choose-agents') throw new Error('wrong step');
    expect(before.step.selected.has('agent-gamma')).toBe(false);

    const after = connectFlowReducer(before, {
      type: 'toggle-agent',
      nativeAgentId: 'agent-gamma',
    });
    if (after.step.kind !== 'choose-agents') throw new Error('wrong step');
    expect(after.step.selected.has('agent-gamma')).toBe(true);
  });

  it('does not let a retired Agent ride a later discovery back in', () => {
    const state = run([
      ...TO_AGENTS,
      { type: 'toggle-agent', nativeAgentId: 'agent-gamma' },
      { type: 'back' },
      {
        type: 'test-started',
        alias: 'atlas-box',
        sourceId: 'source-1',
        operatorAuthored: false,
      },
      { type: 'agents-discovered', agents: AGENTS, facts: FACTS },
    ]);
    if (state.step.kind !== 'choose-agents') throw new Error('wrong step');
    expect(state.step.selected.has('agent-gamma')).toBe(false);
  });

  it('ignores a toggle for an Agent the source did not report', () => {
    const before = run(TO_AGENTS);
    const after = connectFlowReducer(before, {
      type: 'toggle-agent',
      nativeAgentId: 'agent-unknown',
    });
    expect(after).toBe(before);
  });

  it('asks for a selection before mapping Projects', () => {
    const state = run([
      ...TO_AGENTS,
      { type: 'toggle-agent', nativeAgentId: 'agent-alpha' },
      { type: 'toggle-agent', nativeAgentId: 'agent-beta' },
      { type: 'to-mapping' },
    ]);
    expect(state.step.kind).toBe('choose-agents');
    expect(state.issues.map(issue => issue.code)).toEqual([
      'selection-required',
    ]);
  });
});

describe('Connect flow: Project mapping', () => {
  it('suggests one renameable Project per imported Agent', () => {
    const state = run(TO_MAPPING);
    if (state.step.kind !== 'map-projects') throw new Error('wrong step');
    expect(state.step.rows).toHaveLength(2);
    expect(state.step.rows.map(row => row.project)).toEqual([
      { kind: 'new-project', name: 'social-poster' },
      { kind: 'new-project', name: 'Beacon' },
    ]);
  });

  it('never turns the server into a Project', () => {
    const rows = mappingRowsFor(AGENTS, new Set(['agent-alpha']));
    const names = rows.map(row =>
      row.project.kind === 'new-project'
        ? row.project.name
        : row.project.projectId
    );
    expect(names).toEqual(['social-poster']);
    expect(names).not.toContain('atlas-box');
  });

  it('places several Agents in one existing Project when asked', () => {
    const state = run([
      ...TO_MAPPING,
      {
        type: 'edit-mapping',
        nativeAgentId: 'agent-alpha',
        patch: {
          project: { kind: 'existing-project', projectId: 'project-1' },
        },
      },
      {
        type: 'edit-mapping',
        nativeAgentId: 'agent-beta',
        patch: {
          project: { kind: 'existing-project', projectId: 'project-1' },
        },
      },
    ]);
    if (state.step.kind !== 'map-projects') throw new Error('wrong step');
    expect(
      state.step.rows.every(
        row =>
          row.project.kind === 'existing-project' &&
          row.project.projectId === 'project-1'
      )
    ).toBe(true);
  });

  it('defaults the display name to the name the source configured', () => {
    const state = run(TO_MAPPING);
    if (state.step.kind !== 'map-projects') throw new Error('wrong step');
    const row = state.step.rows[0] as AgentMappingRow;
    expect(row.nameOverride).toBeNull();
    expect(resolvedDisplayName(row)).toBe('social-poster');
  });

  it('keeps an override the operator typed, and falls back when cleared', () => {
    const withName = run([
      ...TO_MAPPING,
      {
        type: 'edit-mapping',
        nativeAgentId: 'agent-alpha',
        patch: { nameOverride: 'Marcus' },
      },
    ]);
    if (withName.step.kind !== 'map-projects') throw new Error('wrong step');
    expect(resolvedDisplayName(withName.step.rows[0] as AgentMappingRow)).toBe(
      'Marcus'
    );

    const cleared = connectFlowReducer(withName, {
      type: 'edit-mapping',
      nativeAgentId: 'agent-alpha',
      patch: { nameOverride: '' },
    });
    if (cleared.step.kind !== 'map-projects') throw new Error('wrong step');
    const row = cleared.step.rows[0] as AgentMappingRow;
    expect(row.nameOverride).toBeNull();
    expect(resolvedDisplayName(row)).toBe('social-poster');
  });

  it('reports mapping faults instead of throwing them', () => {
    const rows: AgentMappingRow[] = [
      {
        nativeAgentId: 'agent-alpha',
        sourceName: 'social-poster',
        nameOverride: '   ',
        project: { kind: 'new-project', name: '  ' },
        hasPrimaryConversation: true,
      },
      {
        nativeAgentId: 'agent-beta',
        sourceName: 'Beacon',
        nameOverride: 'x'.repeat(200),
        project: { kind: 'existing-project', projectId: 'project-gone' },
        hasPrimaryConversation: false,
      },
    ];
    const issues = validateMappingRows(rows, ['project-1']);
    expect(issues.map(issue => issue.code)).toEqual([
      'agent-name-required',
      'project-name-required',
      'agent-name-too-long',
      'project-unknown',
    ]);
    for (const issue of issues) {
      expect(CONNECT_ISSUE_CODES).toContain(issue.code);
      expect(issue.message).not.toContain('—');
    }
  });

  it('reports a Project name past the length bound', () => {
    const issues = validateMappingRows(
      [
        {
          nativeAgentId: 'agent-alpha',
          sourceName: 'social-poster',
          nameOverride: null,
          project: { kind: 'new-project', name: 'p'.repeat(200) },
          hasPrimaryConversation: true,
        },
      ],
      []
    );
    expect(issues.map(issue => issue.code)).toEqual(['project-name-too-long']);
  });

  it('refuses to save while a mapping fault stands', () => {
    const state = run([
      ...TO_MAPPING,
      {
        type: 'edit-mapping',
        nativeAgentId: 'agent-alpha',
        patch: {
          project: { kind: 'existing-project', projectId: 'project-x' },
        },
      },
      { type: 'save', knownProjectIds: [] },
    ]);
    expect(state.step.kind).toBe('map-projects');
    expect(savedSourceId(state)).toBeNull();
    expect(state.issues.map(issue => issue.code)).toEqual(['project-unknown']);
  });

  it('saves the source and opens the first chosen Agent', () => {
    const state = run(TO_SAVED);
    if (state.step.kind !== 'saved') throw new Error('wrong step');
    expect(state.step.sourceId).toBe('source-1');
    expect(state.step.openAgentId).toBe('agent-alpha');
    expect(savedSourceId(state)).toBe('source-1');
  });
});

describe('Connect flow: going back', () => {
  it('has nothing behind the first step', () => {
    expect(canGoBack(initialConnectFlowState())).toBe(false);
  });

  it('returns from the server choice to the source choice', () => {
    const state = run([...TO_SERVER, { type: 'back' }]);
    expect(state.step.kind).toBe('choose-source');
  });

  it('returns from the test to the server list with the aliases intact', () => {
    const state = run([...TO_TESTING, { type: 'back' }]);
    if (state.step.kind !== 'choose-server') throw new Error('wrong step');
    expect(state.step.aliases).toEqual(ALIASES);
  });

  it('returns from a failure to the server list', () => {
    const state = run([
      ...TO_TESTING,
      { type: 'test-failed', failure: 'auth-rejected', message: '' },
      { type: 'back' },
    ]);
    expect(state.step.kind).toBe('choose-server');
  });

  it('keeps typed server details when the operator steps back', () => {
    const state = run([
      ...TO_SERVER,
      { type: 'set-manual', manual: true },
      { type: 'edit-manual', patch: { label: 'Studio box', user: 'operator' } },
      {
        type: 'test-started',
        alias: 'Studio box',
        sourceId: 'source-2',
        operatorAuthored: true,
      },
      { type: 'back' },
    ]);
    if (state.step.kind !== 'choose-server') throw new Error('wrong step');
    expect(state.step.draft.label).toBe('Studio box');
    expect(state.step.draft.user).toBe('operator');
    expect(state.step.manual).toBe(true);
  });

  it('returns from Project mapping with the Agent selection intact', () => {
    const state = run([
      ...TO_AGENTS,
      { type: 'toggle-agent', nativeAgentId: 'agent-gamma' },
      { type: 'to-mapping' },
      { type: 'back' },
    ]);
    if (state.step.kind !== 'choose-agents') throw new Error('wrong step');
    expect([...state.step.selected].sort()).toEqual([
      'agent-alpha',
      'agent-beta',
      'agent-gamma',
    ]);
  });

  it('never reverses a saved connection', () => {
    const state = run(TO_SAVED);
    expect(canGoBack(state)).toBe(false);
    expect(connectFlowReducer(state, { type: 'back' })).toBe(state);
  });
});

describe('Connect flow: cancelling', () => {
  const steps: readonly {
    name: string;
    actions: readonly ConnectAction[];
    releases: string | null;
  }[] = [
    { name: 'choose-source', actions: [], releases: null },
    { name: 'choose-server', actions: TO_SERVER, releases: null },
    { name: 'testing', actions: TO_TESTING, releases: 'source-1' },
    {
      name: 'failed',
      actions: [
        ...TO_TESTING,
        { type: 'test-failed', failure: 'host-unreachable', message: '' },
      ],
      releases: 'source-1',
    },
    { name: 'choose-agents', actions: TO_AGENTS, releases: 'source-1' },
    { name: 'map-projects', actions: TO_MAPPING, releases: 'source-1' },
  ];

  for (const step of steps) {
    it(`saves no source when the operator leaves at ${step.name}`, () => {
      const state = run(step.actions);
      expect(state.step.kind).toBe(step.name);
      const outcome = cancelConnectFlow(state);
      expect(outcome.savedSource).toBeNull();
      expect(outcome.releaseSourceId).toBe(step.releases);
      expect(
        savedSourceId(connectFlowReducer(state, { type: 'cancel' }))
      ).toBeNull();
    });
  }

  it('returns to the first step so nothing carries into the next attempt', () => {
    const state = connectFlowReducer(run(TO_MAPPING), { type: 'cancel' });
    expect(state).toEqual(initialConnectFlowState());
  });

  it('keeps a server the operator described so they can come back to it', () => {
    const state = run([
      ...TO_SERVER,
      { type: 'set-manual', manual: true },
      { type: 'edit-manual', patch: { label: 'Studio box' } },
    ]);
    expect(cancelConnectFlow(state).retainedDraft?.label).toBe('Studio box');
  });

  it('keeps nothing when the operator only clicked an alias', () => {
    const outcome = cancelConnectFlow(run(TO_TESTING));
    expect(outcome.retainedDraft).toBeNull();
  });

  it('leaves a saved source alone when the dialog closes on the last step', () => {
    const outcome = cancelConnectFlow(run(TO_SAVED));
    expect(outcome.savedSource).toBeNull();
    expect(outcome.releaseSourceId).toBeNull();
  });
});

describe('Connect flow: out of order actions', () => {
  it('ignores a stage report when no test is running', () => {
    const state = run(TO_SERVER);
    expect(
      connectFlowReducer(state, { type: 'test-stage', stage: 'pairing' })
    ).toBe(state);
  });

  it('ignores discovery results when no test is running', () => {
    const state = run(TO_SERVER);
    expect(
      connectFlowReducer(state, {
        type: 'agents-discovered',
        agents: AGENTS,
        facts: FACTS,
      })
    ).toBe(state);
  });

  it('ignores a mapping edit outside the mapping step', () => {
    const state = run(TO_AGENTS);
    expect(
      connectFlowReducer(state, {
        type: 'edit-mapping',
        nativeAgentId: 'agent-alpha',
        patch: { nameOverride: 'Marcus' },
      })
    ).toBe(state);
  });
});
