import { describe, expect, it } from 'vitest';
import {
  CONNECTION_STALE_AFTER_MS,
  SOURCE_CONNECTION_STATES,
  SOURCE_FAILURE_CLASSES,
  describeConnectionStatus,
  parseConnectedSourceRecord,
  resolveConnectionStatus,
  toConnectedSourceView,
  type ConnectedSourceRecord,
  type ConnectionObservation,
  type SourceFailureClass,
} from '../sources/connected-source';

/*
 * Every technical value below is invented. This package is public, so no test
 * may carry a real hostname, address, account, key path, or server name.
 */
const NOW = 1_800_000_000_000;

const ALIAS_RECORD: ConnectedSourceRecord = {
  id: 'src-alpha',
  adapterId: 'openclaw',
  placement: 'customer-hosted',
  displayName: 'Workshop box',
  transport: { kind: 'ssh-alias', alias: 'workshop-box', remotePort: 18_789 },
  credentialOwner: 'source-owned-ssh',
  hasDeviceCredential: true,
  createdAt: NOW - 86_400_000,
};

const MANUAL_HOST = 'gateway-two.invalid';
const MANUAL_USER = 'invented-operator';
const MANUAL_IDENTITY = '/invented/path/.ssh/invented_key';

const MANUAL_RECORD: ConnectedSourceRecord = {
  id: 'src-beta',
  adapterId: 'openclaw',
  placement: 'customer-hosted',
  displayName: 'Second box',
  transport: {
    kind: 'ssh-manual',
    host: MANUAL_HOST,
    user: MANUAL_USER,
    port: 2_222,
    identityFile: MANUAL_IDENTITY,
    remotePort: 18_790,
  },
  credentialOwner: 'exawatt-keychain',
  hasDeviceCredential: false,
  createdAt: NOW - 3_600_000,
};

const LOOPBACK_RECORD: ConnectedSourceRecord = {
  id: 'src-gamma',
  adapterId: 'demo',
  placement: 'local',
  displayName: 'This machine',
  transport: { kind: 'local-loopback', port: 18_791 },
  credentialOwner: 'exawatt-keychain',
  hasDeviceCredential: false,
  createdAt: NOW,
};

function observation(
  overrides: Partial<ConnectionObservation> = {}
): ConnectionObservation {
  return {
    transportUp: false,
    retrying: false,
    lastObservedAt: null,
    failure: null,
    now: NOW,
    ...overrides,
  };
}

function issuesOf(value: unknown): readonly string[] {
  const result = parseConnectedSourceRecord(value);
  if (result.ok) {
    throw new Error('Expected the record to be rejected, but it parsed.');
  }
  return result.issues;
}

describe('resolveConnectionStatus', () => {
  it('is live when the transport is up and the snapshot is fresh', () => {
    const status = resolveConnectionStatus(
      observation({ transportUp: true, lastObservedAt: NOW - 5_000 })
    );
    expect(status).toEqual({
      state: 'live',
      observationAgeMs: 5_000,
      stalePresentation: false,
      failure: null,
    });
  });

  it('treats an age exactly at the threshold as still live', () => {
    const status = resolveConnectionStatus(
      observation({
        transportUp: true,
        lastObservedAt: NOW - CONNECTION_STALE_AFTER_MS,
      })
    );
    expect(status.state).toBe('live');
    expect(status.observationAgeMs).toBe(CONNECTION_STALE_AFTER_MS);
  });

  it('is stale when the transport is up but the snapshot aged out', () => {
    const status = resolveConnectionStatus(
      observation({
        transportUp: true,
        lastObservedAt: NOW - CONNECTION_STALE_AFTER_MS - 1,
      })
    );
    expect(status).toEqual({
      state: 'stale',
      observationAgeMs: CONNECTION_STALE_AFTER_MS + 1,
      stalePresentation: true,
      failure: null,
    });
  });

  it('is stale when the transport is up but nothing was ever observed', () => {
    const status = resolveConnectionStatus(
      observation({ transportUp: true, lastObservedAt: null })
    );
    expect(status.state).toBe('stale');
    expect(status.observationAgeMs).toBeNull();
    expect(status.stalePresentation).toBe(true);
  });

  it('is reconnecting while retrying and keeps the observation age', () => {
    const status = resolveConnectionStatus(
      observation({ retrying: true, lastObservedAt: NOW - 900_000 })
    );
    expect(status).toEqual({
      state: 'reconnecting',
      observationAgeMs: 900_000,
      stalePresentation: true,
      failure: null,
    });
  });

  it('lets a retry in flight outrank a terminal failure', () => {
    const status = resolveConnectionStatus(
      observation({
        retrying: true,
        failure: 'gateway-down',
        lastObservedAt: NOW - 1_000,
      })
    );
    expect(status.state).toBe('reconnecting');
    expect(status.failure).toBe('gateway-down');
  });

  it('lets an up transport outrank a retry', () => {
    const status = resolveConnectionStatus(
      observation({
        transportUp: true,
        retrying: true,
        failure: 'unknown',
        lastObservedAt: NOW - 1_000,
      })
    );
    expect(status.state).toBe('live');
    expect(status.failure).toBeNull();
  });

  it('is unavailable with the failure passed through when not retrying', () => {
    const status = resolveConnectionStatus(
      observation({ failure: 'auth-rejected', lastObservedAt: NOW - 120_000 })
    );
    expect(status).toEqual({
      state: 'unavailable',
      observationAgeMs: 120_000,
      stalePresentation: true,
      failure: 'auth-rejected',
    });
  });

  it('is unavailable with a null age when the source was never observed', () => {
    const status = resolveConnectionStatus(observation());
    expect(status).toEqual({
      state: 'unavailable',
      observationAgeMs: null,
      stalePresentation: true,
      failure: null,
    });
  });

  it('fails closed to unavailable when the transport is down and unclassified', () => {
    const status = resolveConnectionStatus(
      observation({ lastObservedAt: NOW - 1_000 })
    );
    expect(status.state).toBe('unavailable');
    expect(status.observationAgeMs).toBe(1_000);
    expect(status.failure).toBeNull();
  });

  it('clamps a future observation timestamp to age 0', () => {
    const status = resolveConnectionStatus(
      observation({ transportUp: true, lastObservedAt: NOW + 30_000 })
    );
    expect(status.observationAgeMs).toBe(0);
    expect(status.state).toBe('live');
  });

  it('treats an unusable timestamp as unknown rather than fresh', () => {
    // A future timestamp is a clock adjustment on a connection that really did
    // just report. A negative or non-finite one is not a timestamp at all, and
    // reporting age 0 for it would let corrupted state claim to be current.
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveConnectionStatus(observation({ lastObservedAt: bad }))
          .observationAgeMs
      ).toBeNull();
      expect(
        resolveConnectionStatus(observation({ lastObservedAt: NOW, now: bad }))
          .observationAgeMs
      ).toBeNull();
    }
  });

  it('never reports live on an unusable timestamp, even with the socket up', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const status = resolveConnectionStatus(
        observation({ transportUp: true, lastObservedAt: bad })
      );
      expect(status.state).not.toBe('live');
      expect(status.stalePresentation).toBe(true);
    }
  });

  it('marks every non-live state as unsafe to present as current', () => {
    const byState = new Map(
      [
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW })
        ),
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW - 600_000 })
        ),
        resolveConnectionStatus(observation({ retrying: true })),
        resolveConnectionStatus(observation({ failure: 'incompatible' })),
      ].map(status => [status.state, status] as const)
    );
    expect([...byState.keys()].sort()).toEqual(
      [...SOURCE_CONNECTION_STATES].sort()
    );
    for (const [state, status] of byState) {
      expect(status.stalePresentation).toBe(state !== 'live');
    }
  });
});

describe('describeConnectionStatus', () => {
  it('names the live and reconnecting states plainly', () => {
    expect(
      describeConnectionStatus(
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW })
        )
      )
    ).toBe('Live');
    expect(
      describeConnectionStatus(
        resolveConnectionStatus(observation({ retrying: true }))
      )
    ).toBe('Reconnecting');
  });

  it('reports observation age for a stale connection', () => {
    const stale = (ageMs: number) =>
      describeConnectionStatus(
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW - ageMs })
        )
      );
    expect(stale(90_000)).toBe('Last seen 1 minute ago');
    expect(stale(600_000)).toBe('Last seen 10 minutes ago');
    expect(stale(7_200_000)).toBe('Last seen 2 hours ago');
    expect(stale(259_200_000)).toBe('Last seen 3 days ago');
  });

  it('says only that no snapshot exists when the socket never produced one', () => {
    expect(
      describeConnectionStatus(
        resolveConnectionStatus(observation({ transportUp: true }))
      )
    ).toBe('No snapshot yet');
  });

  it.each([...SOURCE_FAILURE_CLASSES])(
    'describes the %s failure without claiming remote work ended',
    failure => {
      const description = describeConnectionStatus(
        resolveConnectionStatus(
          observation({ failure, lastObservedAt: NOW - 300_000 })
        )
      );
      expect(description.length).toBeGreaterThan(0);
      for (const forbidden of ['stopped', 'paused', 'ended', 'finished']) {
        expect(description.toLowerCase()).not.toContain(forbidden);
      }
      expect(description).not.toContain('—');
    }
  );

  it('never implies remote work ended in any state description', () => {
    const descriptions = [
      describeConnectionStatus(
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW })
        )
      ),
      describeConnectionStatus(
        resolveConnectionStatus(observation({ retrying: true }))
      ),
      describeConnectionStatus(
        resolveConnectionStatus(
          observation({ transportUp: true, lastObservedAt: NOW - 600_000 })
        )
      ),
      describeConnectionStatus(resolveConnectionStatus(observation())),
    ];
    for (const description of descriptions) {
      for (const forbidden of ['stopped', 'paused', 'ended', 'finished']) {
        expect(description.toLowerCase()).not.toContain(forbidden);
      }
      expect(description).not.toContain('—');
    }
  });

  it('maps every failure class to its own operator phrase', () => {
    const phrases = SOURCE_FAILURE_CLASSES.map(failure =>
      describeConnectionStatus({
        state: 'unavailable',
        observationAgeMs: null,
        stalePresentation: true,
        failure: failure as SourceFailureClass,
      })
    );
    expect(phrases).toEqual([
      'Server unreachable',
      'Gateway not responding',
      'Sign-in rejected',
      'Approval needed',
      'Version not supported',
      'Unavailable',
    ]);
  });
});

describe('toConnectedSourceView', () => {
  it('keeps no connection material from a fully populated manual record', () => {
    const view = toConnectedSourceView(MANUAL_RECORD);
    const serialized = JSON.stringify(view);
    for (const secretish of [
      MANUAL_HOST,
      MANUAL_USER,
      MANUAL_IDENTITY,
      '2222',
      '18790',
    ]) {
      expect(serialized).not.toContain(secretish);
    }
    expect(view.alias).toBeNull();
    expect(view.transportKind).toBe('ssh-manual');
  });

  it('exposes exactly the whitelisted fields', () => {
    expect(Object.keys(toConnectedSourceView(MANUAL_RECORD)).sort()).toEqual([
      'adapterId',
      'alias',
      'credentialOwner',
      'displayName',
      'hasDeviceCredential',
      'id',
      'placement',
      'transportKind',
    ]);
  });

  it('carries the operator alias only for an alias transport', () => {
    expect(toConnectedSourceView(ALIAS_RECORD)).toEqual({
      id: 'src-alpha',
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Workshop box',
      transportKind: 'ssh-alias',
      alias: 'workshop-box',
      credentialOwner: 'source-owned-ssh',
      hasDeviceCredential: true,
    });
    expect(JSON.stringify(toConnectedSourceView(ALIAS_RECORD))).not.toContain(
      '18789'
    );
  });

  it('drops the loopback port and reports a null alias', () => {
    const view = toConnectedSourceView(LOOPBACK_RECORD);
    expect(view.alias).toBeNull();
    expect(view.transportKind).toBe('local-loopback');
    expect(JSON.stringify(view)).not.toContain('18791');
  });

  it('does not reflect later mutation of the record transport', () => {
    const view = toConnectedSourceView(ALIAS_RECORD);
    const mutable = { ...ALIAS_RECORD };
    mutable.transport = { kind: 'local-loopback', port: 1 };
    expect(view.alias).toBe('workshop-box');
  });
});

describe('parseConnectedSourceRecord', () => {
  it.each([
    ['ssh-alias', ALIAS_RECORD],
    ['ssh-manual', MANUAL_RECORD],
    ['local-loopback', LOOPBACK_RECORD],
  ])('round-trips a valid %s record', (_kind, record) => {
    const result = parseConnectedSourceRecord(
      JSON.parse(JSON.stringify(record))
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual(record);
  });

  it('accepts a manual record with no identity file', () => {
    const result = parseConnectedSourceRecord({
      ...MANUAL_RECORD,
      transport: { ...MANUAL_RECORD.transport, identityFile: null },
    });
    expect(result.ok).toBe(true);
  });

  it('strips unknown fields instead of passing them through', () => {
    const result = parseConnectedSourceRecord({
      ...ALIAS_RECORD,
      transport: {
        ...ALIAS_RECORD.transport,
        proxyCommand: 'invented-command',
      },
      sshPassword: 'invented-secret',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual(ALIAS_RECORD);
    expect(JSON.stringify(result.record)).not.toContain('invented-secret');
    expect(JSON.stringify(result.record)).not.toContain('invented-command');
  });

  it.each([
    ['leading dash option', '-oProxyCommand=x'],
    ['plain leading dash', '-alias'],
    ['embedded space', 'a b'],
    ['command separator', 'a;b'],
    ['shell substitution', '$(id)'],
    ['path separator', 'box/../other'],
    ['empty', ''],
    ['over length', 'a'.repeat(256)],
  ])('rejects an %s alias', (_label, alias) => {
    const issues = issuesOf({
      ...ALIAS_RECORD,
      transport: { ...ALIAS_RECORD.transport, alias },
    });
    expect(issues.some(issue => issue.startsWith('transport.alias'))).toBe(
      true
    );
  });

  it('rejects a non-record value', () => {
    expect(issuesOf(null)).toHaveLength(1);
    expect(issuesOf([ALIAS_RECORD])).toHaveLength(1);
    expect(issuesOf('src-alpha')).toHaveLength(1);
  });

  it('rejects an unknown transport kind', () => {
    expect(
      issuesOf({
        ...ALIAS_RECORD,
        transport: { kind: 'shell-exec', alias: 'workshop-box' },
      })
    ).toContain('transport.kind: unknown transport kind.');
    expect(issuesOf({ ...ALIAS_RECORD, transport: 'ssh-alias' })).toContain(
      'transport: must be a record.'
    );
  });

  it.each([0, -1, 65_536, 1.5, Number.NaN, '22', null])(
    'rejects the out-of-range port %s',
    port => {
      expect(
        issuesOf({
          ...LOOPBACK_RECORD,
          transport: { kind: 'local-loopback', port },
        }).some(issue => issue.startsWith('transport.port'))
      ).toBe(true);
      expect(
        issuesOf({
          ...ALIAS_RECORD,
          transport: { ...ALIAS_RECORD.transport, remotePort: port },
        }).some(issue => issue.startsWith('transport.remotePort'))
      ).toBe(true);
    }
  );

  it('rejects missing manual host, user, or identity file shape', () => {
    const issues = issuesOf({
      ...MANUAL_RECORD,
      transport: {
        kind: 'ssh-manual',
        host: '   ',
        user: '',
        port: 2_222,
        identityFile: 7,
        remotePort: 18_790,
      },
    });
    expect(issues.some(issue => issue.startsWith('transport.host'))).toBe(true);
    expect(issues.some(issue => issue.startsWith('transport.user'))).toBe(true);
    expect(
      issues.some(issue => issue.startsWith('transport.identityFile'))
    ).toBe(true);
  });

  it('rejects an empty id and an empty display name', () => {
    expect(issuesOf({ ...ALIAS_RECORD, id: '' })).toContain(
      'id: must be a non-empty string of 512 chars or fewer.'
    );
    expect(issuesOf({ ...ALIAS_RECORD, displayName: '  ' })).toContain(
      'displayName: must be a non-empty string of 512 chars or fewer.'
    );
  });

  it('rejects strings over 512 chars', () => {
    const long = 'x'.repeat(513);
    expect(issuesOf({ ...ALIAS_RECORD, id: long })).toHaveLength(1);
    expect(issuesOf({ ...ALIAS_RECORD, displayName: long })).toHaveLength(1);
    expect(
      issuesOf({
        ...MANUAL_RECORD,
        transport: { ...MANUAL_RECORD.transport, host: long },
      }).some(issue => issue.startsWith('transport.host'))
    ).toBe(true);
    expect(
      issuesOf({
        ...MANUAL_RECORD,
        transport: { ...MANUAL_RECORD.transport, identityFile: long },
      }).some(issue => issue.startsWith('transport.identityFile'))
    ).toBe(true);
  });

  it('rejects unknown adapter, placement, and credential owner values', () => {
    expect(
      issuesOf({ ...ALIAS_RECORD, adapterId: 'hosted-openclaw' })
    ).toContain('adapterId: unknown Agent source adapter.');
    expect(issuesOf({ ...ALIAS_RECORD, placement: 'remote' })).toContain(
      'placement: unknown Agent source placement.'
    );
    expect(
      issuesOf({ ...ALIAS_RECORD, credentialOwner: 'shared-secret' })
    ).toContain('credentialOwner: unknown credential owner.');
  });

  it('rejects a non-boolean device credential flag and a bad createdAt', () => {
    expect(
      issuesOf({ ...ALIAS_RECORD, hasDeviceCredential: 'true' })
    ).toContain('hasDeviceCredential: must be a boolean.');
    for (const createdAt of [-1, 1.5, Number.NaN, '0', null]) {
      expect(issuesOf({ ...ALIAS_RECORD, createdAt })).toContain(
        'createdAt: must be a non-negative integer epoch ms.'
      );
    }
  });

  it('reports every fault at once instead of stopping at the first', () => {
    const issues = issuesOf({
      id: '',
      adapterId: 'nope',
      placement: 'nope',
      displayName: '',
      transport: { kind: 'ssh-alias', alias: '-x', remotePort: 0 },
      credentialOwner: 'nope',
      hasDeviceCredential: 1,
      createdAt: -5,
    });
    expect(issues.length).toBeGreaterThanOrEqual(9);
  });
});
