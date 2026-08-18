import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedSourceView } from '@exawatt/core';
import { fallbackAgentSourceRegistry } from '@/components/workspace/agent-sources';
import { AgentSourcesSettings } from './agent-sources-settings';
import type { ConnectedSourceObservation } from './connected-sources-section';

describe('Agent Source Settings', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'electron');
    vi.useRealTimers();
  });

  it('renders normalized source truth and separates current adapters from future ones', async () => {
    const registry = fallbackAgentSourceRegistry('all');
    const claude = registry.sources.find(
      source => source.adapterId === 'claude'
    )!;
    const liveRegistry = {
      ...registry,
      observedAt: 10,
      sources: registry.sources.map(source =>
        source.adapterId === 'claude'
          ? {
              ...source,
              state: 'action-required' as const,
              stateLabel: 'Action required',
              launchable: false,
              observedAt: 10,
              actions: {
                recheck: true,
                authenticate: true,
                chooseModel: false,
                installGuide: true,
              },
              facts: {
                ...source.facts,
                authentication: {
                  ...source.facts.authentication,
                  state: 'action-required' as const,
                  value: 'Sign-in required',
                  detail: 'Credential remains with Claude Code.',
                },
                identity: {
                  ...source.facts.identity,
                  state: 'action-required' as const,
                  value: 'Not signed in',
                },
              },
            }
          : source
      ),
    };
    const list = vi.fn(async () => liveRegistry);
    const act = vi.fn(async () => ({
      ok: true,
      message: 'Claude Code sign-in opened in Terminal.',
    }));
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        isElectron: true,
        platform: 'darwin',
        agentSources: { list, act },
      },
    });

    render(<AgentSourcesSettings />);
    await waitFor(() => expect(list).toHaveBeenCalledWith('all', false));
    expect(
      (await screen.findAllByText('Action required')).length
    ).toBeGreaterThan(0);
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(
      screen.getByText('Credential remains with Claude Code.')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Claude Code' })
    );
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith('claude', 'authenticate')
    );
    expect(
      await screen.findByText(/Claude Code sign-in opened in Terminal\./)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Browse Agent Sources' })
    );
    expect(screen.getByText('Available now')).toBeInTheDocument();
    expect(screen.getByText('Future sources')).toBeInTheDocument();
    // Placement is a fact on a configured source (decision 0037), so there is
    // no separate hosted OpenClaw adapter to advertise. Custom harness is.
    expect(screen.queryByText('Hosted OpenClaw')).not.toBeInTheDocument();
    expect(screen.getByText('Custom harness')).toBeInTheDocument();
    // Unconfigurable adapters carry the shared readiness marker (ENG-026
    // grammar): sentence-case "Coming soon", never a bespoke "Soon" pill.
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(claude.label).toBe('Claude Code');
  });

  it('reconciles source-owned sign-in until the source is actually ready', async () => {
    vi.useFakeTimers();
    const base = fallbackAgentSourceRegistry('all');
    const actionRequired = {
      ...base,
      sources: base.sources.map(source =>
        source.adapterId === 'claude'
          ? {
              ...source,
              state: 'action-required' as const,
              stateLabel: 'Action required',
              launchable: false,
              actions: {
                ...source.actions,
                recheck: true,
                authenticate: true,
              },
            }
          : source
      ),
    };
    const ready = {
      ...actionRequired,
      sources: actionRequired.sources.map(source =>
        source.adapterId === 'claude'
          ? {
              ...source,
              state: 'ready' as const,
              stateLabel: 'Ready',
              launchable: true,
              actions: { ...source.actions, authenticate: false },
            }
          : source
      ),
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce(actionRequired)
      .mockResolvedValueOnce(ready);
    const act = vi.fn(async () => ({ ok: true, message: 'Sign-in opened.' }));
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      agentSources: { list, act },
    } as unknown as NonNullable<Window['electron']>;

    render(<AgentSourcesSettings />);
    await reactAct(async () => Promise.resolve());
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with Claude Code' })
    );
    await reactAct(async () => Promise.resolve());
    expect(
      screen.getByText(/Waiting for source-owned sign-in/)
    ).toBeInTheDocument();

    await reactAct(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(list).toHaveBeenLastCalledWith('all', true);
    expect(
      screen.getByText('Claude Code is signed in and ready to launch.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Claude Code, Local CLI, Ready' })
    ).toBeInTheDocument();
  });

  it('shows a source-owned installation path for a missing CLI', async () => {
    const base = fallbackAgentSourceRegistry('all');
    const missing = {
      ...base,
      sources: base.sources.map(source =>
        source.adapterId === 'claude'
          ? {
              ...source,
              state: 'not-installed' as const,
              stateLabel: 'Not installed',
              actions: { ...source.actions, recheck: true, installGuide: true },
            }
          : source
      ),
    };
    const act = vi.fn(async () => ({
      ok: true,
      message: 'Claude Code installation guide opened.',
    }));
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      agentSources: { list: vi.fn(async () => missing), act },
    } as unknown as NonNullable<Window['electron']>;

    render(<AgentSourcesSettings />);
    const button = await screen.findByRole('button', {
      name: 'Open installation guide',
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith('claude', 'install-guide')
    );
    expect(
      screen.getByText('Claude Code installation guide opened.')
    ).toBeInTheDocument();
  });
});

/**
 * Connected sources (ENG-010 C2).
 *
 * The assertions here are the product contract, not the implementation:
 * every fact stays separately legible, connection copy comes from the one
 * vocabulary that owns it, and detach reads as detach rather than deletion.
 */
describe('Connected sources in Agent Source Settings', () => {
  afterEach(() => {
    cleanup();
    changeTick = null;
    Reflect.deleteProperty(window, 'electron');
    vi.useRealTimers();
  });

  /** The most recent handler the bridge's `onChanged` was given, if any. */
  let changeTick: (() => void) | null = null;

  function connection(
    overrides: Partial<ConnectedSourceView> & { id: string }
  ): ConnectedSourceView {
    return {
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: 'Work gateway',
      transportKind: 'ssh-alias',
      alias: 'work-gateway',
      credentialOwner: 'source-owned-ssh',
      hasDeviceCredential: true,
      ...overrides,
    };
  }

  function observation({
    id,
    connection,
    ...overrides
  }: Partial<Omit<ConnectedSourceObservation, 'connection'>> & {
    id: string;
    connection?: Partial<ConnectedSourceObservation['connection']>;
  }): ConnectedSourceObservation {
    const state = connection?.state ?? 'live';
    return {
      sourceId: id,
      displayName: 'Work gateway',
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      placementLabel: 'Remote',
      observing: state === 'live',
      phase: state === 'live' ? 'connected' : 'reconnecting',
      identityDrift: false,
      snapshotRevision: 1,
      ...overrides,
      connection: {
        state: 'live',
        label: 'Live',
        // Left empty on purpose: the surface owns the sentence until the
        // bridge produces one, and this fixture proves that fallback.
        detail: '',
        observationAgeMs: 4_000,
        stalePresentation: false,
        failure: null,
        ...connection,
      },
    };
  }

  function mountBridge(options: {
    sources: ConnectedSourceView[];
    statuses?: ConnectedSourceObservation[];
    rename?: ReturnType<typeof vi.fn>;
    detach?: ReturnType<typeof vi.fn>;
    connect?: ReturnType<typeof vi.fn>;
  }) {
    let current = options.sources;
    const rename =
      options.rename ??
      vi.fn(async (id: string, displayName: string) => {
        current = current.map(source =>
          source.id === id ? { ...source, displayName } : source
        );
        return { ok: true };
      });
    const detach =
      options.detach ??
      vi.fn(async (id: string) => {
        current = current.filter(source => source.id !== id);
        return { ok: true };
      });
    const connectedSources = {
      list: vi.fn(async () => current),
      sshAliases: vi.fn(async () => ({
        aliases: [],
        configPresent: false,
        incompleteIncludes: false,
      })),
      add: vi.fn(async () => ({ ok: true as const, source: null })),
      rename,
      detach,
      status: vi.fn(async () => options.statuses ?? []),
      connect: options.connect ?? vi.fn(async () => ({ ok: true })),
      // The bridge's change tick. Every connected test therefore exercises
      // the subscribe/unsubscribe path, not only the interval fallback.
      onChanged: vi.fn((handler: () => void) => {
        changeTick = handler;
        return () => {
          changeTick = null;
        };
      }),
    };
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      agentSources: {
        list: vi.fn(async () => fallbackAgentSourceRegistry('all')),
        act: vi.fn(async () => ({ ok: true, message: 'Done.' })),
      },
      connectedSources,
    } as unknown as NonNullable<Window['electron']>;
    return connectedSources;
  }

  async function openConnection(name: string) {
    const row = await screen.findByRole('button', {
      name: new RegExp(`^${name},`),
    });
    fireEvent.click(row);
    return await screen.findByText(name, { selector: 'h2' });
  }

  it('gives each connection state its own treatment and vocabulary', async () => {
    mountBridge({
      sources: [
        connection({ id: 'a', displayName: 'Alpha gateway' }),
        connection({ id: 'b', displayName: 'Bravo gateway' }),
        connection({ id: 'c', displayName: 'Charlie gateway' }),
        connection({ id: 'd', displayName: 'Delta gateway' }),
      ],
      statuses: [
        observation({ id: 'a' }),
        observation({
          id: 'b',
          connection: {
            state: 'reconnecting',
            observationAgeMs: 90_000,
            stalePresentation: true,
            failure: 'gateway-down',
          },
        }),
        observation({
          id: 'c',
          connection: {
            state: 'stale',
            observationAgeMs: 240_000,
            stalePresentation: true,
          },
        }),
        observation({
          id: 'd',
          connection: {
            state: 'unavailable',
            observationAgeMs: 7_200_000,
            stalePresentation: true,
            failure: 'host-unreachable',
          },
        }),
      ],
    });
    render(<AgentSourcesSettings />);

    const expected: Array<[string, string, string]> = [
      ['Alpha gateway', 'live', 'Live'],
      ['Bravo gateway', 'reconnecting', 'Reconnecting'],
      ['Charlie gateway', 'stale', 'Last seen 4 minutes ago'],
      ['Delta gateway', 'unavailable', 'Server unreachable'],
    ];
    for (const [name, state, label] of expected) {
      await openConnection(name);
      const detail = document.querySelector('[data-connected-source]')!;
      const pill = detail.querySelector(`[data-connection-pill="${state}"]`);
      expect(pill).not.toBeNull();
      expect(pill).toHaveTextContent(label);
      expect(
        detail.querySelector(
          `[data-connected-fact="Connection"][data-connected-fact-state="${state}"]`
        )
      ).not.toBeNull();
    }
  });

  it('keeps the observation age legible on its own when the view is stale', async () => {
    mountBridge({
      sources: [connection({ id: 'c', displayName: 'Charlie gateway' })],
      statuses: [
        observation({
          id: 'c',
          connection: {
            state: 'stale',
            observationAgeMs: 3 * 3_600_000,
            stalePresentation: true,
          },
        }),
      ],
    });
    render(<AgentSourcesSettings />);
    await openConnection('Charlie gateway');

    const age = document.querySelector(
      '[data-connected-fact="Last snapshot"]'
    )!;
    expect(age).toHaveTextContent('Last seen 3 hours ago');
    // Freshness is Exawatt's, never a claim about the server's work.
    expect(
      screen.getByText(/Last-known content, not a current report\./)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The Gateway keeps working whether or not Exawatt/)
    ).toBeInTheDocument();
  });

  it('names exactly what detach removes and what it leaves alone', async () => {
    const bridge = mountBridge({
      sources: [connection({ id: 'a', displayName: 'Work gateway' })],
      statuses: [observation({ id: 'a' })],
    });
    render(<AgentSourcesSettings />);
    await openConnection('Work gateway');

    fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Detach Work gateway?')
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Exawatt gives up')).toBeInTheDocument();
    expect(within(dialog).getByText('The Gateway keeps')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Its record of this connection')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The read-only device credential it stored for it'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/OpenClaw installation and its configuration/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Its Agents, workspaces, conversation history, and results/
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Its automations and their schedules/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Gateway secret Exawatt never/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Work already running there continues, and you can/
      )
    ).toBeInTheDocument();

    // macOS semantics: Cancel to the left, the declared action last/rightmost.
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')!;
    const buttons = within(footer as HTMLElement).getAllByRole('button');
    expect(buttons.map(button => button.textContent?.trim())).toEqual([
      'Cancel',
      expect.stringContaining('Detach'),
    ]);
    expect(buttons[1]).toHaveAttribute('data-slot', 'dialog-primary-action');

    fireEvent.click(buttons[1]);
    await waitFor(() => expect(bridge.detach).toHaveBeenCalledWith('a'));
    // The record is Exawatt's alone, so its detail view leaves with it.
    await waitFor(() =>
      expect(document.querySelector('[data-connected-source]')).toBeNull()
    );
  });

  it('repairs observation with Reconnect and reports a failure as observation', async () => {
    const connect = vi.fn(async () => ({
      ok: false as const,
      sourceId: 'a',
      outcome: 'failed' as const,
      failure: 'host-unreachable' as const,
      message: 'Exawatt could not reach this server. Its work is unaffected.',
    }));
    const bridge = mountBridge({
      sources: [connection({ id: 'a', displayName: 'Work gateway' })],
      statuses: [
        observation({
          id: 'a',
          connection: {
            state: 'unavailable',
            observationAgeMs: 600_000,
            stalePresentation: true,
            failure: 'host-unreachable',
          },
        }),
      ],
      connect,
    });
    render(<AgentSourcesSettings />);
    await openConnection('Work gateway');

    expect(
      screen.getByText(
        /Reconnect repairs Exawatt's observation\. It does not start, resume, or change anything on the Gateway\./
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(bridge.connect).toHaveBeenCalledWith('a'));
    expect(
      await screen.findByText(
        'Exawatt could not reach this server. Its work is unaffected.'
      )
    ).toBeInTheDocument();
    // A reconnect attempt re-reads freshness; it never edits the roster.
    await waitFor(() => expect(bridge.status).toHaveBeenCalledTimes(2));

    // So does the bridge's own change tick, so freshness follows the source
    // rather than waiting for the drift interval.
    expect(changeTick).not.toBeNull();
    await reactAct(async () => {
      changeTick?.();
    });
    await waitFor(() => expect(bridge.status).toHaveBeenCalledTimes(3));
  });

  it('renames a connection in place and shows the new name', async () => {
    const bridge = mountBridge({
      sources: [connection({ id: 'a', displayName: 'Work gateway' })],
      statuses: [observation({ id: 'a' })],
    });
    render(<AgentSourcesSettings />);
    await openConnection('Work gateway');

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Connection name');
    fireEvent.change(input, { target: { value: 'Ops gateway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bridge.rename).toHaveBeenCalledWith('a', 'Ops gateway')
    );
    expect(
      await screen.findByText('Ops gateway', { selector: 'h2' })
    ).toBeInTheDocument();
  });

  it('offers one route to Connect existing Agent and no invented roster', async () => {
    mountBridge({ sources: [], statuses: [] });
    render(<AgentSourcesSettings />);

    const empty = await waitFor(() => {
      const node = document.querySelector('[data-connected-sources-empty]');
      expect(node).not.toBeNull();
      return node!;
    });
    expect(empty).toHaveTextContent(
      'Gateways you connect appear here with their own health.'
    );
    expect(empty).toHaveTextContent('Connect existing Agent');
    expect(document.querySelector('[data-connected-source]')).toBeNull();

    cleanup();
    const onConnect = vi.fn();
    mountBridge({ sources: [], statuses: [] });
    render(<AgentSourcesSettings onConnectExistingAgent={onConnect} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect existing Agent' })
    );
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('says who holds the credential, for an SSH configuration and for the keychain', async () => {
    mountBridge({
      sources: [
        connection({
          id: 'ssh',
          displayName: 'Alias gateway',
          credentialOwner: 'source-owned-ssh',
          alias: 'alias-gateway',
        }),
        connection({
          id: 'keychain',
          displayName: 'Manual gateway',
          transportKind: 'ssh-manual',
          alias: null,
          credentialOwner: 'exawatt-keychain',
          hasDeviceCredential: false,
        }),
      ],
      statuses: [observation({ id: 'ssh' }), observation({ id: 'keychain' })],
    });
    render(<AgentSourcesSettings />);

    await openConnection('Alias gateway');
    expect(
      screen.getByText(/The Gateway's own secret is never stored\./, {})
    ).toBeInTheDocument();
    expect(screen.getByText('Your own SSH configuration')).toBeInTheDocument();
    expect(
      screen.getByText(/SSH host alias "alias-gateway"/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('Read-only device credential in the OS keychain')
    ).toBeInTheDocument();
    expect(screen.getByText(/revoke it there/)).toBeInTheDocument();

    await openConnection('Manual gateway');
    expect(
      screen.getByText('Held by Exawatt in the OS keychain')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rather than in its own files/)
    ).toBeInTheDocument();
    expect(screen.getByText('Not paired yet')).toBeInTheDocument();
  });

  it('marks observed version and capabilities with their evidence basis', async () => {
    mountBridge({
      sources: [connection({ id: 'a', displayName: 'Work gateway' })],
      statuses: [
        observation({
          id: 'a',
          version: {
            value: 'OpenClaw 4.2.0',
            basis: 'observed',
            provenance: 'Gateway status',
          },
          capabilities: [
            {
              label: 'Conversation',
              value: 'Read only',
              basis: 'observed',
              provenance: 'Gateway scope map',
            },
            {
              label: 'Automations',
              value: 'Listed, not editable',
              basis: 'declared',
              provenance: 'Adapter contract',
            },
          ],
        }),
      ],
    });
    render(<AgentSourcesSettings />);
    await openConnection('Work gateway');

    expect(screen.getByText('OpenClaw 4.2.0')).toBeInTheDocument();
    expect(screen.getByText('Observed · Gateway status')).toBeInTheDocument();
    expect(
      screen.getByText('Observed · Gateway scope map')
    ).toBeInTheDocument();
    expect(screen.getByText('Declared · Adapter contract')).toBeInTheDocument();
  });

  it('reports an unobserved version honestly rather than inventing one', async () => {
    mountBridge({
      sources: [connection({ id: 'a', displayName: 'Work gateway' })],
      statuses: [observation({ id: 'a' })],
    });
    render(<AgentSourcesSettings />);
    await openConnection('Work gateway');

    expect(
      document.querySelector('[data-connected-fact="Version"]')
    ).toHaveTextContent('Not observed yet');
    expect(
      screen.getAllByText('Awaiting a bounded check on the Gateway.').length
    ).toBeGreaterThan(0);
  });

  it('keeps placement as quiet metadata beside a redundant glyph', async () => {
    mountBridge({
      sources: [
        connection({
          id: 'local',
          displayName: 'This machine',
          placement: 'local',
          transportKind: 'local-loopback',
          alias: null,
        }),
      ],
      statuses: [observation({ id: 'local' })],
    });
    render(<AgentSourcesSettings />);
    await openConnection('This machine');

    const placement = document.querySelector(
      '[data-connected-fact="Placement"]'
    )!;
    expect(placement).toHaveAttribute('data-connected-fact-state', 'local');
    expect(placement).toHaveTextContent('Local');
    expect(placement).toHaveTextContent('The Gateway runs on this machine.');
    // Placement never borrows a status colour; only the connection fact has one.
    expect(placement.querySelector('svg')).not.toBeNull();
    expect(placement.innerHTML).not.toContain('--settings-teal');
    expect(placement.innerHTML).not.toContain('--settings-red');
  });

  it('never writes an em dash, or a word that claims the server stopped', async () => {
    mountBridge({
      sources: [
        connection({ id: 'a', displayName: 'Work gateway' }),
        connection({
          id: 'b',
          displayName: 'Second gateway',
          credentialOwner: 'exawatt-keychain',
          hasDeviceCredential: false,
        }),
      ],
      statuses: [
        observation({ id: 'a' }),
        observation({
          id: 'b',
          connection: {
            state: 'unavailable',
            observationAgeMs: 900_000,
            stalePresentation: true,
            failure: 'auth-rejected',
          },
        }),
      ],
    });
    render(<AgentSourcesSettings />);

    const banned = ['—', 'stopped', 'paused', 'lost', 'delete'];
    const sweep = (label: string, node: Element | null) => {
      expect(node, label).not.toBeNull();
      const text = (node!.textContent ?? '').toLowerCase();
      for (const word of banned) {
        expect(text, `${label} contains "${word}"`).not.toContain(word);
      }
    };

    for (const name of ['Work gateway', 'Second gateway']) {
      await openConnection(name);
      sweep(
        `${name} rail`,
        document.querySelector('[data-connected-sources-rail]')
      );
      sweep(
        `${name} detail`,
        document.querySelector('[data-connected-source]')
      );
      fireEvent.click(screen.getByRole('button', { name: 'Detach' }));
      const dialog = await screen.findByRole('dialog');
      sweep(`${name} detach confirm`, dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      );
    }
  });
});
