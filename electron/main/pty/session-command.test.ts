import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHarnessCommand } from './harness-command';
import { harnessDescriptor } from './harness-registry';

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

  it('launches and exactly resumes OpenCode through its permission and model seams', () => {
    const wiring = { launchAgentName: 'exawatt-test-launch' };
    const fresh = buildHarnessCommand(
      'opencode',
      null,
      false,
      undefined,
      'Review provider routing',
      'prompt',
      'openrouter/moonshotai/kimi-k3',
      'high',
      wiring
    );
    expect(fresh).toContain('OPENCODE_CONFIG_CONTENT');
    expect(fresh).toContain(
      " opencode --agent 'exawatt-test-launch' --prompt 'Review provider routing'"
    );
    expect(fresh).not.toContain(' --variant ');
    expect(fresh).not.toContain(' -m ');

    const resumed = buildHarnessCommand(
      'opencode',
      'ses_0365acf1bffe15qKmRP05YlcIu',
      true,
      undefined,
      undefined,
      'unrestricted',
      'opencode/big-pickle',
      undefined,
      wiring
    );
    expect(resumed).toContain('OPENCODE_CONFIG_CONTENT');
    expect(resumed).toContain(
      " opencode --agent 'exawatt-test-launch' -s ses_0365acf1bffe15qKmRP05YlcIu"
    );

    const configuration = JSON.parse(
      harnessDescriptor('opencode').launchAgent!.configuration(
        wiring.launchAgentName,
        'prompt',
        'openrouter/moonshotai/kimi-k3',
        'high'
      )
    ) as {
      agent: Record<
        string,
        { model: string; variant: string; permission: Record<string, string> }
      >;
    };
    expect(configuration.agent[wiring.launchAgentName]).toMatchObject({
      model: 'openrouter/moonshotai/kimi-k3',
      variant: 'high',
    });
  });

  it('executes the OpenCode wrapper without replacing user OPENCODE_CONFIG', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'exawatt-opencode-config-')
    );
    const executable = path.join(fixtureRoot, 'opencode');
    fs.writeFileSync(
      executable,
      '#!/bin/sh\nprintf \'%s\\n\' "$OPENCODE_CONFIG" "$OPENCODE_CONFIG_CONTENT" "$@"\n',
      { mode: 0o755 }
    );
    const command = buildHarnessCommand(
      'opencode',
      null,
      false,
      executable,
      'Review config ownership',
      'prompt',
      'fixture/model',
      'high',
      { launchAgentName: 'exawatt-test-config' }
    );

    try {
      const output = execFileSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        env: {
          ...process.env,
          OPENCODE_CONFIG: '/user/config/opencode.json',
          OPENCODE_CONFIG_CONTENT: '',
        },
      }).trimEnd();
      const [configPath, injectedContent, ...args] = output.split('\n');
      expect(configPath).toBe('/user/config/opencode.json');
      expect(JSON.parse(injectedContent)).toHaveProperty(
        'agent.exawatt-test-config'
      );
      expect(args).toEqual([
        '--agent',
        'exawatt-test-config',
        '--prompt',
        'Review config ownership',
      ]);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('preserves non-empty user OPENCODE_CONFIG_CONTENT and refuses execution', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'exawatt-opencode-content-')
    );
    const executable = path.join(fixtureRoot, 'opencode');
    const executionMarker = path.join(fixtureRoot, 'executed');
    fs.writeFileSync(
      executable,
      `#!/bin/sh\nprintf invoked > ${executionMarker}\n`,
      { mode: 0o755 }
    );
    const command = buildHarnessCommand(
      'opencode',
      null,
      false,
      executable,
      undefined,
      'unrestricted',
      undefined,
      undefined,
      { launchAgentName: 'exawatt-test-content' }
    );

    try {
      let refusal: NodeJS.ErrnoException | null = null;
      try {
        execFileSync('/bin/sh', ['-c', command], {
          encoding: 'utf8',
          stdio: 'pipe',
          env: {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: '{"user":"owned"}',
          },
        });
      } catch (error) {
        refusal = error as NodeJS.ErrnoException;
      }
      expect(refusal).not.toBeNull();
      expect(
        (refusal as NodeJS.ErrnoException & { status?: number }).status
      ).toBe(78);
      expect(String((refusal as { stderr?: string }).stderr)).toContain(
        'cannot replace an existing OPENCODE_CONFIG_CONTENT value'
      );
      expect(fs.existsSync(executionMarker)).toBe(false);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('materializes explicit OpenCode permission policies per launch', () => {
    const binding = harnessDescriptor('opencode').launchAgent!;
    const permissions = (mode: 'prompt' | 'auto' | 'unrestricted') => {
      const parsed = JSON.parse(
        binding.configuration('exawatt-test-policy', mode, null, null)
      ) as {
        agent: Record<string, { permission: Record<string, string> }>;
      };
      return parsed.agent['exawatt-test-policy'].permission;
    };
    const prompt = permissions('prompt');
    const auto = permissions('auto');
    const unrestricted = permissions('unrestricted');
    expect(prompt).toMatchObject({
      '*': 'ask',
      read: 'allow',
      question: 'allow',
    });
    expect(auto).toMatchObject({
      '*': 'allow',
      external_directory: 'ask',
      doom_loop: 'ask',
    });
    expect(unrestricted).toMatchObject({ '*': 'allow' });
    expect(Object.keys(prompt)[0]).toBe('*');
    expect(Object.keys(auto)[0]).toBe('*');
    expect(Object.keys(unrestricted)).toEqual(['*']);
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

  it('pins shell-quoted model and effort choices for fresh and resumed Agents', () => {
    expect(
      buildHarnessCommand(
        'codex',
        null,
        false,
        undefined,
        undefined,
        'unrestricted',
        'gpt-5.6-terra',
        'max'
      )
    ).toBe(
      `codex --dangerously-bypass-approvals-and-sandbox --model 'gpt-5.6-terra' -c 'model_reasoning_effort="max"'`
    );
    expect(
      buildHarnessCommand(
        'claude',
        '11111111-1111-4111-8111-111111111111',
        true,
        undefined,
        undefined,
        'prompt',
        'claude-opus-4-7[1m]',
        'xhigh'
      )
    ).toBe(
      "claude --permission-mode default --model 'claude-opus-4-7[1m]' --effort 'xhigh' --resume 11111111-1111-4111-8111-111111111111"
    );
    expect(() =>
      buildHarnessCommand(
        'codex',
        null,
        false,
        undefined,
        undefined,
        'prompt',
        'bad model'
      )
    ).toThrow('Invalid Agent model');
    expect(() =>
      buildHarnessCommand(
        'claude',
        null,
        false,
        undefined,
        undefined,
        'prompt',
        'opus',
        'extra high'
      )
    ).toThrow('Invalid Agent effort');
    expect(
      buildHarnessCommand(
        'claude',
        null,
        false,
        undefined,
        undefined,
        'prompt',
        'opus',
        'auto'
      )
    ).toBe("claude --permission-mode default --model 'opus'");
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

  /** Harness event channel subscription (ENG-023 D1). */
  describe('event channel wiring', () => {
    const settings =
      '/Users/x/Library/Application Support/Exawatt/e/pty-1.json';

    it('subscribes a Claude launch without disturbing the Agent request', () => {
      expect(
        buildHarnessCommand(
          'claude',
          '11111111-1111-4111-8111-111111111111',
          false,
          undefined,
          undefined,
          'unrestricted',
          undefined,
          undefined,
          { eventChannelSettingsPath: settings }
        )
      ).toBe(
        `claude --dangerously-skip-permissions --settings '${settings}' --session-id 11111111-1111-4111-8111-111111111111`
      );
    });

    it('subscribes an exact resume too', () => {
      // A resumed Session delegates exactly like a fresh one, so it must not
      // silently lose its subscription.
      expect(
        buildHarnessCommand(
          'claude',
          '11111111-1111-4111-8111-111111111111',
          true,
          undefined,
          undefined,
          'unrestricted',
          undefined,
          undefined,
          { eventChannelSettingsPath: settings }
        )
      ).toContain(`--settings '${settings}' `);
    });

    it('quotes a path containing spaces or a quote', () => {
      const nasty = "/tmp/a b/it's/pty-1.json";
      const command = buildHarnessCommand(
        'claude',
        null,
        false,
        undefined,
        undefined,
        'unrestricted',
        undefined,
        undefined,
        { eventChannelSettingsPath: nasty }
      );
      expect(command).toContain(`--settings '/tmp/a b/it'"'"'s/pty-1.json'`);
    });

    it('leaves Codex unsubscribed — it reports no delegation', () => {
      const command = buildHarnessCommand(
        'codex',
        null,
        false,
        undefined,
        undefined,
        'unrestricted',
        undefined,
        undefined,
        { eventChannelSettingsPath: settings }
      );
      expect(command).not.toContain('--settings');
    });

    it('launches unchanged when no channel is available', () => {
      expect(buildHarnessCommand('claude', null, false, undefined)).toBe(
        buildHarnessCommand(
          'claude',
          null,
          false,
          undefined,
          undefined,
          'unrestricted',
          undefined,
          undefined,
          {}
        )
      );
    });

    it('rejects a relative settings path', () => {
      expect(() =>
        buildHarnessCommand(
          'claude',
          null,
          false,
          undefined,
          undefined,
          'unrestricted',
          undefined,
          undefined,
          { eventChannelSettingsPath: 'relative/pty-1.json' }
        )
      ).toThrow('must be absolute');
    });
  });
});
