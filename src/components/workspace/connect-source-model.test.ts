/**
 * The Connect flow's product rules, one test each (ENG-010 C2, one screen
 * since ENG-033 H2.4 P2).
 *
 * Every fixture value is invented. No hostname, address, user, or key path in
 * this file belongs to anyone's real infrastructure.
 */

import { describe, expect, it } from 'vitest';
import type { SshHostAlias } from '@exawatt/core';
import {
  CONNECT_FAILURE_COPY,
  CONNECT_STAGES,
  CONNECT_STAGE_COPY,
  CREDENTIAL_OWNER_LABELS,
  DEFAULT_GATEWAY_PORT,
  DEFAULT_SSH_PORT,
  NOT_REPORTED,
  PLACEMENT_LABELS,
  canTestServer,
  cancelConnectFlow,
  connectFlowReducer,
  connectionFacts,
  credentialOwnerForTransport,
  emptyManualDraft,
  initialConnectFlowState,
  mappingRowsFor,
  partitionAgents,
  placementForTransport,
  preselectedAgentIds,
  resolvedDisplayName,
  saveConnectFlow,
  stageForPhase,
  validateManualDraft,
  validateMappingRows,
  visibleServerRows,
  type ConnectAction,
  type ConnectFlowState,
  type DiscoveredAgent,
  type ProjectTarget,
} from './connect-source-model';

function alias(name: string): SshHostAlias {
  return {
    alias: name,
    hasHostName: true,
    hasUser: true,
    hasIdentityFile: false,
  };
}

const ALIASES: readonly SshHostAlias[] = [
  alias('atlas-box'),
  alias('beacon-box'),
  alias('cinder-box'),
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

const REMOTE: ProjectTarget = { kind: 'new-project', name: 'Remote' };

function run(
  actions: readonly ConnectAction[],
  from: ConnectFlowState = initialConnectFlowState()
): ConnectFlowState {
  return actions.reduce(connectFlowReducer, from);
}

const LOADED: readonly ConnectAction[] = [
  {
    type: 'servers-loaded',
    aliases: ALIASES,
    connected: [{ alias: 'cinder-box', agentNames: ['Scout', 'reddit'] }],
    configPresent: true,
    incompleteIncludes: false,
  },
];

function started(name: string, sourceId: string, owned = true): ConnectAction {
  return {
    type: 'test-started',
    alias: name,
    sourceId,
    operatorAuthored: false,
    owned,
  };
}

const TESTING: readonly ConnectAction[] = [
  ...LOADED,
  started('atlas-box', 'source-1'),
];

const READY: readonly ConnectAction[] = [
  ...TESTING,
  { type: 'agents-discovered', agents: AGENTS, facts: FACTS, version: '2.4.0' },
];

function rowOf(state: ConnectFlowState, name: string) {
  return visibleServerRows(state).rows.find(row => row.alias === name);
}

describe('Connect: listing servers', () => {
  it('lists the operator aliases in their order without contacting any', () => {
    const state = run(LOADED);
    expect(visibleServerRows(state).rows.map(row => row.alias)).toEqual([
      'atlas-box',
      'beacon-box',
      'cinder-box',
    ]);
    expect(state.attempt).toBeNull();
  });

  it('names what a connected server already brings, and never tests it again', () => {
    const state = run(LOADED);
    expect(rowOf(state, 'cinder-box')).toMatchObject({
      state: 'connected',
      detail: 'Connected · Scout, reddit',
    });
    expect(canTestServer(state, 'cinder-box')).toBe(false);
    expect(canTestServer(state, 'atlas-box')).toBe(true);
  });

  it('narrows by what the operator types, and counts what it hides', () => {
    const state = run([...LOADED, { type: 'filter', text: 'BEA' }]);
    const { rows, total } = visibleServerRows(state);
    expect(rows.map(row => row.alias)).toEqual(['beacon-box']);
    expect(total).toBe(3);
  });

  it('offers manual entry as the path when no SSH config exists', () => {
    const state = run([
      {
        type: 'servers-loaded',
        aliases: [],
        connected: [],
        configPresent: false,
        incompleteIncludes: false,
      },
    ]);
    expect(state.manual).toBe(true);
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

describe('Connect: testing a server in place', () => {
  it('tests on the row, advancing one named stage at a time', () => {
    let state = run(TESTING);
    expect(rowOf(state, 'atlas-box')).toMatchObject({
      state: 'testing',
      detail: CONNECT_STAGE_COPY.tunnel,
    });
    state = connectFlowReducer(state, { type: 'test-stage', stage: 'pairing' });
    expect(rowOf(state, 'atlas-box')?.detail).toBe(CONNECT_STAGE_COPY.pairing);
  });

  it('starts no second test while one is running', () => {
    const state = run(TESTING);
    expect(canTestServer(state, 'beacon-box')).toBe(false);
    expect(connectFlowReducer(state, started('beacon-box', 'source-2'))).toBe(
      state
    );
  });

  it('reads each stage off the phase the connection is actually in', () => {
    expect(stageForPhase('opening-tunnel')).toBe('tunnel');
    expect(stageForPhase('bootstrapping')).toBe('credential');
    expect(stageForPhase('pairing')).toBe('pairing');
    expect(stageForPhase('discovering')).toBe('discovery');
  });

  it('lets no phase outside the bounded test move the row', () => {
    for (const phase of [
      'idle',
      'connected',
      'reconnecting',
      'failed',
      'something-a-later-gateway-invented',
    ]) {
      expect(stageForPhase(phase)).toBeNull();
    }
  });

  it('keeps a failure on its own row, saying nothing was saved', () => {
    const state = run([
      ...TESTING,
      { type: 'test-stage', stage: 'pairing' },
      {
        type: 'test-failed',
        failure: 'host-unreachable',
        message: 'Nothing answered on the server’s SSH port.',
        released: true,
      },
    ]);
    expect(state.attempt).toBeNull();
    expect(rowOf(state, 'atlas-box')).toMatchObject({
      state: 'failed',
      detail: 'Server unreachable. Nothing was saved.',
      note: 'Nothing answered on the server’s SSH port.',
    });
    expect(state.failures['atlas-box']?.stage).toBe('pairing');
    // The failed server can be tried again, and others can be picked.
    expect(canTestServer(state, 'atlas-box')).toBe(true);
    expect(canTestServer(state, 'beacon-box')).toBe(true);
  });

  it('says so when the failed record could not be released', () => {
    const state = run([
      ...TESTING,
      {
        type: 'test-failed',
        failure: 'gateway-down',
        message: '',
        released: false,
      },
    ]);
    expect(rowOf(state, 'atlas-box')?.detail).toBe(
      'Gateway not responding. It is still saved; remove it in Settings.'
    );
    expect(rowOf(state, 'atlas-box')?.note).toBe(
      CONNECT_FAILURE_COPY['gateway-down'].nextStep
    );
  });

  it('keeps one server failed while another answers', () => {
    const state = run([
      ...TESTING,
      {
        type: 'test-failed',
        failure: 'host-unreachable',
        message: '',
        released: true,
      },
      started('beacon-box', 'source-2'),
      {
        type: 'agents-discovered',
        agents: AGENTS,
        facts: FACTS,
        version: '2.4.0',
      },
    ]);
    expect(rowOf(state, 'atlas-box')?.state).toBe('failed');
    expect(rowOf(state, 'beacon-box')).toMatchObject({
      state: 'ready',
      detail: 'OpenClaw 2.4.0 · 2 Agents',
    });
  });

  it('clears a failure when the same server is tried again', () => {
    const state = run([
      ...TESTING,
      {
        type: 'test-failed',
        failure: 'host-unreachable',
        message: '',
        released: true,
      },
      started('atlas-box', 'source-3'),
    ]);
    expect(state.failures['atlas-box']).toBeUndefined();
    expect(rowOf(state, 'atlas-box')?.state).toBe('testing');
  });

  it('creates no roster Agents when discovery fails', () => {
    const state = run([
      ...TESTING,
      {
        type: 'test-failed',
        failure: 'gateway-down',
        message: '',
        released: true,
      },
    ]);
    expect(saveConnectFlow(state, [], REMOTE)).toEqual({
      ok: false,
      issues: [],
    });
  });

  it('names every stage and every failure class in operator language', () => {
    for (const stage of CONNECT_STAGES) {
      expect(CONNECT_STAGE_COPY[stage].length).toBeGreaterThan(0);
    }
    expect(CONNECT_FAILURE_COPY['host-unreachable'].headline).toBe(
      'Server unreachable'
    );
    expect(CONNECT_FAILURE_COPY['auth-rejected'].headline).toBe(
      'Sign-in rejected'
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

describe('Connect: the connection facts', () => {
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

  it('leaves the version out of the row when the source did not report one', () => {
    const state = run([
      ...TESTING,
      {
        type: 'agents-discovered',
        agents: AGENTS,
        facts: FACTS,
        version: null,
      },
    ]);
    expect(rowOf(state, 'atlas-box')?.detail).toBe('2 Agents');
  });
});

describe('Connect: choosing Agents', () => {
  it('preselects configured Agents and no others', () => {
    const state = run(READY);
    expect(state.attempt?.phase.kind).toBe('ready');
    if (state.attempt?.phase.kind !== 'ready') return;
    expect([...state.attempt.phase.selected]).toEqual([
      'agent-alpha',
      'agent-beta',
    ]);
    expect([...preselectedAgentIds(AGENTS)]).toEqual([
      'agent-alpha',
      'agent-beta',
    ]);
  });

  it('separates retired identities from the active roster', () => {
    const { configured, retired } = partitionAgents(AGENTS);
    expect(configured.map(agent => agent.nativeAgentId)).toEqual([
      'agent-alpha',
      'agent-beta',
    ]);
    expect(retired.map(agent => agent.nativeAgentId)).toEqual(['agent-gamma']);
  });

  it('imports a retired Agent only by an explicit act', () => {
    const state = run([
      ...READY,
      { type: 'toggle-agent', nativeAgentId: 'agent-gamma' },
    ]);
    if (state.attempt?.phase.kind !== 'ready') throw new Error('not ready');
    expect(state.attempt.phase.selected.has('agent-gamma')).toBe(true);
  });

  it('does not let a retired Agent ride a later discovery back in', () => {
    const state = run([
      ...READY,
      { type: 'toggle-agent', nativeAgentId: 'agent-gamma' },
      { type: 'attempt-released' },
      started('atlas-box', 'source-9'),
      {
        type: 'agents-discovered',
        agents: AGENTS,
        facts: FACTS,
        version: '2.4.0',
      },
    ]);
    if (state.attempt?.phase.kind !== 'ready') throw new Error('not ready');
    expect(state.attempt.phase.selected.has('agent-gamma')).toBe(false);
  });

  it('ignores a toggle or rename for an Agent the source did not report', () => {
    const state = run(READY);
    expect(
      connectFlowReducer(state, {
        type: 'toggle-agent',
        nativeAgentId: 'agent-invented',
      })
    ).toBe(state);
    expect(
      connectFlowReducer(state, {
        type: 'rename-agent',
        nativeAgentId: 'agent-invented',
        name: 'Marcus',
      })
    ).toBe(state);
  });

  it('asks for a selection before connecting', () => {
    const state = run([
      ...READY,
      { type: 'toggle-agent', nativeAgentId: 'agent-alpha' },
      { type: 'toggle-agent', nativeAgentId: 'agent-beta' },
    ]);
    const saved = saveConnectFlow(state, [], REMOTE);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.issues.map(entry => entry.code)).toEqual([
      'selection-required',
    ]);
  });
});

describe('Connect: names and one Project for the batch', () => {
  it('puts every chosen Agent into the one Project the batch chose', () => {
    const saved = saveConnectFlow(run(READY), [], REMOTE);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.rows.map(row => row.project)).toEqual([REMOTE, REMOTE]);
    expect(saved.openAgentId).toBe('agent-alpha');
    expect(saved.sourceId).toBe('source-1');
  });

  it('never turns the server into a Project', () => {
    const saved = saveConnectFlow(run(READY), [], REMOTE);
    if (!saved.ok) throw new Error('refused');
    for (const row of saved.rows) {
      expect(row.project).not.toEqual({
        kind: 'new-project',
        name: 'atlas-box',
      });
    }
  });

  it('uses the operator’s choice over the default', () => {
    const chosen: ProjectTarget = {
      kind: 'existing-project',
      projectId: 'project-7',
    };
    const saved = saveConnectFlow(
      run([...READY, { type: 'set-project', project: chosen }]),
      ['project-7'],
      REMOTE
    );
    if (!saved.ok) throw new Error('refused');
    expect(saved.rows.every(row => row.project === chosen)).toBe(true);
  });

  it('defaults the display name to the name the source configured', () => {
    const saved = saveConnectFlow(run(READY), [], REMOTE);
    if (!saved.ok) throw new Error('refused');
    expect(saved.rows[0]?.nameOverride).toBeNull();
    expect(resolvedDisplayName(saved.rows[0]!)).toBe('social-poster');
  });

  it('keeps a name the operator typed in place, and falls back when cleared', () => {
    const named = run([
      ...READY,
      { type: 'rename-agent', nativeAgentId: 'agent-alpha', name: 'Marcus' },
    ]);
    const saved = saveConnectFlow(named, [], REMOTE);
    if (!saved.ok) throw new Error('refused');
    expect(resolvedDisplayName(saved.rows[0]!)).toBe('Marcus');

    const cleared = connectFlowReducer(named, {
      type: 'rename-agent',
      nativeAgentId: 'agent-alpha',
      name: '',
    });
    const again = saveConnectFlow(cleared, [], REMOTE);
    if (!again.ok) throw new Error('refused');
    expect(again.rows[0]?.nameOverride).toBeNull();
    expect(resolvedDisplayName(again.rows[0]!)).toBe('social-poster');
  });

  it('names a Project fault once for the batch, not once per Agent', () => {
    const blank = saveConnectFlow(run(READY), [], {
      kind: 'new-project',
      name: '   ',
    });
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.issues).toEqual([
      {
        code: 'project-name-required',
        nativeAgentId: null,
        message: 'Name the Project.',
      },
    ]);

    const gone = saveConnectFlow(run(READY), [], {
      kind: 'existing-project',
      projectId: 'project-deleted',
    });
    if (gone.ok) throw new Error('accepted a missing Project');
    expect(gone.issues.map(entry => entry.code)).toEqual(['project-unknown']);
  });

  it('refuses to settle while a fault stands, and settles in place when clean', () => {
    const faulted = run([
      ...READY,
      {
        type: 'save',
        knownProjectIds: [],
        project: { kind: 'new-project', name: '' },
      },
    ]);
    expect(faulted.settled).toBe(false);
    expect(faulted.issues.map(entry => entry.code)).toEqual([
      'project-name-required',
    ]);

    const settled = run([
      ...READY,
      { type: 'save', knownProjectIds: [], project: REMOTE },
    ]);
    expect(settled.settled).toBe(true);
    expect(settled.attempt?.phase.kind).toBe('ready');
  });

  it('reports a name fault on its Agent', () => {
    const issues = validateMappingRows(
      mappingRowsFor(
        AGENTS,
        new Set(['agent-alpha']),
        { 'agent-alpha': '   ' },
        REMOTE
      ),
      []
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'agent-name-required',
        nativeAgentId: 'agent-alpha',
      }),
    ]);
  });
});

describe('Connect: leaving', () => {
  it('releases the record this flow created, whatever it was doing', () => {
    expect(cancelConnectFlow(run(TESTING)).releaseSourceId).toBe('source-1');
    expect(cancelConnectFlow(run(READY)).releaseSourceId).toBe('source-1');
  });

  it('never releases a record the flow did not create (BUG-155)', () => {
    const state = run([...LOADED, started('atlas-box', 'source-live', false)]);
    expect(cancelConnectFlow(state).releaseSourceId).toBeNull();
  });

  it('has nothing to release after a failure, which already released it', () => {
    const state = run([
      ...TESTING,
      {
        type: 'test-failed',
        failure: 'host-unreachable',
        message: '',
        released: true,
      },
    ]);
    expect(cancelConnectFlow(state).releaseSourceId).toBeNull();
  });

  it('forgets a released attempt when another server is picked (BUG-157)', () => {
    const state = run([...READY, { type: 'attempt-released' }]);
    expect(state.attempt).toBeNull();
    expect(cancelConnectFlow(state).releaseSourceId).toBeNull();
  });

  it('leaves a connected source alone once it is the operator’s', () => {
    const state = run([
      ...READY,
      { type: 'save', knownProjectIds: [], project: REMOTE },
    ]);
    expect(cancelConnectFlow(state).releaseSourceId).toBeNull();
    expect(connectFlowReducer(state, { type: 'attempt-released' })).toBe(state);
  });

  it('keeps a server the operator described so they can come back to it', () => {
    const state = run([
      ...LOADED,
      { type: 'set-manual', manual: true },
      { type: 'edit-manual', patch: { label: 'Studio box' } },
    ]);
    expect(cancelConnectFlow(state).retainedDraft?.label).toBe('Studio box');
  });

  it('keeps nothing when the operator only picked an alias', () => {
    expect(cancelConnectFlow(run(TESTING)).retainedDraft).toBeNull();
  });

  it('starts clean after leaving', () => {
    expect(connectFlowReducer(run(READY), { type: 'cancel' })).toEqual(
      initialConnectFlowState()
    );
  });
});

describe('Connect: out of order reports', () => {
  it('ignores a stage report when no test is running', () => {
    const state = run(READY);
    expect(
      connectFlowReducer(state, { type: 'test-stage', stage: 'pairing' })
    ).toBe(state);
  });

  it('ignores discovery results when no test is running', () => {
    const state = run(LOADED);
    expect(
      connectFlowReducer(state, {
        type: 'agents-discovered',
        agents: AGENTS,
        facts: FACTS,
        version: null,
      })
    ).toBe(state);
  });

  it('ignores a failure report when no test is running', () => {
    const state = run(READY);
    expect(
      connectFlowReducer(state, {
        type: 'test-failed',
        failure: 'unknown',
        message: '',
        released: true,
      })
    ).toBe(state);
  });
});

describe('Connect: a server described by hand', () => {
  it('stands its test on a row of its own and closes the form once it answers', () => {
    let state = run([
      ...LOADED,
      { type: 'set-manual', manual: true },
      { type: 'edit-manual', patch: { label: 'Studio box' } },
      {
        type: 'test-started',
        alias: 'Studio box',
        sourceId: 'source-m',
        operatorAuthored: true,
        owned: true,
      },
    ]);
    expect(rowOf(state, 'Studio box')?.state).toBe('testing');
    state = connectFlowReducer(state, {
      type: 'agents-discovered',
      agents: AGENTS,
      facts: FACTS,
      version: '2.4.0',
    });
    expect(state.manual).toBe(false);
    expect(rowOf(state, 'Studio box')?.state).toBe('ready');
    expect(cancelConnectFlow(state).retainedDraft?.label).toBe('Studio box');
  });
});
