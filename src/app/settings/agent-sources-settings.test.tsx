import {
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
      await screen.findByText('Claude Code sign-in opened in Terminal.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Agent Source' }));
    expect(screen.getByText('Available now')).toBeInTheDocument();
    expect(screen.getByText('Coming later')).toBeInTheDocument();
    expect(screen.getByText('Hosted OpenClaw')).toBeInTheDocument();
    expect(screen.getAllByText('Later').length).toBeGreaterThan(0);
    expect(claude.label).toBe('Claude Code');
  });
});
