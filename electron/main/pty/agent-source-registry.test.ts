import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  agentSourceLaunchReadiness,
  probeOutcome,
  localSourceState,
  openClawSourceState,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  parseOpenClawGatewayStatus,
  parseOpencodeAuthStatus,
  parseOpencodeVersion,
  parseGrokVersion,
  inspectOpencodeLaunchEnvironment,
  sourceOwnedActionCommand,
} from './agent-source-registry';
import { configureLoginShellScratchDir } from './login-shell';
import type {
  AgentSourceProbeName,
  AgentSourceRegistrySnapshot,
  AgentSourceState,
} from '@exawatt/core';

/** A launch-scope registry carrying one non-launchable Claude Code source. */
function claudeSnapshot(source: {
  state: AgentSourceState;
  stateLabel: string;
  unobservedProbes?: readonly AgentSourceProbeName[];
}): AgentSourceRegistrySnapshot {
  return {
    sources: [
      {
        harness: 'claude',
        label: 'Claude Code',
        launchable: false,
        unobservedProbes: [],
        ...source,
      },
    ],
  } as unknown as AgentSourceRegistrySnapshot;
}

describe('Agent Source registry truth', () => {
  const originalOpencodeConfigContent = process.env.OPENCODE_CONFIG_CONTENT;
  const originalExpectedOpencodeCwd = process.env.EXAWATT_TEST_OPENCODE_CWD;

  afterEach(() => {
    if (originalOpencodeConfigContent === undefined) {
      delete process.env.OPENCODE_CONFIG_CONTENT;
    } else {
      process.env.OPENCODE_CONFIG_CONTENT = originalOpencodeConfigContent;
    }
    if (originalExpectedOpencodeCwd === undefined) {
      delete process.env.EXAWATT_TEST_OPENCODE_CWD;
    } else {
      process.env.EXAWATT_TEST_OPENCODE_CWD = originalExpectedOpencodeCwd;
    }
  });

  it('keeps local installation, authentication, and degraded states distinct', () => {
    expect(
      localSourceState({
        installationObserved: true,
        executable: false,
        version: 'unanswered',
        authKnown: false,
        authenticated: false,
      })
    ).toBe('not-installed');
    expect(
      localSourceState({
        installationObserved: true,
        executable: true,
        version: 'responded',
        authKnown: true,
        authenticated: false,
      })
    ).toBe('action-required');
    expect(
      localSourceState({
        installationObserved: true,
        executable: true,
        version: 'failed',
        authKnown: true,
        authenticated: true,
      })
    ).toBe('degraded');
    expect(
      localSourceState({
        installationObserved: true,
        executable: true,
        version: 'responded',
        authKnown: false,
        authenticated: false,
      })
    ).toBe('unknown');
    expect(
      localSourceState({
        installationObserved: true,
        executable: true,
        version: 'responded',
        authKnown: true,
        authenticated: true,
      })
    ).toBe('ready');
  });

  it('separates a probe that answered no from one that never answered', () => {
    // BUG-063. `degraded` is a claim about Claude Code; `unknown` is a fact
    // about how far Exawatt got. A version command killed by its deadline
    // used to produce the first.
    expect(
      localSourceState({
        installationObserved: true,
        executable: true,
        version: 'unanswered',
        authKnown: true,
        authenticated: true,
      })
    ).toBe('unknown');
    // The deepest case: a PATH lookup that never came back is not evidence
    // that nothing is installed.
    expect(
      localSourceState({
        installationObserved: false,
        executable: false,
        version: 'unanswered',
        authKnown: false,
        authenticated: false,
      })
    ).toBe('unknown');
  });

  it('reads a killed command as unanswered and a nonzero exit as evidence', () => {
    expect(
      probeOutcome({ answered: true, ok: true, stdout: '', stderr: '' })
    ).toBe('responded');
    expect(
      probeOutcome({ answered: true, ok: false, stdout: '', stderr: '' })
    ).toBe('failed');
    expect(
      probeOutcome({ answered: false, ok: false, stdout: '', stderr: '' })
    ).toBe('unanswered');
  });

  it('keeps an unreachable configured gateway distinct from missing setup', () => {
    expect(
      openClawSourceState({
        installationObserved: true,
        executable: true,
        configured: false,
        protocolObserved: true,
        protocolReady: false,
      })
    ).toBe('action-required');
    expect(
      openClawSourceState({
        installationObserved: true,
        executable: true,
        configured: true,
        protocolObserved: true,
        protocolReady: false,
      })
    ).toBe('degraded');
    expect(
      openClawSourceState({
        installationObserved: true,
        executable: true,
        configured: true,
        protocolObserved: true,
        protocolReady: true,
      })
    ).toBe('ready');
    // A gateway status that never came back says nothing about the gateway.
    expect(
      openClawSourceState({
        installationObserved: true,
        executable: true,
        configured: true,
        protocolObserved: false,
        protocolReady: false,
      })
    ).toBe('unknown');
  });

  it('requires successful OpenClaw protocol status instead of trusting JSON or a port', () => {
    expect(
      parseOpenClawGatewayStatus(
        JSON.stringify({
          ok: true,
          degraded: false,
          capability: 'full',
          targets: [
            {
              connect: { ok: true, rpcOk: true },
              self: { host: 'studio-gateway', version: '2026.6.11' },
            },
          ],
        }),
        true
      )
    ).toMatchObject({
      protocolReady: true,
      identity: 'studio-gateway',
      capability: 'full',
      version: '2026.6.11',
    });
    expect(
      parseOpenClawGatewayStatus(JSON.stringify({ ok: true }), false)
        .protocolReady
    ).toBe(false);
    expect(
      parseOpenClawGatewayStatus(JSON.stringify({}), true).protocolReady
    ).toBe(false);
    expect(
      parseOpenClawGatewayStatus(
        JSON.stringify({
          rpc: {
            ok: true,
            capability: 'operator',
            server: { version: '2026.6.11' },
          },
        }),
        true
      )
    ).toMatchObject({
      protocolReady: true,
      capability: 'operator',
      version: '2026.6.11',
    });
  });

  it('returns only the minimum Claude identity and never forwards org metadata', () => {
    const parsed = parseClaudeAuthStatus(
      JSON.stringify({
        loggedIn: true,
        email: 'operator@example.com',
        subscriptionType: 'max',
        orgId: 'must-not-cross-ipc',
        apiKey: 'must-not-cross-ipc',
      })
    );
    expect(parsed).toEqual({
      authenticated: true,
      identity: 'operator@example.com',
      detail: 'Signed in through Claude Code · max plan',
    });
    expect(JSON.stringify(parsed)).not.toContain('must-not-cross-ipc');
  });

  it('recognizes Codex signed-in and signed-out status without guessing other failures', () => {
    expect(parseCodexAuthStatus('Logged in using ChatGPT', true)).toEqual({
      authenticated: true,
      identity: 'ChatGPT',
    });
    expect(parseCodexAuthStatus('Not logged in', false)).toEqual({
      authenticated: false,
      identity: 'Not signed in',
    });
    expect(parseCodexAuthStatus('transport failed', false)).toBeNull();
  });

  it('treats OpenCode credential presence and validity as different facts', () => {
    expect(parseOpencodeAuthStatus('└  0 credentials', true)).toEqual({
      credentialCount: 0,
    });
    expect(
      parseOpencodeAuthStatus('\u001b[0m└  3 credentials\u001b[0m', true)
    ).toEqual({ credentialCount: 3 });
    expect(parseOpencodeAuthStatus('└  1 credential', false)).toBeNull();
    expect(parseOpencodeVersion('1.3.4')).toEqual({
      version: '1.3.4',
      compatible: true,
    });
    expect(parseOpencodeVersion('1.2.99')?.compatible).toBe(false);
    expect(parseOpencodeVersion('2.0.0')?.compatible).toBe(true);
    expect(parseOpencodeVersion('OpenCode current')).toBeNull();
    expect(parseOpencodeVersion('\n1.3.4')).toEqual({
      version: '1.3.4',
      compatible: true,
    });
  });

  it('matches the launch wrapper non-empty OpenCode config seam predicate', async () => {
    delete process.env.OPENCODE_CONFIG_CONTENT;
    await expect(
      inspectOpencodeLaunchEnvironment('/bin/sh', process.cwd())
    ).resolves.toBe('free');

    process.env.OPENCODE_CONFIG_CONTENT = '';
    await expect(
      inspectOpencodeLaunchEnvironment('/bin/sh', process.cwd())
    ).resolves.toBe('free');

    process.env.OPENCODE_CONFIG_CONTENT = '{}';
    await expect(
      inspectOpencodeLaunchEnvironment('/bin/sh', process.cwd())
    ).resolves.toBe('occupied');
  });

  it('runs the OpenCode config seam probe in the workspace, but its shell startup outside it', async () => {
    // Incident `0006`: a shell runs its startup files in the directory it was
    // SPAWNED in. The probe still has to observe the workspace's environment —
    // that is the whole point of the seam predicate — but the operator's
    // startup code must not execute inside his repository, because anything it
    // writes lands there.
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'exawatt-opencode-preflight-')
    );
    const workspace = path.join(fixtureRoot, 'workspace');
    const scratch = path.join(fixtureRoot, 'scratch');
    const shell = path.join(fixtureRoot, 'dirty-shell.sh');
    const checkCwd = path.join(fixtureRoot, 'check-cwd.sh');
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      checkCwd,
      '#!/bin/sh\n[ "$(pwd -P)" = "$EXAWATT_TEST_OPENCODE_CWD" ] || exit 91\n',
      { mode: 0o755 }
    );
    // `: > ./-l` stands in for the malformed OpenClaw fish completion, which
    // redirects to `./-l` while the shell is reading its configuration.
    fs.writeFileSync(
      shell,
      `#!/bin/sh\n: > ./-l\nexec /bin/sh -c "$3\n${checkCwd}"\n`,
      { mode: 0o755 }
    );
    process.env.EXAWATT_TEST_OPENCODE_CWD = fs.realpathSync(workspace);
    delete process.env.OPENCODE_CONFIG_CONTENT;
    configureLoginShellScratchDir(scratch);

    try {
      // 'free' only comes back if the predicate ran AND the cwd check passed.
      await expect(
        inspectOpencodeLaunchEnvironment(shell, workspace)
      ).resolves.toBe('free');
      expect(fs.readdirSync(workspace)).toEqual([]);
      expect(fs.readdirSync(scratch)).toEqual(['-l']);
    } finally {
      configureLoginShellScratchDir(
        path.join(os.tmpdir(), 'exawatt-shell-startup')
      );
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('uses fixed source-owned commands for auth and catalog selection', () => {
    expect(sourceOwnedActionCommand('claude', 'authenticate')).toBe(
      "'claude' 'auth' 'login'"
    );
    expect(sourceOwnedActionCommand('codex', 'authenticate')).toBe(
      "'codex' 'login'"
    );
    expect(sourceOwnedActionCommand('opencode', 'authenticate')).toBe(
      "'opencode' 'auth' 'login'"
    );
    expect(sourceOwnedActionCommand('claude', 'choose-model')).toBe("'claude'");
  });

  it('turns source observations into actionable main-process launch errors', () => {
    const snapshot = claudeSnapshot({
      state: 'action-required',
      stateLabel: 'Action required',
    });
    const blocked = agentSourceLaunchReadiness(snapshot, 'claude');
    expect(blocked).toMatchObject({ known: true, blocked: true });
    expect(blocked.known && blocked.blocked && blocked.message).toContain(
      'requires sign-in'
    );
    expect(
      agentSourceLaunchReadiness(
        {
          ...snapshot,
          sources: [{ ...snapshot.sources[0], launchable: true }],
        },
        'claude'
      )
    ).toEqual({ known: true, blocked: false });
  });

  // BUG-063, fifth in the BUG-001 / 008 / 009 / 026 family. The operator saw
  // "Claude Code launch readiness could not be verified (degraded). Recheck
  // Settings → Agent Sources." on the first Resume after an app restart, and
  // his instinct that clicking again would just work was right: the version
  // probe had been killed by its deadline on a cold login shell, and the
  // deadline was published as a verdict about Claude Code.
  describe('an unprobed source cannot produce a failure message', () => {
    it('answers known: false for a source whose probes never came back', () => {
      const readiness = agentSourceLaunchReadiness(
        claudeSnapshot({
          state: 'unknown',
          stateLabel: 'Unknown',
          unobservedProbes: ['version', 'authentication'],
        }),
        'claude'
      );
      expect(readiness).toEqual({
        known: false,
        unobserved: ['version', 'authentication'],
      });
    });

    it('never publishes a message for an incomplete observation', () => {
      // Coverage outranks state: even a snapshot whose producer computed
      // `degraded` over a probe that never answered may not speak. This is
      // the assertion that fails if the sixth instance is written.
      for (const state of [
        'degraded',
        'unavailable',
        'not-installed',
        'action-required',
        'incompatible',
        'unknown',
      ] as const) {
        const readiness = agentSourceLaunchReadiness(
          claudeSnapshot({
            state,
            stateLabel: state,
            unobservedProbes: ['version'],
          }),
          'claude'
        );
        expect(readiness.known, `state=${state}`).toBe(false);
        expect('message' in readiness, `state=${state}`).toBe(false);
      }
    });

    it('treats a source missing from the snapshot as unlooked-at, not broken', () => {
      expect(
        agentSourceLaunchReadiness(
          { sources: [] } as unknown as AgentSourceRegistrySnapshot,
          'claude'
        )
      ).toEqual({ known: false, unobserved: ['installation'] });
    });

    it('still speaks for a negative it actually observed', () => {
      const readiness = agentSourceLaunchReadiness(
        claudeSnapshot({ state: 'degraded', stateLabel: 'Degraded' }),
        'claude'
      );
      expect(readiness.known && readiness.blocked && readiness.message).toBe(
        'Claude Code is installed, but its checks did not pass. Open Settings → Agent Sources to recheck.'
      );
      // The state enum never reaches the operator, and no sentence tells him
      // to go recheck a probe that simply has not finished.
      expect(
        readiness.known && readiness.blocked && readiness.message
      ).not.toMatch(/could not be verified|\(degraded\)/);
    });
  });
});

describe('Grok Build source truth (ENG-003 S4)', () => {
  it('reads the installed version and pins the verified contract floor', () => {
    // Real output from the installed binary on 2026-08-13.
    expect(parseGrokVersion('grok 1.0.3 (1a29d5bc12d4)')).toEqual({
      version: '1.0.3',
      compatible: true,
    });
    expect(parseGrokVersion('grok 2.0.0')).toMatchObject({ compatible: true });
    expect(parseGrokVersion('grok 0.9.14')).toMatchObject({
      compatible: false,
    });
    // No version is UNKNOWN, never "compatible by default".
    expect(parseGrokVersion('grok')).toBeNull();
  });

  it('opens the source-owned sign-in rather than handling a credential', () => {
    expect(sourceOwnedActionCommand('grok', 'authenticate')).toBe(
      "'grok' 'login'"
    );
  });

  it('names the source when a launch is refused', () => {
    const snapshot = {
      sources: [
        {
          adapterId: 'grok',
          harness: 'grok',
          label: 'Grok Build',
          state: 'action-required',
          stateLabel: 'Action required',
          launchable: false,
          unobservedProbes: [],
        },
      ],
    } as unknown as AgentSourceRegistrySnapshot;
    const readiness = agentSourceLaunchReadiness(snapshot, 'grok');
    const message = readiness.known && readiness.blocked && readiness.message;
    expect(message).toContain('Grok Build');
    expect(message).toContain('requires sign-in');
  });
});
