import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackAgentSourceRegistry } from '@/components/workspace/agent-sources';
import { AgentSourcesSettings } from './agent-sources-settings';

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
