import { describe, expect, it } from 'vitest';

import {
  AGENT_NAME_MAX_LENGTH,
  agentNamePrefix,
  allocateAgentName,
  assignAgentNames,
  harnessCarriesAgentName,
  renameAgentName,
  resolveAgentAddress,
  validateAgentName,
  type AgentNameRecord,
  type AgentNameRequest,
} from './agent-name';

const NOW = 1_000;

function request(
  durableSessionId: string,
  harness: string,
  projectKey = '/p/one',
  preferredName?: string
): AgentNameRequest {
  return { durableSessionId, harness, projectKey, preferredName };
}

function names(records: AgentNameRecord[]): Record<string, string> {
  return Object.fromEntries(
    records.map(record => [record.durableSessionId, record.name])
  );
}

describe('allocation', () => {
  it('deals harness plus ordinal, per Project and per harness', () => {
    const { records } = assignAgentNames(
      [],
      [
        request('a', 'claude'),
        request('b', 'codex'),
        request('c', 'claude'),
        request('d', 'antigravity'),
        request('e', 'claude', '/p/two'),
      ],
      NOW
    );
    expect(names(records)).toEqual({
      a: 'claude-1',
      b: 'codex-1',
      c: 'claude-2',
      d: 'gemini-1',
      e: 'claude-1',
    });
    expect(records.every(record => record.origin === 'assigned')).toBe(true);
  });

  it('is stable: a Session that already has a name keeps it on every later read', () => {
    const first = assignAgentNames([], [request('a', 'codex')], NOW);
    const relaunch = assignAgentNames(
      first.records,
      [request('b', 'codex'), request('a', 'codex')],
      NOW + 1
    );
    expect(names(relaunch.records)).toEqual({ a: 'codex-1', b: 'codex-2' });
    const resume = assignAgentNames(
      relaunch.records,
      [request('a', 'codex')],
      NOW + 2
    );
    expect(resume.changed).toBe(false);
    expect(resume.records).toEqual(relaunch.records);
  });

  it('reuses the lowest ordinal once its Session is gone', () => {
    const { records } = assignAgentNames(
      [],
      [request('a', 'claude'), request('b', 'claude')],
      NOW
    );
    const remaining = records.filter(record => record.durableSessionId !== 'a');
    const next = assignAgentNames(remaining, [request('c', 'claude')], NOW);
    expect(names(next.records)).toEqual({ b: 'claude-2', c: 'claude-1' });
  });

  it('never deals a name the operator already gave another Agent', () => {
    const { records } = assignAgentNames([], [request('a', 'claude')], NOW);
    const renamed = renameAgentName(records, 'a', 'claude-2', NOW);
    if (!renamed.ok) throw new Error(renamed.reason);
    const next = assignAgentNames(
      [renamed.record],
      [request('b', 'claude'), request('c', 'claude')],
      NOW
    );
    expect(names(next.records)).toEqual({
      a: 'claude-2',
      b: 'claude-1',
      c: 'claude-3',
    });
  });

  it('is deterministic for a first read of an existing layout', () => {
    const layout = [
      request('a', 'claude'),
      request('b', 'claude', '/p/one', 'Login fix'),
      request('c', 'claude'),
      request('d', 'codex', '/p/one', '   '),
    ];
    const once = assignAgentNames([], layout, NOW);
    const again = assignAgentNames([], layout, NOW);
    expect(once.records).toEqual(again.records);
    expect(names(once.records)).toEqual({
      a: 'claude-1',
      b: 'Login-fix',
      c: 'claude-2',
      d: 'codex-1',
    });
    expect(
      once.records.find(record => record.durableSessionId === 'b')?.origin
    ).toBe('operator');
  });

  it('allocates instead when an older title cannot be a name or is taken', () => {
    const { records } = assignAgentNames(
      [],
      [
        request('a', 'claude', '/p/one', 'x'.repeat(AGENT_NAME_MAX_LENGTH + 1)),
        request('b', 'codex', '/p/one', 'review!'),
        request('c', 'codex', '/p/one', 'Review'),
        request('d', 'codex', '/p/one', 'review'),
      ],
      NOW
    );
    expect(names(records)).toEqual({
      a: 'claude-1',
      b: 'codex-1',
      c: 'Review',
      d: 'codex-2',
    });
  });

  it('keeps a moved Session’s name when it is free in the new Project', () => {
    const first = assignAgentNames(
      [],
      [request('a', 'claude'), request('b', 'claude', '/p/two')],
      NOW
    );
    const moved = assignAgentNames(
      first.records,
      [request('a', 'claude', '/p/three'), request('b', 'claude', '/p/one')],
      NOW
    );
    expect(names(moved.records)).toEqual({ a: 'claude-1', b: 'claude-1' });
    const collides = assignAgentNames(
      moved.records,
      [request('b', 'claude', '/p/three')],
      NOW
    );
    expect(names(collides.records)).toEqual({ a: 'claude-1', b: 'claude-2' });
  });

  it('names no shell', () => {
    expect(harnessCarriesAgentName('shell')).toBe(false);
    const { records, changed } = assignAgentNames(
      [],
      [request('a', 'shell')],
      NOW
    );
    expect(records).toEqual([]);
    expect(changed).toBe(false);
  });

  it('derives a prefix for a harness it has never seen', () => {
    expect(agentNamePrefix('Open Claw')).toBe('open-claw');
    expect(allocateAgentName('openclaw', new Set(['openclaw-1']))).toBe(
      'openclaw-2'
    );
  });
});

describe('rename', () => {
  const base = assignAgentNames(
    [],
    [
      request('a', 'claude'),
      request('b', 'codex'),
      request('c', 'codex', '/p/two'),
    ],
    NOW
  ).records;

  it('accepts a free name, keeps the operator’s case, and marks the origin', () => {
    const result = renameAgentName(base, 'a', '@Code Reviewer', NOW + 5);
    expect(result).toEqual({
      ok: true,
      record: expect.objectContaining({
        name: 'Code-Reviewer',
        origin: 'operator',
        updatedAt: NOW + 5,
      }),
    });
  });

  it('refuses a name another Agent in the Project wears, whatever its case', () => {
    const result = renameAgentName(base, 'a', 'CODEX-1', NOW);
    expect(result).toMatchObject({ ok: false, code: 'taken' });
    if (!result.ok) expect(result.reason).toContain('CODEX-1');
  });

  it('allows a name worn in another Project, and its own name in a new case', () => {
    expect(renameAgentName(base, 'b', 'codex-1', NOW).ok).toBe(true);
    expect(renameAgentName(base, 'b', 'Codex-1', NOW).ok).toBe(true);
    expect(renameAgentName(base, 'a', 'codex-1', NOW).ok).toBe(false);
    expect(renameAgentName(base, 'c', 'claude-1', NOW).ok).toBe(true);
  });

  it('refuses what is not a name, with the reason', () => {
    expect(validateAgentName('')).toMatchObject({ ok: false, code: 'empty' });
    expect(validateAgentName('-lead')).toMatchObject({
      ok: false,
      code: 'characters',
    });
    expect(validateAgentName('a/b')).toMatchObject({
      ok: false,
      code: 'characters',
    });
    expect(validateAgentName('Operator')).toMatchObject({
      ok: false,
      code: 'reserved',
    });
    expect(validateAgentName('x'.repeat(AGENT_NAME_MAX_LENGTH))).toEqual({
      ok: true,
      name: 'x'.repeat(AGENT_NAME_MAX_LENGTH),
    });
    expect(validateAgentName('Zoë_2')).toEqual({ ok: true, name: 'Zoë_2' });
    expect(renameAgentName(base, 'missing', 'x', NOW)).toMatchObject({
      ok: false,
      code: 'unknown',
    });
  });
});

describe('resolveAgentAddress', () => {
  const directory = [
    {
      durableSessionId: 's1',
      projectKey: 'p',
      harness: 'claude',
      name: 'claude-1',
    },
    {
      durableSessionId: 's2',
      projectKey: 'p',
      harness: 'codex',
      name: 'codex-1',
    },
    {
      durableSessionId: 's3',
      projectKey: 'p',
      harness: 'codex',
      name: 'reviewer',
    },
    {
      durableSessionId: 's4',
      projectKey: 'q',
      harness: 'antigravity',
      name: 'gemini-1',
    },
    {
      durableSessionId: 's5',
      projectKey: 'p',
      harness: 'openclaw',
      name: 'Wren',
    },
    {
      durableSessionId: 's6',
      projectKey: 'p',
      harness: 'openclaw',
      name: 'wren',
    },
  ];

  it('resolves an exact name, with or without the sigil and case', () => {
    expect(resolveAgentAddress(directory, 'p', '@codex-1')).toMatchObject({
      kind: 'agent',
      agent: { durableSessionId: 's2' },
    });
    expect(resolveAgentAddress(directory, 'p', 'REVIEWER')).toMatchObject({
      kind: 'agent',
      agent: { durableSessionId: 's3' },
    });
  });

  it('resolves a Session id within the Project only', () => {
    expect(resolveAgentAddress(directory, 'p', 's1')).toMatchObject({
      kind: 'agent',
    });
    expect(resolveAgentAddress(directory, 'p', 's4')).toMatchObject({
      kind: 'none',
      elsewhere: [{ durableSessionId: 's4' }],
    });
  });

  it('lists candidates when a harness name or a source-owned name is shared', () => {
    const family = resolveAgentAddress(directory, 'p', '@codex');
    expect(family).toMatchObject({ kind: 'ambiguous' });
    if (family.kind === 'ambiguous') {
      expect(family.candidates.map(entry => entry.name)).toEqual([
        'codex-1',
        'reviewer',
      ]);
      expect(family.reason).toContain('codex-1, reviewer');
    }
    expect(resolveAgentAddress(directory, 'p', '@wren')).toMatchObject({
      kind: 'ambiguous',
      candidates: [{ durableSessionId: 's5' }, { durableSessionId: 's6' }],
    });
    expect(resolveAgentAddress(directory, 'p', '@claude')).toMatchObject({
      kind: 'agent',
      agent: { durableSessionId: 's1' },
    });
  });

  it('fails a name that lives only in another Project, naming where', () => {
    const result = resolveAgentAddress(directory, 'p', '@gemini-1');
    expect(result).toMatchObject({
      kind: 'none',
      elsewhere: [{ durableSessionId: 's4' }],
    });
    expect(resolveAgentAddress(directory, 'p', '@gemini')).toMatchObject({
      kind: 'none',
      elsewhere: [],
    });
    expect(resolveAgentAddress(directory, 'p', '  ')).toMatchObject({
      kind: 'none',
    });
  });
});
