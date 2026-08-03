import { describe, expect, it } from 'vitest';
import {
  agentSourceLaunchError,
  localSourceState,
  openClawSourceState,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  parseOpenClawGatewayStatus,
  sourceOwnedActionCommand,
} from './agent-source-registry';
import type { AgentSourceRegistrySnapshot } from '@exawatt/core';

describe('Agent Source registry truth', () => {
  it('keeps local installation, authentication, and degraded states distinct', () => {
    expect(
      localSourceState({
        executable: false,
        versionResponded: false,
        authKnown: false,
        authenticated: false,
      })
    ).toBe('not-installed');
    expect(
      localSourceState({
        executable: true,
        versionResponded: true,
        authKnown: true,
        authenticated: false,
      })
    ).toBe('action-required');
    expect(
      localSourceState({
        executable: true,
        versionResponded: false,
        authKnown: true,
        authenticated: true,
      })
    ).toBe('degraded');
    expect(
      localSourceState({
        executable: true,
        versionResponded: true,
        authKnown: false,
        authenticated: false,
      })
    ).toBe('unknown');
    expect(
      localSourceState({
        executable: true,
        versionResponded: true,
        authKnown: true,
        authenticated: true,
      })
    ).toBe('ready');
  });

  it('keeps an unreachable configured gateway distinct from missing setup', () => {
    expect(
      openClawSourceState({
        executable: true,
        configured: false,
        protocolReady: false,
      })
    ).toBe('action-required');
    expect(
      openClawSourceState({
        executable: true,
        configured: true,
        protocolReady: false,
      })
    ).toBe('degraded');
    expect(
      openClawSourceState({
        executable: true,
        configured: true,
        protocolReady: true,
      })
    ).toBe('ready');
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

  it('uses fixed source-owned commands for auth and catalog selection', () => {
    expect(sourceOwnedActionCommand('claude', 'authenticate')).toBe(
      "'claude' 'auth' 'login'"
    );
    expect(sourceOwnedActionCommand('codex', 'authenticate')).toBe(
      "'codex' 'login'"
    );
    expect(sourceOwnedActionCommand('claude', 'choose-model')).toBe("'claude'");
  });

  it('turns source observations into actionable main-process launch errors', () => {
    const snapshot = {
      sources: [
        {
          harness: 'claude',
          label: 'Claude Code',
          state: 'action-required',
          stateLabel: 'Action required',
          launchable: false,
        },
      ],
    } as AgentSourceRegistrySnapshot;
    expect(agentSourceLaunchError(snapshot, 'claude')).toContain(
      'requires sign-in'
    );
    expect(
      agentSourceLaunchError(
        {
          ...snapshot,
          sources: [{ ...snapshot.sources[0], launchable: true }],
        },
        'claude'
      )
    ).toBeNull();
  });
});
