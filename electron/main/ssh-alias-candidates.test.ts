import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSshAliasCandidates } from './ssh-alias-candidates';

vi.mock('electron', () => ({}));

describe('readSshAliasCandidates', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-ssh-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeConfig(contents: string, name = 'config'): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, contents);
    return file;
  }

  it('reports a missing config as an ordinary empty answer', () => {
    const result = readSshAliasCandidates({
      configPath: path.join(dir, 'absent'),
    });
    expect(result).toEqual({
      aliases: [],
      configPresent: false,
      incompleteIncludes: false,
    });
  });

  it('returns aliases without any connection material', () => {
    const file = writeConfig(
      [
        'Host build-box',
        '  HostName build-box.invalid',
        '  User buildbot',
        '  IdentityFile /invented/key',
        '',
        'Host research-box staging-box',
        '  HostName research.invalid',
      ].join('\n')
    );

    const result = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: dir,
    });
    expect(result.configPresent).toBe(true);
    expect(result.aliases.map(alias => alias.alias)).toEqual([
      'build-box',
      'research-box',
      'staging-box',
    ]);
    expect(result.aliases[0]).toMatchObject({
      hasHostName: true,
      hasUser: true,
      hasIdentityFile: true,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('build-box.invalid');
    expect(serialized).not.toContain('buildbot');
    expect(serialized).not.toContain('/invented/key');
  });

  it('excludes wildcard and negated patterns, which are not connectable', () => {
    const file = writeConfig(
      ['Host *', '  User anyone', '', 'Host !excluded real-box'].join('\n')
    );
    expect(
      readSshAliasCandidates({
        configPath: file,
        sshDir: dir,
        homeDir: dir,
      }).aliases.map(alias => alias.alias)
    ).toEqual(['real-box']);
  });

  it('expands a relative Include against the ssh directory', () => {
    fs.writeFileSync(
      path.join(dir, 'extra'),
      'Host included-box\n  HostName included.invalid\n'
    );

    const file = writeConfig('Include extra\nHost main-box\n');
    const aliases = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: dir,
    }).aliases.map(a => a.alias);
    expect(aliases).toContain('included-box');
    expect(aliases).toContain('main-box');
  });

  it('expands a tilde Include against the home directory', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-home-'));
    fs.writeFileSync(path.join(home, 'shared'), 'Host tilde-box\n');

    const file = writeConfig('Include ~/shared\n');
    const aliases = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: home,
    }).aliases.map(a => a.alias);
    expect(aliases).toEqual(['tilde-box']);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it('expands a globbed Include', () => {
    const includeDir = path.join(dir, 'config.d');
    fs.mkdirSync(includeDir);
    fs.writeFileSync(path.join(includeDir, 'a.conf'), 'Host glob-a\n');
    fs.writeFileSync(path.join(includeDir, 'b.conf'), 'Host glob-b\n');
    fs.writeFileSync(path.join(includeDir, 'skip.txt'), 'Host glob-skip\n');

    const file = writeConfig(`Include ${includeDir}/*.conf\n`);
    const aliases = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: dir,
    }).aliases.map(a => a.alias);
    expect(aliases).toEqual(['glob-a', 'glob-b']);
    expect(aliases).not.toContain('glob-skip');
  });

  it('flags an unreadable Include instead of pretending the list is whole', () => {
    const file = writeConfig(
      `Include ${path.join(dir, 'missing-file')}\nHost present-box\n`
    );
    const result = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: dir,
    });
    expect(result.aliases.map(a => a.alias)).toEqual(['present-box']);
    expect(result.incompleteIncludes).toBe(true);
  });

  it('terminates on a cyclic Include', () => {
    const first = path.join(dir, 'config');
    const second = path.join(dir, 'second');
    fs.writeFileSync(first, `Include ${second}\nHost first-box\n`);
    fs.writeFileSync(second, `Include ${first}\nHost second-box\n`);

    const aliases = readSshAliasCandidates({
      configPath: first,
      sshDir: dir,
      homeDir: dir,
    }).aliases.map(a => a.alias);
    expect(aliases).toEqual(['first-box', 'second-box']);
  });

  it('enumerates without reading the private key it points at', () => {
    // Behavioural rather than spy-based: an unreadable key file would make
    // enumeration fail if it were ever opened, so success is the proof.
    const keyFile = path.join(dir, 'id_invented');
    fs.writeFileSync(keyFile, 'PRIVATE KEY MATERIAL', { mode: 0o000 });
    const file = writeConfig(
      `Host key-box\n  IdentityFile ${keyFile}\n  HostName key.invalid\n`
    );

    const result = readSshAliasCandidates({
      configPath: file,
      sshDir: dir,
      homeDir: dir,
    });

    expect(result.aliases.map(a => a.alias)).toEqual(['key-box']);
    expect(result.aliases[0].hasIdentityFile).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY MATERIAL');
    expect(JSON.stringify(result)).not.toContain(keyFile);

    fs.chmodSync(keyFile, 0o600);
  });
});
