import { describe, expect, it } from 'vitest';
import {
  localSourceState,
  openClawCredentialPresent,
  openClawSourceState,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  sourceOwnedActionCommand,
} from './agent-source-registry';

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
        credentialPresent: false,
        reachable: false,
      })
    ).toBe('action-required');
    expect(
      openClawSourceState({
        executable: true,
        configured: true,
        credentialPresent: true,
        reachable: false,
      })
    ).toBe('degraded');
    expect(
      openClawSourceState({
        executable: true,
        configured: true,
        credentialPresent: true,
        reachable: true,
      })
    ).toBe('ready');
  });

  it('recognizes inline and referenced OpenClaw credentials without reading a value', () => {
    expect(openClawCredentialPresent('opaque-secret')).toBe(true);
    expect(
      openClawCredentialPresent({ source: 'keychain', id: 'gateway' })
    ).toBe(true);
    expect(openClawCredentialPresent('')).toBe(false);
    expect(openClawCredentialPresent(null)).toBe(false);
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
});
