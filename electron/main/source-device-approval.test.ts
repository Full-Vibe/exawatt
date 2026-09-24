import { describe, expect, it } from 'vitest';
import type { SourceTransport } from '@exawatt/core';
import {
  approveCommandsFor,
  findOwnPendingRequest,
  sshDestinationOf,
} from './source-device-approval';

const SELF = { deviceId: 'd'.repeat(64), publicKey: 'own-public-key' };
const OWN_ID = '4f1c2a7e-9d3b-4c11-8f00-2b6a1c9e0d42';

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: OWN_ID,
    deviceId: SELF.deviceId,
    publicKey: SELF.publicKey,
    scopes: ['operator.read', 'operator.write'],
    role: 'operator',
    roles: ['operator'],
    ts: 1_790_000_000_000,
    ...overrides,
  };
}

function listed(...pending: unknown[]): string {
  return JSON.stringify({ pending, paired: [] });
}

describe('findOwnPendingRequest', () => {
  it('finds the request made by its own device among others', () => {
    const output = listed(
      request({ requestId: 'someone-else', deviceId: 'e'.repeat(64) }),
      request()
    );

    expect(findOwnPendingRequest(output, SELF)).toEqual({
      kind: 'found',
      requestId: OWN_ID,
    });
  });

  it('takes the first of its own, which the source lists newest first', () => {
    const output = listed(
      request({ requestId: 'newest' }),
      request({ requestId: 'older' })
    );

    expect(findOwnPendingRequest(output, SELF)).toEqual({
      kind: 'found',
      requestId: 'newest',
    });
  });

  it('reads a list printed after a notice line', () => {
    const output = `Config warning: plugin disabled\n${listed(request())}\n`;

    expect(findOwnPendingRequest(output, SELF).kind).toBe('found');
  });

  it('says none when the list was read and holds nothing of its own', () => {
    expect(findOwnPendingRequest(listed(), SELF)).toEqual({ kind: 'none' });
    expect(
      findOwnPendingRequest(listed(request({ deviceId: 'e'.repeat(64) })), SELF)
    ).toEqual({ kind: 'none' });
  });

  it('does not take a request with its device id but another public key', () => {
    const output = listed(request({ publicKey: 'someone-elses-key' }));

    expect(findOwnPendingRequest(output, SELF)).toEqual({ kind: 'none' });
  });

  it('says unreadable, never none, for output it cannot read', () => {
    for (const output of [
      '',
      'openclaw: command not found',
      '{"paired": []}',
      '{"pending": "soon"}',
      '[]',
    ]) {
      expect(findOwnPendingRequest(output, SELF)).toEqual({
        kind: 'unreadable',
      });
    }
  });

  it('never approves its own request for more than send access', () => {
    for (const overrides of [
      { scopes: ['operator.read', 'operator.admin'] },
      { scopes: ['operator.pairing'] },
      { scopes: [] },
      { scopes: undefined },
      { role: 'node' },
      { roles: ['operator', 'node'] },
    ]) {
      expect(findOwnPendingRequest(listed(request(overrides)), SELF)).toEqual({
        kind: 'unreadable',
      });
    }
  });

  it('never hands a remote shell a request id outside the id grammar', () => {
    for (const requestId of ['abc; rm -rf ~', '$(id)', 'a b', '', 42]) {
      expect(
        findOwnPendingRequest(listed(request({ requestId })), SELF)
      ).toEqual({ kind: 'unreadable' });
    }
  });
});

const ALIAS_TRANSPORT: SourceTransport = {
  kind: 'ssh-alias',
  alias: 'north-box',
  remotePort: 18789,
};

const MANUAL_TRANSPORT: SourceTransport = {
  kind: 'ssh-manual',
  host: '203.0.113.7',
  user: 'ops',
  port: 2222,
  identityFile: '/Users/operator/My Keys/north',
  remotePort: 18789,
};

describe('approveCommandsFor', () => {
  it('logs in the way Exawatt does, then approves the named request', () => {
    expect(approveCommandsFor(ALIAS_TRANSPORT, OWN_ID)).toEqual([
      'ssh north-box',
      `openclaw devices approve ${OWN_ID}`,
    ]);
    expect(approveCommandsFor(MANUAL_TRANSPORT, OWN_ID)).toEqual([
      "ssh -p 2222 -i '/Users/operator/My Keys/north' ops@203.0.113.7",
      `openclaw devices approve ${OWN_ID}`,
    ]);
  });

  it('lists first when it could not name the request, and never invents one', () => {
    expect(approveCommandsFor(ALIAS_TRANSPORT, null)).toEqual([
      'ssh north-box',
      'openclaw devices list',
      'openclaw devices approve <request id>',
    ]);
  });

  it('leaves out the default port and a missing key', () => {
    expect(
      approveCommandsFor(
        { ...MANUAL_TRANSPORT, port: 22, identityFile: null },
        OWN_ID
      )[0]
    ).toBe('ssh ops@203.0.113.7');
  });

  it('runs on this machine for a local source', () => {
    expect(
      approveCommandsFor({ kind: 'local-loopback', port: 18789 }, OWN_ID)
    ).toEqual([`openclaw devices approve ${OWN_ID}`]);
    expect(sshDestinationOf({ kind: 'local-loopback', port: 18789 })).toBe(
      null
    );
  });
});
