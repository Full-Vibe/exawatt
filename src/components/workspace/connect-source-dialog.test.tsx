/**
 * The Connect existing Agent surface (ENG-010 C2).
 *
 * Every fixture value is invented. No hostname, address, user, or key path in
 * this file belongs to anyone's real infrastructure.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_FAILURE_CLASSES, type SshHostAlias } from '@exawatt/core';
import {
  ConnectSourceDialog,
  type ConnectAttemptResult,
  type ConnectSourceBridge,
  type ConnectSourceProgress,
  type ConnectSourceResult,
} from './connect-source-dialog';
import {
  CONNECT_FAILURE_COPY,
  CONNECT_STAGES,
  CONNECT_STAGE_COPY,
  type DiscoveredAgent,
} from './connect-source-model';

const ALIASES: readonly SshHostAlias[] = [
  {
    alias: 'atlas-box',
    hasHostName: true,
    hasUser: true,
    hasIdentityFile: false,
  },
  {
    alias: 'beacon-box',
    hasHostName: false,
    hasUser: false,
    hasIdentityFile: false,
  },
];

const AGENTS: readonly DiscoveredAgent[] = [
  {
    nativeAgentId: 'agent-alpha',
    displayName: 'social-poster',
    discoveryState: 'configured',
    contextCount: 75,
    hasPrimaryConversation: true,
  },
  {
    nativeAgentId: 'agent-beta',
    displayName: 'Beacon',
    discoveryState: 'configured',
    contextCount: 3,
    hasPrimaryConversation: false,
  },
  {
    nativeAgentId: 'agent-gamma',
    displayName: 'former-helper',
    discoveryState: 'retired',
    contextCount: 12,
    hasPrimaryConversation: false,
  },
];

const OBSERVED = {
  identity: 'gateway-alpha',
  version: '2.4.0',
  capabilities: ['operator.read'],
  observedAt: 1,
};

/**
 * The change channel main broadcasts on, as a double.
 *
 * `emit` is how a test plays the phases a real session moves through, which
 * is the only way this surface learns them: there is no progress callback on
 * `connect`, because a function cannot cross the context bridge.
 */
interface ProgressChannel {
  emit(phase: string, sourceId?: string): void;
  subscribers(): number;
}

function makeProgress(): ProgressChannel &
  Pick<ConnectSourceBridge, 'onSourceChanged'> {
  const handlers = new Set<(change: ConnectSourceProgress) => void>();
  return {
    onSourceChanged: handler => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit: (phase, sourceId = 'source-1') => {
      for (const handler of [...handlers]) handler({ sourceId, phase });
    },
    subscribers: () => handlers.size,
  };
}

function makeBridge(
  overrides: Partial<ConnectSourceBridge> = {}
): ConnectSourceBridge {
  return {
    sshAliases: vi.fn(async () => ({
      aliases: ALIASES,
      configPresent: true,
      incompleteIncludes: false,
    })),
    add: vi.fn(async () => ({ ok: true as const, source: { id: 'source-1' } })),
    connect: vi.fn(
      async (): Promise<ConnectAttemptResult> => ({
        ok: true,
        agents: AGENTS,
        observed: OBSERVED,
      })
    ),
    onSourceChanged: () => () => {},
    detach: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function renderDialog({
  bridge,
  projects,
  onConnected,
}: {
  bridge: ConnectSourceBridge;
  projects?: readonly { id: string; name: string }[];
  onConnected?: (result: ConnectSourceResult) => void;
}) {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ConnectSourceDialog
        open={open}
        onOpenChange={setOpen}
        bridge={bridge}
        projects={projects}
        onConnected={onConnected}
      />
    );
  }
  return render(<Harness />);
}

async function chooseOpenClaw() {
  fireEvent.click(await screen.findByRole('button', { name: /OpenClaw/ }));
}

async function chooseAtlas() {
  await chooseOpenClaw();
  fireEvent.click(await screen.findByRole('button', { name: /atlas-box/ }));
}

async function reachAgentChoice() {
  await chooseAtlas();
  await screen.findByRole('heading', { name: 'Agents' });
}

async function reachMapping() {
  await reachAgentChoice();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByRole('button', { name: /Connect and open/ });
}

afterEach(() => {
  cleanup();
});

describe('Connect existing Agent: choosing a server', () => {
  it('lists the operator aliases and what each block declares', async () => {
    renderDialog({ bridge: makeBridge() });
    await chooseOpenClaw();

    const atlas = await screen.findByRole('button', { name: /atlas-box/ });
    expect(within(atlas).getByText('Hostname')).toBeInTheDocument();
    expect(within(atlas).getByText('User')).toBeInTheDocument();
    expect(within(atlas).queryByText('Key file')).toBeNull();

    const beacon = screen.getByRole('button', { name: /beacon-box/ });
    expect(
      within(beacon).getByText('Defaults from your SSH config')
    ).toBeInTheDocument();
  });

  it('carries alias names only, never the values behind them', async () => {
    const bridge = makeBridge();
    const result = await bridge.sshAliases();
    for (const alias of result.aliases) {
      expect(Object.keys(alias).sort()).toEqual([
        'alias',
        'hasHostName',
        'hasIdentityFile',
        'hasUser',
      ]);
    }

    renderDialog({ bridge });
    await chooseOpenClaw();
    await screen.findByRole('button', { name: /atlas-box/ });
    expect(document.body.textContent ?? '').not.toMatch(/\.invalid|@|\.pem/);
  });

  it('offers the manual path plainly when the machine has no SSH config', async () => {
    renderDialog({
      bridge: makeBridge({
        sshAliases: vi.fn(async () => ({
          aliases: [],
          configPresent: false,
          incompleteIncludes: false,
        })),
      }),
    });
    await chooseOpenClaw();

    expect(
      await screen.findByLabelText('Name', { selector: 'input' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(screen.getByLabelText('SSH user')).toBeInTheDocument();
    expect(screen.getByLabelText('Gateway port')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Test connection' })
    ).toBeDisabled();
  });

  it('says when the SSH config delegates to files it did not read', async () => {
    renderDialog({
      bridge: makeBridge({
        sshAliases: vi.fn(async () => ({
          aliases: ALIASES,
          configPresent: true,
          incompleteIncludes: true,
        })),
      }),
    });
    await chooseOpenClaw();
    expect(
      await screen.findByText(
        'Your SSH configuration includes other files Exawatt did not read.'
      )
    ).toBeInTheDocument();
  });

  it('saves the chosen server as a remote source owned by the SSH config', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    await chooseAtlas();

    await waitFor(() => expect(bridge.add).toHaveBeenCalledOnce());
    expect(bridge.add).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterId: 'openclaw',
        placement: 'customer-hosted',
        credentialOwner: 'source-owned-ssh',
        displayName: 'atlas-box',
      })
    );
  });
});

function stageRow(stage: (typeof CONNECT_STAGES)[number]): HTMLElement {
  const row = screen.getByText(CONNECT_STAGE_COPY[stage]).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${stage}`);
  return row;
}

describe('Connect existing Agent: the bounded test', () => {
  /**
   * The regression this file did not have.
   *
   * The checklist used to be driven by a callback handed to `connect`, and
   * the desktop bridge could not deliver one: `connect` is an `invoke`, so
   * the function was dropped at the boundary and every real connection showed
   * a frozen "Opening the SSH tunnel" for the whole round trip. So the test
   * plays the phases the way main actually reports them — over the change
   * channel, while the connect call is still in flight — and asserts the
   * operator is looking at the step the connection is really on.
   */
  it('ticks through the phases the connection is actually in', async () => {
    const progress = makeProgress();
    let settle: ((result: ConnectAttemptResult) => void) | undefined;
    const bridge = makeBridge({
      onSourceChanged: progress.onSourceChanged,
      connect: vi.fn(
        () =>
          new Promise<ConnectAttemptResult>(resolve => {
            settle = resolve;
          })
      ),
    });
    renderDialog({ bridge });
    await chooseAtlas();

    expect(
      await screen.findByText(CONNECT_STAGE_COPY.tunnel)
    ).toBeInTheDocument();

    const phases = [
      ['opening-tunnel', 'tunnel'],
      ['bootstrapping', 'credential'],
      ['pairing', 'pairing'],
      ['discovering', 'discovery'],
    ] as const;
    for (const [phase, stage] of phases) {
      act(() => progress.emit(phase));
      expect(stageRow(stage)).toHaveAttribute('aria-current', 'step');
      expect(stageRow(stage)).toHaveAttribute('data-stage-state', 'active');
    }
    // Everything the connection already passed reads as done rather than
    // pending, so the operator can see how far it got at a glance.
    expect(stageRow('tunnel')).toHaveAttribute('data-stage-state', 'done');

    await act(async () => {
      settle?.({ ok: true, agents: AGENTS, observed: OBSERVED });
    });
    await screen.findByRole('heading', { name: 'Agents' });
  });

  it('ignores progress from a server this flow is not testing', async () => {
    const progress = makeProgress();
    const bridge = makeBridge({
      onSourceChanged: progress.onSourceChanged,
      connect: vi.fn(() => new Promise<ConnectAttemptResult>(() => {})),
    });
    renderDialog({ bridge });
    await chooseAtlas();
    await screen.findByText(CONNECT_STAGE_COPY.tunnel);

    act(() => progress.emit('discovering', 'some-other-source'));
    expect(stageRow('tunnel')).toHaveAttribute('aria-current', 'step');
    expect(stageRow('discovery')).toHaveAttribute(
      'data-stage-state',
      'waiting'
    );
  });

  it('drops the subscription when the dialog closes', async () => {
    const progress = makeProgress();
    const bridge = makeBridge({ onSourceChanged: progress.onSourceChanged });
    renderDialog({ bridge });
    await chooseOpenClaw();
    expect(progress.subscribers()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(progress.subscribers()).toBe(0));
  });

  it('leaves the source and the remote runtime alone when the operator cancels', async () => {
    const bridge = makeBridge({
      connect: vi.fn(
        () => new Promise<ConnectAttemptResult>(() => {})
      ) as ConnectSourceBridge['connect'],
    });
    renderDialog({ bridge });
    await chooseAtlas();
    await screen.findByText(CONNECT_STAGE_COPY.tunnel);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(bridge.detach).toHaveBeenCalledExactlyOnceWith('source-1')
    );
  });

  it('shows every connection fact separately once the test lands', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachAgentChoice();

    for (const [label, value] of [
      ['Identity', 'gateway-alpha'],
      ['Version', '2.4.0'],
      ['Placement', 'Remote'],
      ['Credentials', 'Your SSH configuration'],
      ['Capabilities', 'Read'],
    ]) {
      const term = screen.getByText(label as string);
      expect(term.parentElement).toHaveTextContent(value as string);
    }
  });

  it('marks a fact the source did not declare instead of inventing one', async () => {
    renderDialog({
      bridge: makeBridge({
        connect: vi.fn(async () => ({ ok: true as const, agents: AGENTS })),
      }),
    });
    await reachAgentChoice();
    expect(screen.getAllByText('Not reported')).toHaveLength(3);
  });
});

describe('Connect existing Agent: failures', () => {
  for (const failure of SOURCE_FAILURE_CLASSES) {
    it(`states the next step for ${failure}`, async () => {
      renderDialog({
        bridge: makeBridge({
          connect: vi.fn(async () => ({
            ok: false as const,
            failure,
            message: 'The Gateway answered with nothing usable.',
          })),
        }),
      });
      await chooseAtlas();

      const copy = CONNECT_FAILURE_COPY[failure];
      expect(await screen.findByText(copy.headline)).toBeInTheDocument();
      expect(screen.getByText(copy.nextStep)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Try again/ })
      ).toBeInTheDocument();
      expect(
        screen.getByText('The server keeps running its own work.')
      ).toBeInTheDocument();
    });
  }

  it('leaves the failed step showing rather than resetting to the first', async () => {
    const progress = makeProgress();
    let settle: ((result: ConnectAttemptResult) => void) | undefined;
    renderDialog({
      bridge: makeBridge({
        onSourceChanged: progress.onSourceChanged,
        connect: vi.fn(
          () =>
            new Promise<ConnectAttemptResult>(resolve => {
              settle = resolve;
            })
        ),
      }),
    });
    await chooseAtlas();
    await screen.findByText(CONNECT_STAGE_COPY.tunnel);

    act(() => progress.emit('pairing'));
    await act(async () => {
      settle?.({
        ok: false,
        failure: 'approval-required',
        message: 'The Gateway is waiting for an approval.',
      });
    });

    await screen.findByText(CONNECT_FAILURE_COPY['approval-required'].headline);
    // How far it got is half the diagnosis: the tunnel and the credential
    // were fine, and pairing is the step that did not complete.
    expect(stageRow('tunnel')).toHaveAttribute('data-stage-state', 'done');
    expect(stageRow('credential')).toHaveAttribute('data-stage-state', 'done');
    expect(stageRow('pairing')).toHaveAttribute('data-stage-state', 'failed');
    expect(stageRow('discovery')).toHaveAttribute(
      'data-stage-state',
      'waiting'
    );
  });

  it('retries the same server rather than saving a second one', async () => {
    const connect = vi
      .fn<ConnectSourceBridge['connect']>()
      .mockResolvedValueOnce({
        ok: false,
        failure: 'gateway-down',
        message: '',
      })
      .mockResolvedValue({ ok: true, agents: AGENTS, observed: OBSERVED });
    const bridge = makeBridge({ connect });
    renderDialog({ bridge });
    await chooseAtlas();

    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    await screen.findByRole('heading', { name: 'Agents' });
    expect(bridge.add).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('Connect existing Agent: choosing Agents', () => {
  it('selects configured Agents and keeps retired ones apart and unchecked', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachAgentChoice();

    expect(
      screen.getByRole('checkbox', { name: /social-poster/ })
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Beacon/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    const retired = screen.getByRole('checkbox', { name: /former-helper/ });
    expect(retired).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('heading', { name: 'Retired on this server' })
    ).toBeInTheDocument();
  });

  it('imports a retired Agent only when the operator chooses it', async () => {
    const onConnected = vi.fn();
    renderDialog({ bridge: makeBridge(), onConnected });
    await reachAgentChoice();

    fireEvent.click(screen.getByRole('checkbox', { name: /former-helper/ }));
    expect(
      screen.getByRole('checkbox', { name: /former-helper/ })
    ).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('button', { name: /Connect and open/ });
    fireEvent.click(screen.getByRole('button', { name: /Connect and open/ }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(
      onConnected.mock.calls[0]?.[0].agents.map(
        (agent: { nativeAgentId: string }) => agent.nativeAgentId
      )
    ).toEqual(['agent-alpha', 'agent-beta', 'agent-gamma']);
  });

  it('reports how much work each Agent carries', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachAgentChoice();
    expect(
      screen.getByRole('checkbox', { name: /social-poster/ })
    ).toHaveTextContent('Conversation · 75 contexts');
    expect(screen.getByRole('checkbox', { name: /Beacon/ })).toHaveTextContent(
      'No conversation yet · 3 contexts'
    );
  });
});

describe('Connect existing Agent: Project mapping', () => {
  it('suggests one renameable Project per Agent and keeps the source name', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachMapping();

    const names = screen.getAllByLabelText('Name');
    expect(names[0]).toHaveAttribute('placeholder', 'social-poster');
    expect(names[0]).toHaveValue('');
    expect(
      screen.getByText('The server calls it social-poster.')
    ).toBeInTheDocument();

    const projectNames = screen.getAllByLabelText('Project name');
    expect(projectNames[0]).toHaveValue('social-poster');
    expect(projectNames[1]).toHaveValue('Beacon');
  });

  it('groups several Agents into one existing Project when asked', async () => {
    const onConnected = vi.fn();
    renderDialog({
      bridge: makeBridge(),
      projects: [{ id: 'project-1', name: 'Growth' }],
      onConnected,
    });
    await reachMapping();

    for (const select of screen.getAllByLabelText('Project')) {
      fireEvent.change(select, { target: { value: 'project-1' } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Connect and open/ }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    const result = onConnected.mock.calls[0]?.[0] as ConnectSourceResult;
    expect(result.sourceId).toBe('source-1');
    expect(result.openAgentId).toBe('agent-alpha');
    expect(result.agents.map(agent => agent.project)).toEqual([
      { kind: 'existing-project', projectId: 'project-1' },
      { kind: 'existing-project', projectId: 'project-1' },
    ]);
  });

  it('renames an Agent in Exawatt without touching the source', async () => {
    const onConnected = vi.fn();
    const bridge = makeBridge();
    renderDialog({ bridge, onConnected });
    await reachMapping();

    fireEvent.change(screen.getAllByLabelText('Name')[0] as HTMLInputElement, {
      target: { value: 'Marcus' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Connect and open Marcus/ })
    );

    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    const result = onConnected.mock.calls[0]?.[0] as ConnectSourceResult;
    expect(result.agents[0]?.displayName).toBe('Marcus');
    expect(result.agents[1]?.displayName).toBe('Beacon');
  });

  it('names the fault when a Project name is emptied', async () => {
    const onConnected = vi.fn();
    renderDialog({ bridge: makeBridge(), onConnected });
    await reachMapping();

    fireEvent.change(
      screen.getAllByLabelText('Project name')[0] as HTMLInputElement,
      { target: { value: '   ' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /Connect and open/ }));

    expect(
      await screen.findByText('Name the Project this Agent belongs to.')
    ).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled();
  });

  /*
   * Connecting closes through to the coworker. There is no "Connected." page
   * with a Done button on it, because the operator asked to open somebody and
   * a confirmation screen is one keystroke standing in the way.
   */
  it('closes straight through to the Agent with no confirmation screen', async () => {
    const bridge = makeBridge();
    const onConnected = vi.fn();
    renderDialog({ bridge, onConnected });
    await reachMapping();

    fireEvent.click(screen.getByRole('button', { name: /Connect and open/ }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());

    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('[data-connect-source]')).toBeNull()
    );
    // The record is the operator's now. Closing releases an abandoned
    // attempt; it must never release a connection they just kept.
    expect(bridge.detach).not.toHaveBeenCalled();
  });

  it('steps back to the Agent choice with the selection intact', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachMapping();

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(
      await screen.findByRole('checkbox', { name: /social-poster/ })
    ).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Connect existing Agent: voice', () => {
  it('never uses an em dash, and never says remote work changed', async () => {
    const seen: string[] = [];
    const record = () => seen.push(document.body.textContent ?? '');

    renderDialog({ bridge: makeBridge() });
    record();
    await chooseOpenClaw();
    await screen.findByRole('button', { name: /atlas-box/ });
    record();
    fireEvent.click(screen.getByRole('button', { name: /atlas-box/ }));
    record();
    await screen.findByRole('heading', { name: 'Agents' });
    record();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByRole('button', { name: /Connect and open/ });
    record();
    cleanup();

    for (const failure of SOURCE_FAILURE_CLASSES) {
      renderDialog({
        bridge: makeBridge({
          connect: vi.fn(async () => ({
            ok: false as const,
            failure,
            message: 'The Gateway answered with nothing usable.',
          })),
        }),
      });
      await chooseAtlas();
      await screen.findByText(CONNECT_FAILURE_COPY[failure].headline);
      record();
      cleanup();
    }

    renderDialog({
      bridge: makeBridge({
        sshAliases: vi.fn(async () => ({
          aliases: [],
          configPresent: false,
          incompleteIncludes: false,
        })),
      }),
    });
    await chooseOpenClaw();
    await screen.findByLabelText('Address');
    record();

    expect(seen).not.toHaveLength(0);
    for (const text of seen) {
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\bstopped\b|\bpaused\b|\blost\b/i);
    }
  });
});

/**
 * The desktop path, wired the way production wires it.
 *
 * Every other test in this file injects a bridge, which is exactly how a
 * frozen checklist survived review: the injected double honoured a progress
 * callback the real preload could never deliver. This one mounts the dialog
 * with no bridge prop at all, so it builds its own over
 * `window.electron.connectedSources` and can only tick if the seam it uses is
 * one the preload actually exposes.
 */
describe('Connect existing Agent: the desktop bridge', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('carries the connection phase from the preload to the checklist', async () => {
    const handlers = new Set<(change: ConnectSourceProgress) => void>();
    let settle: ((result: ConnectAttemptResult) => void) | undefined;
    const connectedSources = {
      sshAliases: vi.fn(async () => ({
        aliases: ALIASES,
        configPresent: true,
        incompleteIncludes: false,
      })),
      add: vi.fn(async () => ({ ok: true, source: { id: 'source-1' } })),
      connect: vi.fn(
        () =>
          new Promise<ConnectAttemptResult>(resolve => {
            settle = resolve;
          })
      ),
      onChanged: (handler: (change: ConnectSourceProgress) => void) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      detach: vi.fn(async () => ({ ok: true })),
    };
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { isElectron: true, platform: 'darwin', connectedSources },
    });

    function Harness() {
      const [open, setOpen] = useState(true);
      return <ConnectSourceDialog open={open} onOpenChange={setOpen} />;
    }
    render(<Harness />);

    await chooseAtlas();
    await screen.findByText(CONNECT_STAGE_COPY.tunnel);
    // Main broadcasts the phase per source; nothing is handed to `connect`.
    expect(connectedSources.connect).toHaveBeenCalledExactlyOnceWith(
      'source-1'
    );

    act(() => {
      for (const handler of [...handlers]) {
        handler({ sourceId: 'source-1', phase: 'discovering' });
      }
    });
    expect(stageRow('discovery')).toHaveAttribute('aria-current', 'step');

    await act(async () => {
      settle?.({ ok: true, agents: AGENTS, observed: OBSERVED });
    });
    await screen.findByRole('heading', { name: 'Agents' });
  });
});
