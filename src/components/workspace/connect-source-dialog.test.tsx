/**
 * The Connect surface (ENG-010 C2, one screen since ENG-033 H2.4 P2).
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
  DEFAULT_REMOTE_PROJECT_NAME,
  type ConnectAttemptResult,
  type ConnectSourceBridge,
  type ConnectSourceProgress,
  type ConnectSourceResult,
} from './connect-source-dialog';
import {
  CONNECT_FAILURE_COPY,
  CONNECT_STAGE_COPY,
  type DiscoveredAgent,
} from './connect-source-model';
import { listProjects } from '@/lib/projects/registry';

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
  {
    alias: 'cinder-box',
    hasHostName: true,
    hasUser: false,
    hasIdentityFile: true,
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
    mapAgents: vi.fn(async (_sourceId, mappings) => ({
      ok: true as const,
      mapped: Array.isArray(mappings) ? mappings.length : 0,
    })),
    onSourceChanged: () => () => {},
    detach: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function renderDialog({
  bridge,
  projects,
  onConnected,
  onManageServer,
}: {
  bridge: ConnectSourceBridge;
  projects?: readonly { id: string; name: string }[];
  onConnected?: (result: ConnectSourceResult) => void;
  onManageServer?: () => void;
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
        onManageServer={onManageServer}
      />
    );
  }
  return render(<Harness />);
}

function row(alias: string): HTMLElement {
  const found = document.querySelector(`[data-connect-server="${alias}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No row for ${alias}`);
  return found;
}

async function pick(alias: string) {
  await screen.findByRole('button', { name: new RegExp(alias) });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(alias) }));
}

async function reachReady(alias = 'atlas-box') {
  await pick(alias);
  await screen.findByRole('heading', { name: `Agents on ${alias}` });
}

function primary(): HTMLElement {
  return screen.getByRole('button', { name: /^Connect/ });
}

afterEach(() => {
  cleanup();
});

describe('Connect: the server list', () => {
  it('opens on the operator’s servers, with no source step while OpenClaw is the only one', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    expect(
      await screen.findByRole('button', { name: /atlas-box/ })
    ).toBeInTheDocument();
    expect(document.querySelector('[data-connect-adapter]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Connect a server' }));
    // Listing is not contacting.
    expect(bridge.add).not.toHaveBeenCalled();
    expect(bridge.connect).not.toHaveBeenCalled();
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
    await screen.findByRole('button', { name: /atlas-box/ });
    expect(document.body.textContent ?? '').not.toMatch(/\.invalid|@|\.pem/);
  });

  it('narrows as the operator types, and Return tests the one left', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    const filter = await screen.findByLabelText('Filter servers');
    expect(filter).toHaveFocus();

    fireEvent.change(filter, { target: { value: 'bea' } });
    expect(screen.queryByRole('button', { name: /atlas-box/ })).toBeNull();
    expect(screen.getByText('1 of 3 servers')).toBeInTheDocument();

    fireEvent.keyDown(filter, { key: 'Enter' });
    await waitFor(() =>
      expect(bridge.add).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'beacon-box' })
      )
    );
  });

  it('marks a connected server with its coworkers and a way to manage it', async () => {
    const onManageServer = vi.fn();
    const bridge = makeBridge({
      list: vi.fn(async () => [{ id: 'source-9', alias: 'cinder-box' }]),
      agents: vi.fn(async () => [
        { displayName: 'Scout', projectId: 'p-1', source: { id: 'source-9' } },
        { displayName: 'reddit', projectId: 'p-1', source: { id: 'source-9' } },
      ]),
    });
    renderDialog({ bridge, onManageServer });
    await waitFor(() =>
      expect(row('cinder-box')).toHaveAttribute(
        'data-server-state',
        'connected'
      )
    );
    expect(row('cinder-box')).toHaveTextContent('Connected · Scout, reddit');
    // A connected server is not a button, so it cannot start a second
    // connect (BUG-155).
    expect(
      screen.queryByRole('button', { name: /cinder-box/ })
    ).not.toBeInTheDocument();
    fireEvent.click(within(row('cinder-box')).getByText('Manage'));
    expect(onManageServer).toHaveBeenCalledOnce();
    expect(bridge.add).not.toHaveBeenCalled();
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
    expect(
      await screen.findByLabelText('Name', { selector: 'input' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
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
    expect(
      await screen.findByText(
        'Your SSH configuration includes other files Exawatt did not read.'
      )
    ).toBeInTheDocument();
  });
});

describe('Connect: testing in place', () => {
  it('saves the picked server as a remote source owned by the SSH config', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    await pick('atlas-box');
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

  /**
   * Progress rides main's change channel while `connect` is in flight: a
   * callback handed to `connect` could never cross the context bridge.
   */
  it('ticks the row through the phases the connection is actually in', async () => {
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
    await pick('atlas-box');
    await waitFor(() =>
      expect(row('atlas-box')).toHaveAttribute('data-server-state', 'testing')
    );
    expect(row('atlas-box')).toHaveTextContent(CONNECT_STAGE_COPY.tunnel);

    act(() => progress.emit('bootstrapping'));
    expect(row('atlas-box')).toHaveTextContent(CONNECT_STAGE_COPY.credential);
    // Another source's phase never moves this row.
    act(() => progress.emit('discovering', 'source-other'));
    expect(row('atlas-box')).toHaveTextContent(CONNECT_STAGE_COPY.credential);

    await act(async () => {
      settle?.({ ok: true, agents: AGENTS, observed: OBSERVED });
    });
    expect(row('atlas-box')).toHaveAttribute('data-server-state', 'ready');
    expect(row('atlas-box')).toHaveTextContent('OpenClaw 2.4.0 · 2 Agents');
  });

  it('drops the subscription when the dialog closes', async () => {
    const progress = makeProgress();
    renderDialog({
      bridge: makeBridge({ onSourceChanged: progress.onSourceChanged }),
    });
    await screen.findByRole('button', { name: /atlas-box/ });
    expect(progress.subscribers()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(progress.subscribers()).toBe(0));
  });

  it('keeps a failure on its row, releases the record, and saves nothing', async () => {
    const bridge = makeBridge({
      connect: vi.fn(async () => ({
        ok: false as const,
        failure: 'host-unreachable' as const,
        message: 'Nothing answered on the server’s SSH port.',
      })),
    });
    renderDialog({ bridge });
    await pick('atlas-box');
    await waitFor(() =>
      expect(row('atlas-box')).toHaveAttribute('data-server-state', 'failed')
    );
    expect(row('atlas-box')).toHaveTextContent(
      'Server unreachable. Nothing was saved.'
    );
    expect(row('atlas-box')).toHaveTextContent(
      'Nothing answered on the server’s SSH port.'
    );
    expect(bridge.detach).toHaveBeenCalledWith('source-1');
    // The rest of the list is still there to pick from.
    expect(
      screen.getByRole('button', { name: /beacon-box/ })
    ).not.toBeDisabled();
  });

  it('says so when the failed record could not be released', async () => {
    renderDialog({
      bridge: makeBridge({
        connect: vi.fn(async () => ({
          ok: false as const,
          failure: 'gateway-down' as const,
          message: '',
        })),
        detach: vi.fn(async () => ({ ok: false })),
      }),
    });
    await pick('atlas-box');
    await waitFor(() =>
      expect(row('atlas-box')).toHaveTextContent(
        'It is still saved; remove it in Settings.'
      )
    );
  });

  it('tries a failed server again from its own row', async () => {
    const bridge = makeBridge({
      connect: vi
        .fn<ConnectSourceBridge['connect']>()
        .mockResolvedValueOnce({
          ok: false,
          failure: 'gateway-down',
          message: '',
        })
        .mockResolvedValue({ ok: true, agents: AGENTS, observed: OBSERVED }),
    });
    renderDialog({ bridge });
    await pick('atlas-box');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    await screen.findByRole('heading', { name: 'Agents on atlas-box' });
    expect(bridge.add).toHaveBeenCalledTimes(2);
  });

  it('releases a tested server when the operator picks another (BUG-157)', async () => {
    let next = 0;
    const bridge = makeBridge({
      add: vi.fn(async () => ({
        ok: true as const,
        source: { id: `source-${++next}` },
        created: true,
      })),
    });
    renderDialog({ bridge });
    await reachReady('atlas-box');
    await pick('beacon-box');
    await screen.findByRole('heading', { name: 'Agents on beacon-box' });

    expect(bridge.detach).toHaveBeenCalledWith('source-1');
    expect(bridge.detach).not.toHaveBeenCalledWith('source-2');
    expect(row('atlas-box')).toHaveAttribute('data-server-state', 'idle');
  });

  it('never tests, maps, or releases a server it was handed back (BUG-155)', async () => {
    const bridge = makeBridge({
      add: vi.fn(async () => ({
        ok: true as const,
        source: { id: 'source-live' },
        created: false,
      })),
    });
    renderDialog({ bridge });
    await pick('atlas-box');
    await screen.findByText(/already connected/);
    expect(bridge.connect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(bridge.detach).not.toHaveBeenCalled();
  });

  it('leaves the remote runtime alone when the operator cancels', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    await reachReady();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(bridge.detach).toHaveBeenCalledWith('source-1'));
    expect(bridge.mapAgents).not.toHaveBeenCalled();
  });
});

describe('Connect: Agents, names, and the Project', () => {
  it('checks configured Agents, keeps retired ones apart and unchecked', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachReady();
    expect(
      screen.getByRole('checkbox', { name: 'Connect social-poster' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('checkbox', { name: 'Connect Beacon' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('checkbox', { name: 'Connect former-helper' })
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('heading', { name: 'Retired on this server' })
    ).toBeInTheDocument();
    expect(primary()).toHaveTextContent('Connect 2 Agents');
  });

  it('names the one Agent in the primary action, and refuses none', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachReady();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Connect Beacon' }));
    expect(primary()).toHaveTextContent('Connect social-poster');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Connect social-poster' })
    );
    expect(primary()).toBeDisabled();
  });

  it('keeps every connection fact one disclosure away', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachReady();
    const facts = document.querySelector('[data-connect-facts]');
    expect(facts).not.toBeNull();
    for (const label of [
      'Identity',
      'Version',
      'Placement',
      'Credentials',
      'Capabilities',
    ]) {
      expect(within(facts as HTMLElement).getByText(label)).toBeInTheDocument();
    }
  });

  it('renames an Agent in place without touching the source', async () => {
    const bridge = makeBridge();
    const onConnected = vi.fn();
    renderDialog({ bridge, onConnected });
    await reachReady();
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename social-poster' })
    );
    const field = screen.getByLabelText('Name for social-poster');
    fireEvent.change(field, { target: { value: 'Marcus' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByText('Marcus')).toBeInTheDocument();
    expect(
      screen.getByText(/the server calls it social-poster/)
    ).toBeInTheDocument();

    fireEvent.click(primary());
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(bridge.mapAgents).toHaveBeenCalledWith(
      'source-1',
      expect.arrayContaining([
        expect.objectContaining({
          nativeAgentId: 'agent-alpha',
          displayNameOverride: 'Marcus',
        }),
      ])
    );
  });

  it('puts the batch into one new Remote Project by default', async () => {
    const bridge = makeBridge();
    const onConnected = vi.fn();
    renderDialog({ bridge, onConnected });
    await reachReady();
    expect(screen.getByLabelText('Project name')).toHaveValue(
      DEFAULT_REMOTE_PROJECT_NAME
    );
    fireEvent.click(primary());
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    const rows = vi.mocked(bridge.mapAgents).mock.calls[0]![1];
    expect(new Set(rows.map(entry => entry.projectId)).size).toBe(1);
    expect(rows.map(entry => entry.projectLabel)).toEqual([
      DEFAULT_REMOTE_PROJECT_NAME,
      DEFAULT_REMOTE_PROJECT_NAME,
    ]);
  });

  it('defaults to the Project the connected coworkers already live in', async () => {
    const bridge = makeBridge({
      list: vi.fn(async () => [{ id: 'source-9', alias: 'cinder-box' }]),
      agents: vi.fn(async () => [
        {
          displayName: 'Scout',
          projectId: 'project-home',
          source: { id: 'source-9' },
        },
      ]),
    });
    const onConnected = vi.fn();
    renderDialog({
      bridge,
      onConnected,
      projects: [
        { id: 'project-other', name: 'Growth' },
        { id: 'project-home', name: 'Fleet' },
      ],
    });
    await reachReady();
    expect(screen.getByLabelText('Add to')).toHaveValue('project-home');
    fireEvent.click(primary());
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(
      vi
        .mocked(bridge.mapAgents)
        .mock.calls[0]![1].every(entry => entry.projectId === 'project-home')
    ).toBe(true);
  });

  it('names a Project fault once when the Project name is emptied', async () => {
    renderDialog({ bridge: makeBridge() });
    await reachReady();
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: '' },
    });
    fireEvent.click(primary());
    expect(await screen.findAllByText('Name the Project.')).toHaveLength(1);
  });

  it('closes straight through to the Agent with no confirmation screen', async () => {
    const bridge = makeBridge();
    const onConnected = vi.fn();
    renderDialog({ bridge, onConnected });
    await reachReady();
    fireEvent.click(primary());
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(onConnected.mock.calls[0]![0]).toMatchObject({
      sourceId: 'source-1',
      openNativeAgentId: 'agent-alpha',
    });
    await waitFor(() =>
      expect(document.querySelector('[data-connect-source]')).toBeNull()
    );
    // The record is the operator's now; closing must never release it.
    expect(bridge.detach).not.toHaveBeenCalled();
  });

  it('stays open when main refuses the projection write', async () => {
    const onConnected = vi.fn();
    const bridge = makeBridge({
      mapAgents: vi.fn(async () => ({
        ok: false as const,
        issues: ['Choose a Project that still exists.'],
      })),
    });
    renderDialog({
      bridge,
      projects: [{ id: 'project-1', name: 'Growth' }],
      onConnected,
    });
    await reachReady();
    fireEvent.change(screen.getByLabelText('Add to'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(primary());
    expect(
      await screen.findByText('Choose a Project that still exists.')
    ).toBeInTheDocument();
    expect(document.querySelector('[data-connect-source]')).not.toBeNull();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('reuses the batch Project’s identity when a mapping acknowledgement is retried', async () => {
    const onConnected = vi.fn();
    const mapAgents = vi
      .fn<ConnectSourceBridge['mapAgents']>()
      .mockResolvedValueOnce({ ok: false, issues: ['Try again.'] })
      .mockResolvedValueOnce({ ok: true, mapped: 2 });
    renderDialog({ bridge: makeBridge({ mapAgents }), onConnected });
    await reachReady();

    fireEvent.click(primary());
    await screen.findByText('Try again.');
    const firstIds = mapAgents.mock.calls[0]![1].map(entry => entry.projectId);

    fireEvent.click(primary());
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    const retriedIds = mapAgents.mock.calls[1]![1].map(
      entry => entry.projectId
    );
    expect(retriedIds).toEqual(firstIds);
  });

  it('never archives a Project after an earlier mapping acknowledgement was lost', async () => {
    const mapAgents = vi
      .fn<ConnectSourceBridge['mapAgents']>()
      .mockRejectedValueOnce(new Error('ack lost'))
      .mockResolvedValueOnce({ ok: false, issues: ['Try later.'] });
    renderDialog({ bridge: makeBridge({ mapAgents }) });
    await reachReady();

    fireEvent.click(primary());
    await screen.findByText(
      'Exawatt could not save these Agent mappings. Try again.'
    );
    const uncertainIds = mapAgents.mock.calls[0]![1].map(
      entry => entry.projectId
    );

    fireEvent.click(primary());
    await screen.findByText('Try later.');

    const durableIds = new Set(
      (await listProjects()).map(project => project.id)
    );
    for (const id of uncertainIds) expect(durableIds).toContain(id);
  });
});

describe('Connect: voice', () => {
  it('never uses an em dash, and never says remote work changed', async () => {
    const seen: string[] = [];
    const record = () => seen.push(document.body.textContent ?? '');

    renderDialog({ bridge: makeBridge() });
    await screen.findByRole('button', { name: /atlas-box/ });
    record();
    await reachReady();
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
      await pick('atlas-box');
      await screen.findByText(
        new RegExp(CONNECT_FAILURE_COPY[failure].headline)
      );
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
 * The desktop path, wired the way production wires it: no bridge prop, so the
 * dialog builds its own over `window.electron.connectedSources` and can only
 * tick if the seam it uses is one the preload actually exposes.
 */
describe('Connect: the desktop bridge', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('carries the connection phase from the preload to the row', async () => {
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
      mapAgents: vi.fn(async (_id: string, mappings: unknown[]) => ({
        ok: true as const,
        mapped: mappings.length,
      })),
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

    await pick('atlas-box');
    await waitFor(() =>
      expect(row('atlas-box')).toHaveTextContent(CONNECT_STAGE_COPY.tunnel)
    );
    expect(connectedSources.connect).toHaveBeenCalledExactlyOnceWith(
      'source-1'
    );

    act(() => {
      for (const handler of [...handlers]) {
        handler({ sourceId: 'source-1', phase: 'discovering' });
      }
    });
    expect(row('atlas-box')).toHaveTextContent(CONNECT_STAGE_COPY.discovery);

    await act(async () => {
      settle?.({ ok: true, agents: AGENTS, observed: OBSERVED });
    });
    await screen.findByRole('heading', { name: 'Agents on atlas-box' });
  });
});

describe('Connect: a server described by hand', () => {
  it('tests it from the form and stands the result on its own row', async () => {
    const bridge = makeBridge();
    renderDialog({ bridge });
    await screen.findByRole('button', { name: /atlas-box/ });
    fireEvent.click(screen.getByRole('button', { name: 'Describe a server' }));
    fireEvent.change(screen.getByLabelText('Name', { selector: 'input' }), {
      target: { value: 'Studio box' },
    });
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'studio.invalid' },
    });
    fireEvent.change(screen.getByLabelText('SSH user'), {
      target: { value: 'operator' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByRole('heading', { name: 'Agents on Studio box' });
    expect(bridge.add).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialOwner: 'exawatt-keychain',
        transport: expect.objectContaining({ kind: 'ssh-manual' }),
      })
    );
    expect(row('Studio box')).toHaveAttribute('data-server-state', 'ready');
  });
});
