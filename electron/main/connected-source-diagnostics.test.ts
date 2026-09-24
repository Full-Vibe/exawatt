import { describe, expect, it } from 'vitest';
import {
  createPhaseTracker,
  describeAdd,
  describeAuthorityRequest,
  describeConnect,
  describeMapAgents,
  describeThrown,
  safeSourceId,
} from './connected-source-diagnostics';
import { deriveConnectedSourceId } from './connected-source-store';
import type {
  AddConnectedSourceInput,
  AddConnectedSourceResult,
} from './connected-source-store';
import type {
  ConnectSourceResult,
  ConnectedSourceChange,
  MapAgentsResult,
} from './connected-source-runtime';
import type { AuthorityRequestResult } from './connected-gateway-authority';

/**
 * Every string an operator's infrastructure could put into these results. The
 * contract under test is that none of them survives into a log line, whatever
 * field it arrived in.
 */
const ALIAS = 'sentinel-alias-box';
const HOST = 'sentinel-host.example.invalid';
const NAME = 'Sentinel Display Name';
const AGENT = 'Sentinel Agent Name';
const SENTENCE = 'Sentinel sentence naming sentinel-host.example.invalid';
const SENTINELS = [ALIAS, HOST, NAME, AGENT, SENTENCE, 'sentinel'];

function leaks(fields: unknown): string[] {
  const text = JSON.stringify(fields).toLowerCase();
  return SENTINELS.filter(value => text.includes(value.toLowerCase()));
}

const aliasTransport = {
  kind: 'ssh-alias',
  alias: ALIAS,
  remotePort: 18789,
} as const;
const sourceId = deriveConnectedSourceId(aliasTransport);

const addInput = {
  adapterId: 'openclaw',
  placement: 'customer-hosted',
  displayName: NAME,
  transport: aliasTransport,
  credentialOwner: 'source',
} as unknown as AddConnectedSourceInput;

describe('safeSourceId', () => {
  it('keeps the ids the store mints and nothing else', () => {
    expect(safeSourceId(sourceId)).toBe(sourceId);
    expect(safeSourceId('0b8f3c1e-2d4a-4c6b-9e7f-1a2b3c4d5e6f')).toBe(
      '0b8f3c1e-2d4a-4c6b-9e7f-1a2b3c4d5e6f'
    );
    expect(safeSourceId(ALIAS)).toBe('unrecognised');
    expect(safeSourceId(`source-${'a'.repeat(24)}-${HOST}`)).toBe(
      'unrecognised'
    );
    expect(safeSourceId(undefined)).toBe('unrecognised');
  });
});

describe('connected-source diagnostics carry facts, never infrastructure', () => {
  it('records an add by transport kind and placement', () => {
    const added = describeAdd(addInput, {
      ok: true,
      record: { id: sourceId },
    } as unknown as AddConnectedSourceResult);
    expect(added).toEqual({
      outcome: 'added',
      sourceId,
      transport: 'ssh-alias',
      placement: 'customer-hosted',
    });
    const refused = describeAdd(addInput, {
      ok: false,
      issues: [SENTENCE, SENTENCE],
    });
    expect(refused).toMatchObject({ outcome: 'refused', issueCount: 2 });
    expect(leaks([added, refused])).toEqual([]);
  });

  it('keeps the failure class and outcome of a refused connect, not its sentence', () => {
    const fields = describeConnect({
      ok: false,
      sourceId,
      outcome: 'failed',
      failure: 'auth-rejected',
      message: SENTENCE,
    });
    expect(fields).toEqual({
      sourceId,
      outcome: 'failed',
      failure: 'auth-rejected',
    });
    expect(leaks(fields)).toEqual([]);
  });

  it('counts the Agents a connect discovered without naming one', () => {
    const fields = describeConnect({
      ok: true,
      sourceId,
      agents: [{ displayName: AGENT }, { displayName: AGENT }],
      status: { displayName: NAME, connection: { state: 'live' } },
      observed: { host: HOST },
    } as unknown as ConnectSourceResult);
    expect(fields).toEqual({
      sourceId,
      outcome: 'connected',
      agentCount: 2,
      connection: 'live',
    });
    expect(leaks(fields)).toEqual([]);
  });

  it('records a refused save by issue count, never the issues', () => {
    const refused: MapAgentsResult = { ok: false, issues: [SENTENCE] };
    const fields = describeMapAgents(sourceId, refused);
    expect(fields).toEqual({ sourceId, outcome: 'refused', issueCount: 1 });
    expect(describeMapAgents(sourceId, { ok: true, mapped: 3 })).toEqual({
      sourceId,
      outcome: 'saved',
      mapped: 3,
    });
    expect(leaks(fields)).toEqual([]);
  });

  it('records the authority held after a request, not the operator sentence', () => {
    const result: AuthorityRequestResult = {
      outcome: 'approval-required',
      authority: 'read',
      message: SENTENCE,
    };
    const fields = describeAuthorityRequest(sourceId, result);
    expect(fields).toEqual({
      sourceId,
      outcome: 'approval-required',
      authority: 'read',
    });
    expect(leaks(fields)).toEqual([]);
  });

  it('records how far a one-click approval got, never the request id', () => {
    const fields = describeAuthorityRequest(sourceId, {
      outcome: 'approval-required',
      authority: 'read',
      message: SENTENCE,
      pendingRequestId: '4f1c2a7e-9d3b-4c11-8f00-2b6a1c9e0d42',
      approvalStep: 'approve-refused',
    });
    expect(fields).toEqual({
      sourceId,
      outcome: 'approval-required',
      authority: 'read',
      step: 'approve-refused',
    });
    expect(JSON.stringify(fields)).not.toContain('4f1c2a7e');
  });

  it('records a thrown handler by class name alone', () => {
    const plain = describeThrown(new Error(SENTENCE));
    expect(plain).toEqual({ outcome: 'threw', errorName: 'Error' });
    const shaped = new Error('x');
    shaped.name = `${HOST} Error`;
    expect(describeThrown(shaped)).toEqual({
      outcome: 'threw',
      errorName: 'unknown',
    });
    expect(describeThrown(SENTENCE)).toEqual({
      outcome: 'threw',
      errorName: 'unknown',
    });
    expect(leaks([plain, describeThrown(shaped)])).toEqual([]);
  });
});

describe('phase tracking', () => {
  function change(
    phase: ConnectedSourceChange['phase'],
    state: string,
    failure: string | null = null,
    revision = 1
  ): ConnectedSourceChange {
    return {
      sourceId,
      phase,
      snapshotRevision: revision,
      connection: {
        state,
        failure,
        label: NAME,
        detail: SENTENCE,
      },
    } as unknown as ConnectedSourceChange;
  }

  it('writes one line per transition and none for a routine replacement', () => {
    const tracker = createPhaseTracker();
    const seen = [
      change('opening-tunnel', 'reconnecting'),
      change('connected', 'live', null, 1),
      change('connected', 'live', null, 2),
      change('connected', 'live', null, 3),
      change('idle', 'unavailable', 'host-unreachable', 3),
      change('idle', 'unavailable', 'host-unreachable', 3),
    ].map(entry => tracker.observe(entry));
    expect(seen.map(entry => entry?.phase ?? null)).toEqual([
      'opening-tunnel',
      'connected',
      null,
      null,
      'idle',
      null,
    ]);
    expect(seen[4]).toEqual({
      sourceId,
      phase: 'idle',
      connection: 'unavailable',
      failure: 'host-unreachable',
    });
    expect(leaks(seen)).toEqual([]);
  });

  it('treats a source that was detached and reattached as news', () => {
    const tracker = createPhaseTracker();
    expect(tracker.observe(change('connected', 'live'))).not.toBeNull();
    expect(tracker.observe(change('connected', 'live'))).toBeNull();
    tracker.forget(sourceId);
    expect(tracker.observe(change('connected', 'live'))).not.toBeNull();
  });
});
