import { describe, expect, it } from 'vitest';
import { buildHarnessCommand } from './harness-command';

describe('buildHarnessCommand', () => {
  it('assigns and resumes exact Claude identities', () => {
    expect(buildHarnessCommand('claude', '11111111-1111-4111-8111-111111111111', false))
      .toBe('claude --session-id 11111111-1111-4111-8111-111111111111');
    expect(buildHarnessCommand('claude', '11111111-1111-4111-8111-111111111111', true))
      .toBe('claude --resume 11111111-1111-4111-8111-111111111111');
  });

  it('resumes an exact Codex identity and never supplies --last', () => {
    const command = buildHarnessCommand(
      'codex',
      '22222222-2222-4222-8222-222222222222',
      true
    );
    expect(command).toBe('codex resume 22222222-2222-4222-8222-222222222222');
    expect(command).not.toContain('--last');
  });

  it('rejects missing or shell-injectable resume identities', () => {
    expect(() => buildHarnessCommand('codex', null, true)).toThrow(
      'Exact session ID required'
    );
    expect(() => buildHarnessCommand('claude', 'bad; rm -rf /', true)).toThrow(
      'Invalid harness session ID'
    );
  });

  it('supports a shell-safe absolute executable for hermetic packaged tests', () => {
    expect(
      buildHarnessCommand(
        'codex',
        '22222222-2222-4222-8222-222222222222',
        true,
        "/tmp/fixture's bin/codex"
      )
    ).toBe(
      `'\/tmp\/fixture'"'"'s bin\/codex' resume 22222222-2222-4222-8222-222222222222`.replaceAll('\\/', '/')
    );
    expect(() =>
      buildHarnessCommand('codex', null, false, 'relative/codex')
    ).toThrow('must be absolute');
  });
});
