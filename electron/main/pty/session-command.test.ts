import { describe, expect, it } from 'vitest';
import { buildHarnessCommand } from './harness-command';

describe('buildHarnessCommand', () => {
  it('assigns and resumes exact Claude identities in the YOLO default', () => {
    expect(
      buildHarnessCommand(
        'claude',
        '11111111-1111-4111-8111-111111111111',
        false
      )
    ).toBe(
      'claude --dangerously-skip-permissions --session-id 11111111-1111-4111-8111-111111111111'
    );
    expect(
      buildHarnessCommand(
        'claude',
        '11111111-1111-4111-8111-111111111111',
        true
      )
    ).toBe(
      'claude --dangerously-skip-permissions --resume 11111111-1111-4111-8111-111111111111'
    );
  });

  it('resumes an exact Codex identity and never supplies --last', () => {
    const command = buildHarnessCommand(
      'codex',
      '22222222-2222-4222-8222-222222222222',
      true
    );
    expect(command).toBe(
      'codex --dangerously-bypass-approvals-and-sandbox resume 22222222-2222-4222-8222-222222222222'
    );
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
      `'\/tmp\/fixture'"'"'s bin\/codex' --dangerously-bypass-approvals-and-sandbox resume 22222222-2222-4222-8222-222222222222`.replaceAll(
        '\\/',
        '/'
      )
    );
    expect(() =>
      buildHarnessCommand('codex', null, false, 'relative/codex')
    ).toThrow('must be absolute');
  });

  it('quotes an initial task as one positional argument', () => {
    expect(
      buildHarnessCommand(
        'codex',
        null,
        false,
        undefined,
        "Fix the user's tests"
      )
    ).toBe(
      `codex --dangerously-bypass-approvals-and-sandbox 'Fix the user'"'"'s tests'`
    );
    expect(
      buildHarnessCommand(
        'claude',
        '11111111-1111-4111-8111-111111111111',
        false,
        undefined,
        'Review auth'
      )
    ).toBe(
      "claude --dangerously-skip-permissions --session-id 11111111-1111-4111-8111-111111111111 'Review auth'"
    );
  });

  it('translates shared prompt and auto-review policies per harness', () => {
    expect(
      buildHarnessCommand(
        'claude',
        '11111111-1111-4111-8111-111111111111',
        false,
        undefined,
        undefined,
        'prompt'
      )
    ).toBe(
      'claude --permission-mode default --session-id 11111111-1111-4111-8111-111111111111'
    );
    expect(
      buildHarnessCommand('claude', null, false, undefined, undefined, 'auto')
    ).toBe('claude --permission-mode auto');
    expect(
      buildHarnessCommand('codex', null, false, undefined, undefined, 'prompt')
    ).toBe('codex --sandbox workspace-write --ask-for-approval on-request');
    expect(
      buildHarnessCommand(
        'codex',
        '22222222-2222-4222-8222-222222222222',
        true,
        undefined,
        undefined,
        'auto'
      )
    ).toBe(
      `codex --sandbox workspace-write --ask-for-approval on-request -c 'approvals_reviewer="auto_review"' resume 22222222-2222-4222-8222-222222222222`
    );
  });

  it('rejects oversized tasks and tasks on exact resume', () => {
    expect(() =>
      buildHarnessCommand('codex', null, false, undefined, 'x'.repeat(8_001))
    ).toThrow('Initial task is invalid or too long');
    expect(() =>
      buildHarnessCommand(
        'codex',
        '11111111-1111-4111-8111-111111111111',
        true,
        undefined,
        'start over'
      )
    ).toThrow('cannot be supplied when resuming');
    expect(() =>
      buildHarnessCommand(
        'codex',
        null,
        false,
        undefined,
        undefined,
        'invalid' as never
      )
    ).toThrow('Invalid Agent permission mode');
  });
});
