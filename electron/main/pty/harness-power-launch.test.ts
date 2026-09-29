import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarnessPowerLaunch } from './harness-power-launch';
import { shellQuote } from './login-shell';

const candidate = {
  state: 'applied-at-launch' as const,
  mechanism: 'codex-prevent-idle-sleep' as const,
  executable: '/verified/codex',
  version: '0.156.1',
  observedAt: 1,
};
const fish = [
  '/opt/homebrew/bin/fish',
  '/usr/local/bin/fish',
  '/usr/bin/fish',
].find(existsSync);
const request = {
  shell: '/bin/bash',
  sourceExecutable: 'codex',
  candidate,
  controlledCommand: "printf 'controlled'",
  ordinaryCommand: "printf 'ordinary'",
};
const create = () => createHarnessPowerLaunch(request);
function markerFor(
  launch: ReturnType<typeof create>,
  state: 'applied' | 'unknown' = 'applied'
): string {
  const prefix = /777;exawatt-power;[a-f0-9-]+;/.exec(launch.command)?.[0];
  if (!prefix) throw new Error('Launch has no acknowledgment channel');
  return `\x1b]${prefix}${state}\x07`;
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixtureExecutable(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'power launch '));
  temporaryRoots.push(directory);
  const executable = path.join(directory, 'codex');
  writeFileSync(executable, '#!/bin/sh\nprintf "binary:%s" "$*"\n', {
    mode: 0o755,
  });
  return executable;
}

// All subprocesses execute isolated fixtures, never an installed source or task.
function runLaunch(
  shell: string,
  setup: string,
  executable: string,
  explicitExecutable?: string
) {
  const launch = createHarnessPowerLaunch({
    ...request,
    shell,
    candidate: { ...candidate, executable },
    controlledCommand: `${shellQuote(executable)} --disable prevent_idle_sleep --yolo`,
    ordinaryCommand: explicitExecutable
      ? `${shellQuote(explicitExecutable)} --yolo`
      : 'codex --yolo',
    ...(explicitExecutable ? { explicitExecutable } : {}),
  });
  const args = shell.endsWith('/fish')
    ? ['--no-config', '-c']
    : ['--noprofile', '--norc', '-c'];
  const output = execFileSync(shell, [...args, `${setup}\n${launch.command}`], {
    encoding: 'utf8',
  });
  return launch.consume(output);
}

describe('actual-launch power acknowledgment', () => {
  it('remains unknown until its own successful launch branch acknowledges', () => {
    const launch = create();
    expect(launch.initialPowerControl.state).toBe('unknown');
    expect(launch.consume('startup output')).toEqual({
      data: 'startup output',
    });
    expect(launch.consume(markerFor(launch)).powerControl).toMatchObject({
      ...candidate,
      observedAt: expect.any(Number),
    });
  });

  it('handles every marker boundary without losing source output', () => {
    const shape = markerFor(create());
    for (let split = 0; split <= shape.length; split++) {
      const launch = create();
      const marker = markerFor(launch);
      const first = launch.consume(`before${marker.slice(0, split)}`);
      const second = launch.consume(`${marker.slice(split)}after`);
      expect(first.data + second.data + launch.flush()).toBe('beforeafter');
      expect(
        [first, second].filter(result => result.powerControl)
      ).toHaveLength(1);
    }
  });

  it('handles single-character chunks and settles only once', () => {
    const launch = create();
    const input = `before${markerFor(launch)}after${markerFor(launch, 'unknown')}`;
    const results = [...input].map(character => launch.consume(character));
    expect(results.map(result => result.data).join('')).toBe('beforeafter');
    expect(results.flatMap(result => result.powerControl ?? [])).toEqual([
      expect.objectContaining({ state: 'applied-at-launch' }),
    ]);
  });

  it('does not upgrade a fallback after duplicate or conflicting markers', () => {
    const launch = create();
    const result = launch.consume(
      markerFor(launch, 'unknown') + markerFor(launch) + 'visible'
    );
    expect(result.data).toBe('visible');
    expect(result.powerControl?.state).toBe('unknown');
    expect(launch.consume(markerFor(launch))).toEqual({ data: '' });
  });

  it('passes foreign, malformed and ordinary terminal sequences unchanged', () => {
    const launch = create();
    const foreign = markerFor(create());
    const malformed = markerFor(launch).replace('applied', 'unexpected');
    const output = `text\x1b[31mred\x1b[0m${foreign}${malformed}\x1b]0;title\x07`;
    const first = launch.consume(output);
    expect(first).toEqual({ data: output });
    expect(launch.flush()).toBe('');
  });

  it('drops an identified truncated acknowledgement on exit without inventing evidence', () => {
    const launch = create();
    const partial = markerFor(launch).slice(0, -1);
    expect(launch.consume(`source${partial}`)).toEqual({ data: 'source' });
    expect(launch.flush()).toBe('');
    expect(launch.flush()).toBe('');
    expect(launch.consume(markerFor(launch))).toEqual({
      data: markerFor(launch),
    });
  });

  it('preserves an ambiguous ANSI tail on exit', () => {
    const launch = create();
    expect(launch.consume('source\x1b]')).toEqual({ data: 'source' });
    expect(launch.flush()).toBe('\x1b]');
  });

  it('releases failed prefixes immediately instead of retaining arbitrary output', () => {
    const launch = create();
    const partial = markerFor(launch).slice(0, -1);
    expect(launch.consume(partial)).toEqual({ data: '' });
    const output = 'x'.repeat(10_000);
    expect(launch.consume(output)).toEqual({ data: partial + output });
    expect(launch.flush()).toBe('');
  });

  it.each(['/bin/tcsh', '/usr/local/bin/pwsh'])(
    'leaves unsupported shell %s unchanged and unknown',
    shell => {
      const launch = createHarnessPowerLaunch({ ...request, shell });
      expect(launch.command).toBe(request.ordinaryCommand);
      expect(launch.initialPowerControl.state).toBe('unknown');
      expect(launch.consume('\x1b]other')).toEqual({ data: '\x1b]other' });
    }
  );
});

describe('guard in the actual launch shell', () => {
  it('applies control when the actual plain executable still matches', () => {
    const executable = fixtureExecutable();
    const result = runLaunch(
      '/bin/bash',
      `export PATH=${shellQuote(path.dirname(executable))}:$PATH`,
      executable
    );
    expect(result.data).toBe('binary:--disable prevent_idle_sleep --yolo');
    expect(result.powerControl?.state).toBe('applied-at-launch');
  });

  it('preserves a function created by actual startup instead of the probed binary', () => {
    const executable = fixtureExecutable();
    const result = runLaunch(
      '/bin/bash',
      `export PATH=${shellQuote(path.dirname(executable))}:$PATH\nfunction codex() { printf 'wrapper:%s' "$*"; }`,
      executable
    );
    expect(result.data).toBe('wrapper:--yolo');
    expect(result.powerControl?.state).toBe('unknown');
  });

  it('preserves an alias created by actual startup', () => {
    const executable = fixtureExecutable();
    const result = runLaunch(
      '/bin/bash',
      `export PATH=${shellQuote(path.dirname(executable))}:$PATH\nshopt -s expand_aliases\nalias codex="printf 'alias:%s'"`,
      executable
    );
    expect(result.data).toBe('alias:--yolo');
    expect(result.powerControl?.state).toBe('unknown');
  });

  // Fish is optional on developer/CI hosts. The native eval covers the
  // operator's real login shell; this fixture exercises its distinct grammar.
  it.runIf(fish)(
    'preserves Fish functions while controlling a plain file',
    () => {
      const executable = fixtureExecutable();
      const setup = `set -gx PATH ${shellQuote(path.dirname(executable))} $PATH`;
      const plain = runLaunch(fish!, setup, executable);
      expect(plain.data).toBe('binary:--disable prevent_idle_sleep --yolo');
      expect(plain.powerControl?.state).toBe('applied-at-launch');
      const wrapped = runLaunch(
        fish!,
        `${setup}\nfunction codex; printf 'wrapper:%s' "$argv"; end`,
        executable
      );
      expect(wrapped.data).toBe('wrapper:--yolo');
      expect(wrapped.powerControl?.state).toBe('unknown');
    }
  );

  it('preserves the executable selected by a changed actual PATH', () => {
    const probed = fixtureExecutable();
    const actual = fixtureExecutable();
    const result = runLaunch(
      '/bin/bash',
      `export PATH=${shellQuote(path.dirname(actual))}:$PATH`,
      probed
    );
    expect(result.data).toBe('binary:--yolo');
    expect(result.powerControl?.state).toBe('unknown');
  });

  it('only bypasses source resolution for an already selected explicit executable', () => {
    const executable = fixtureExecutable();
    const result = runLaunch(
      '/bin/bash',
      `function codex() { printf 'wrapper'; }`,
      executable,
      executable
    );
    expect(result.data).toBe('binary:--disable prevent_idle_sleep --yolo');
    expect(result.powerControl?.state).toBe('applied-at-launch');
    const mismatch = createHarnessPowerLaunch({
      ...request,
      explicitExecutable: '/another/codex',
    });
    expect(mismatch.command).toBe(request.ordinaryCommand);
    expect(mismatch.initialPowerControl.state).toBe('unknown');
  });
});
