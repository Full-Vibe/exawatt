import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedSourceStore,
  type ConnectedSourceStoreDependencies,
} from './connected-source-store';

vi.mock('electron', () => ({}));

/**
 * A stand-in for the OS keychain. `encryptString` deliberately produces bytes
 * that do not contain the plaintext, so a test asserting the token never
 * reaches disk in the clear is testing the store rather than the fake.
 */
function fakeEncryption(available = true) {
  return {
    isAvailable: () => available,
    encryptString: (plain: string) =>
      Buffer.from(`enc:${Buffer.from(plain, 'utf8').toString('hex')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('not decryptable');
      return Buffer.from(text.slice(4), 'hex').toString('utf8');
    },
  };
}

const ALIAS_TRANSPORT = {
  kind: 'ssh-alias' as const,
  alias: 'build-box',
  remotePort: 1337,
};

describe('ConnectedSourceStore', () => {
  let dir: string;
  let deps: ConnectedSourceStoreDependencies;
  let ids: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-sources-'));
    ids = 0;
    deps = {
      userDataDir: dir,
      encryption: fakeEncryption(),
      createId: () => `source-${++ids}`,
      now: () => 1_700_000_000_000,
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function store(overrides: Partial<ConnectedSourceStoreDependencies> = {}) {
    return new ConnectedSourceStore({ ...deps, ...overrides });
  }

  function addOne(target = store()) {
    return target.add({
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Build box',
      transport: ALIAS_TRANSPORT,
      credentialOwner: 'source-owned-ssh',
    });
  }

  it('starts empty and survives a missing file', () => {
    expect(store().list()).toEqual([]);
    expect(store().listViews()).toEqual([]);
  });

  it('adds a source and reads it back from disk', () => {
    const added = addOne();
    expect(added.ok).toBe(true);

    const reopened = store().list();
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({
      id: 'source-1',
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Build box',
      hasDeviceCredential: false,
      createdAt: 1_700_000_000_000,
    });
  });

  it('rejects an invalid source without writing anything', () => {
    const result = store().add({
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Bad',
      // A leading dash would be read by ssh as an option rather than a host.
      transport: {
        kind: 'ssh-alias',
        alias: '-oProxyCommand=id',
        remotePort: 1,
      },
      credentialOwner: 'source-owned-ssh',
    });
    expect(result.ok).toBe(false);
    expect(store().list()).toEqual([]);
  });

  it('drops an unreadable row instead of losing the whole registry', () => {
    const target = store();
    addOne(target);
    const file = path.join(dir, 'connected-sources.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.sources.unshift({ id: 'broken' });
    parsed.sources.push({ nonsense: true });
    fs.writeFileSync(file, JSON.stringify(parsed));

    const records = store().list();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('source-1');
  });

  it('treats a corrupt records file as an empty registry', () => {
    fs.writeFileSync(path.join(dir, 'connected-sources.json'), '{ not json');
    expect(store().list()).toEqual([]);
  });

  it('renames without touching transport or credential state', () => {
    const target = store();
    addOne(target);
    expect(target.rename('source-1', 'Research box')).toBe(true);
    const record = target.get('source-1');
    expect(record?.displayName).toBe('Research box');
    expect(record?.transport).toEqual(ALIAS_TRANSPORT);
    expect(target.rename('missing', 'x')).toBe(false);
  });

  describe('device credential custody', () => {
    it('round-trips a token and flags the record', () => {
      const target = store();
      addOne(target);
      expect(target.writeDeviceToken('source-1', 'device-token-value')).toEqual(
        {
          ok: true,
        }
      );
      expect(target.readDeviceToken('source-1')).toBe('device-token-value');
      expect(target.get('source-1')?.hasDeviceCredential).toBe(true);
    });

    it('never writes the token to disk in the clear', () => {
      const target = store();
      addOne(target);
      target.writeDeviceToken('source-1', 'super-secret-token');

      for (const file of fs.readdirSync(dir)) {
        const contents = fs.readFileSync(path.join(dir, file), 'utf8');
        expect(contents).not.toContain('super-secret-token');
      }
    });

    it('keeps credential material out of the records file entirely', () => {
      const target = store();
      addOne(target);
      target.writeDeviceToken('source-1', 'super-secret-token');

      const records = fs.readFileSync(
        path.join(dir, 'connected-sources.json'),
        'utf8'
      );
      expect(records).not.toContain('super-secret-token');
      expect(records).not.toContain('enc:');
      expect(records).not.toContain('tokens');
    });

    it('fails closed rather than storing a token without OS encryption', () => {
      const target = store({ encryption: fakeEncryption(false) });
      addOne(target);
      expect(target.writeDeviceToken('source-1', 'plain')).toEqual({
        ok: false,
        reason: 'encryption-unavailable',
      });
      expect(
        fs.existsSync(path.join(dir, 'connected-source-secrets.json'))
      ).toBe(false);
      expect(target.get('source-1')?.hasDeviceCredential).toBe(false);
    });

    it('rejects an empty or oversized token', () => {
      const target = store();
      addOne(target);
      expect(target.writeDeviceToken('source-1', '')).toEqual({
        ok: false,
        reason: 'invalid-token',
      });
      expect(target.writeDeviceToken('source-1', 'x'.repeat(16_385))).toEqual({
        ok: false,
        reason: 'invalid-token',
      });
    });

    it('reports absence when stored bytes cannot be decrypted', () => {
      const target = store();
      addOne(target);
      target.writeDeviceToken('source-1', 'device-token-value');
      fs.writeFileSync(
        path.join(dir, 'connected-source-secrets.json'),
        JSON.stringify({ tokens: { 'source-1': 'bm90LWRlY3J5cHRhYmxl' } })
      );
      expect(target.readDeviceToken('source-1')).toBeNull();
    });

    it('clears the token and lowers the flag', () => {
      const target = store();
      addOne(target);
      target.writeDeviceToken('source-1', 'device-token-value');
      target.clearDeviceToken('source-1');
      expect(target.readDeviceToken('source-1')).toBeNull();
      expect(target.get('source-1')?.hasDeviceCredential).toBe(false);
    });
  });

  describe('detach', () => {
    it('removes the record and its credential', () => {
      const target = store();
      addOne(target);
      target.writeDeviceToken('source-1', 'device-token-value');

      expect(target.remove('source-1')).toBe(true);
      expect(target.list()).toEqual([]);
      expect(target.readDeviceToken('source-1')).toBeNull();

      const secrets = fs.readFileSync(
        path.join(dir, 'connected-source-secrets.json'),
        'utf8'
      );
      expect(secrets).not.toContain('source-1');
    });

    it('leaves other sources and their credentials intact', () => {
      const target = store();
      addOne(target);
      target.add({
        adapterId: 'openclaw',
        placement: 'customer-hosted',
        displayName: 'Second box',
        transport: { kind: 'ssh-alias', alias: 'second-box', remotePort: 1337 },
        credentialOwner: 'source-owned-ssh',
      });
      target.writeDeviceToken('source-1', 'first-token');
      target.writeDeviceToken('source-2', 'second-token');

      target.remove('source-1');

      expect(target.list().map(r => r.id)).toEqual(['source-2']);
      expect(target.readDeviceToken('source-2')).toBe('second-token');
    });

    it('reports false for an unknown source', () => {
      expect(store().remove('missing')).toBe(false);
    });
  });

  describe('granted authority', () => {
    it('starts every source read-only', () => {
      const target = store();
      addOne(target);
      expect(target.get('source-1')?.grantedAuthority).toBe('read');
    });

    it('round-trips a granted authority to disk', () => {
      const target = store();
      addOne(target);

      expect(target.setGrantedAuthority('source-1', 'write')).toBe(true);

      // A second store reads the same files, so this is persistence rather
      // than one instance remembering its own call.
      expect(store().get('source-1')?.grantedAuthority).toBe('write');
      expect(store().list()[0].grantedAuthority).toBe('write');
    });

    it('takes authority back again', () => {
      const target = store();
      addOne(target);
      target.setGrantedAuthority('source-1', 'write');

      expect(target.setGrantedAuthority('source-1', 'read')).toBe(true);
      expect(store().get('source-1')?.grantedAuthority).toBe('read');
    });

    it('reports false for an unknown source and writes nothing', () => {
      const target = store();
      addOne(target);

      expect(target.setGrantedAuthority('missing', 'write')).toBe(false);
      expect(store().get('source-1')?.grantedAuthority).toBe('read');
    });

    it('reads a hand-written authority the vocabulary does not contain as read', () => {
      const target = store();
      addOne(target);
      const file = path.join(dir, 'connected-sources.json');
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        sources: Record<string, unknown>[];
      };
      parsed.sources[0].grantedAuthority = 'admin';
      fs.writeFileSync(file, JSON.stringify(parsed));

      // Fail closed without dropping the source: the operator keeps the
      // connection and loses only authority they cannot prove was granted.
      expect(store().list()).toHaveLength(1);
      expect(store().get('source-1')?.grantedAuthority).toBe('read');
    });

    it('survives a record written before authority existed', () => {
      const target = store();
      addOne(target);
      const file = path.join(dir, 'connected-sources.json');
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        sources: Record<string, unknown>[];
      };
      delete parsed.sources[0].grantedAuthority;
      fs.writeFileSync(file, JSON.stringify(parsed));

      expect(store().get('source-1')?.grantedAuthority).toBe('read');
    });

    it('is preserved by the other writers that rewrite the record', () => {
      const target = store();
      addOne(target);
      target.setGrantedAuthority('source-1', 'write');

      target.writeDeviceToken('source-1', 'device-token-value');
      target.rename('source-1', 'Renamed box');

      const record = store().get('source-1');
      expect(record?.grantedAuthority).toBe('write');
      expect(record?.hasDeviceCredential).toBe(true);
      expect(record?.displayName).toBe('Renamed box');
    });

    it('goes away with the source it belonged to', () => {
      const target = store();
      addOne(target);
      target.setGrantedAuthority('source-1', 'write');

      expect(target.remove('source-1')).toBe(true);
      expect(store().get('source-1')).toBeNull();
    });
  });

  it('renderer views carry no connection material', () => {
    const target = store();
    target.add({
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Manual box',
      transport: {
        kind: 'ssh-manual',
        host: 'invented.example',
        user: 'operator',
        port: 22,
        identityFile: '/invented/key/path',
        remotePort: 1337,
      },
      credentialOwner: 'exawatt-keychain',
    });

    const serialized = JSON.stringify(target.listViews());
    expect(serialized).not.toContain('invented.example');
    expect(serialized).not.toContain('operator');
    expect(serialized).not.toContain('/invented/key/path');
    expect(serialized).toContain('Manual box');
  });
});
