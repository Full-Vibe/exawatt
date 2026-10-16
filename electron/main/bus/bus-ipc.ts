/**
 * The bus's composition root (ENG-029 C4): the one place the bus core meets
 * the app — the session roster, the turn truth, the loopback channel, the
 * launch environment, the renderer.
 *
 * Doors come from each harness's launch descriptor (`messaging`); nothing
 * here names a harness.
 */
import path from 'path';
import { app, BrowserWindow } from 'electron';
import {
  BUS_OPERATOR_ID,
  busThread,
  type AgentHarness,
  type BusSender,
} from '@exawatt/core';
import { handleBounded } from '../ipc-arguments';
import { broadcastToWindows } from '../window-broadcast';
import { harnessEventChannel } from '../harness-events/channel';
import { delegationMonitor } from '../harness-events/delegation-monitor';
import { attentionMonitor } from '../pty/attention-monitor';
import { harnessDescriptor } from '../pty/harness-registry';
import { ptySessions } from '../pty/session-manager';
import { BusDirectory } from './directory';
import { BusDispatcher } from './dispatch';
import { installBusExecutable, installBusMcpServer } from './executable';
import { BUS_MCP_SERVER_NAME } from './mcp-server';
import { createBusHttpHandler } from './http';
import { JsonlBusStore } from './ledger';
import { createRecipientStateSource } from './recipient-state';
import { runSourceCommand } from './source-command';
import { createTerminalDoors } from './terminal-doors';

/** The operator, as every message from Direct or "Send as operator" is
 *  stamped. */
const OPERATOR: BusSender = {
  sessionId: BUS_OPERATOR_ID,
  name: 'operator',
  harness: BUS_OPERATOR_ID,
  kind: 'operator',
};

/** How long a launched program may take to draw its input before the bus
 *  stops waiting for it to and types anyway. */
const STARTUP_BOUND_MS = 30_000;

function harnessLabel(harness: AgentHarness | typeof BUS_OPERATOR_ID): string {
  return harness === BUS_OPERATOR_ID
    ? 'the operator'
    : harnessDescriptor(harness).source.label;
}

export function registerBusIPC(userData: string): void {
  const root = path.join(userData, 'bus');
  const store = new JsonlBusStore(root);
  const directory = new BusDirectory(ptySessions);

  const terminals = createTerminalDoors(ptySessions, {
    engage: id => attentionMonitor.noteEngaged(id),
  });

  const recipients = createRecipientStateSource({
    facts(ptyId) {
      const session = ptySessions.list().find(item => item.id === ptyId);
      const delegation = delegationMonitor.get(ptyId);
      return {
        exited: !session || session.exited,
        starting:
          !!session &&
          !terminals.isUp(ptyId) &&
          Date.now() - session.startedAt < STARTUP_BOUND_MS,
        attention: attentionMonitor.get(ptyId),
        reportedOwnTurn: delegationMonitor.reportedOwnTurn(ptyId),
        blockedOn: delegation?.blockedOn ?? null,
        request: delegation?.request,
        working: attentionMonitor.isWorking(ptyId),
      };
    },
    watch(listener) {
      const changed = (id: string) => listener(id, false);
      const reported = (id: string, event: { kind: string }) =>
        listener(id, event.kind === 'turn-start');
      attentionMonitor.on('activity', changed);
      attentionMonitor.on('attention', changed);
      delegationMonitor.on('delegation', changed);
      delegationMonitor.on('harness-event', reported);
      ptySessions.on('exit', changed);
      const offUp = terminals.onUp(changed);
      // A program that never switches bracketed paste on is taken as up at
      // the bound, so nothing waits on it forever.
      const bounds = new Map<string, ReturnType<typeof setTimeout>>();
      const created = (session: { id: string }) => {
        const bound = setTimeout(() => {
          bounds.delete(session.id);
          changed(session.id);
        }, STARTUP_BOUND_MS);
        bound.unref?.();
        bounds.set(session.id, bound);
      };
      ptySessions.on('created', created);
      return () => {
        offUp();
        ptySessions.off('created', created);
        for (const bound of bounds.values()) clearTimeout(bound);
        attentionMonitor.off('activity', changed);
        attentionMonitor.off('attention', changed);
        delegationMonitor.off('delegation', changed);
        delegationMonitor.off('harness-event', reported);
        ptySessions.off('exit', changed);
      };
    },
  });

  const dispatcher = new BusDispatcher({
    directory,
    store,
    recipients,
    doorsOf: harness => harnessDescriptor(harness).messaging,
    contextFor: target => ({
      terminal: terminals.doorFor(target.ptyId),
      runSourceCommand: (executable, args) =>
        runSourceCommand(target.cwd, process.env, executable, args),
    }),
    harnessLabel,
    onRecord: record =>
      broadcastToWindows(BrowserWindow.getAllWindows(), 'bus:message', record),
  });

  harnessEventChannel.setBusHandler(
    createBusHttpHandler({ directory, dispatcher, store, harnessLabel })
  );

  // The command each Session finds on its PATH and the MCP server a
  // harness runs. Installed once; a launch that races the install waits for
  // it rather than launching without it.
  const executableDirectory = installBusExecutable(path.join(root, 'bin'));
  const mcpScript = installBusMcpServer(
    path.join(root, 'bin'),
    path.join(__dirname, 'mcp-server.js')
  );
  ptySessions.setLaunchEnvironmentProvider(async launch => {
    if (launch.harness === 'shell') return null;
    const outbound = harnessDescriptor(launch.harness).messaging.outbound;
    if (!outbound.path && !outbound.mcp) return null;
    if (!(await harnessEventChannel.start())) return null;
    const registration = harnessEventChannel.registerBus(launch.id);
    if (!registration) return null;
    const [bin, script] = await Promise.all([executableDirectory, mcpScript]);
    const env = {
      EXAWATT_BUS_PORT: String(registration.port),
      EXAWATT_BUS_TOKEN: registration.token,
      EXAWATT_SESSION_ID: launch.durableSessionId,
    };
    return {
      env,
      pathPrepend: outbound.path && bin ? [bin] : [],
      // Exawatt's own executable runs the server as Node, in development
      // and in the packaged app alike.
      mcpServer:
        outbound.mcp && script
          ? {
              name: BUS_MCP_SERVER_NAME,
              command: process.execPath,
              args: [script, app.getVersion()],
              env: { ELECTRON_RUN_AS_NODE: '1', ...env },
              inherited: Object.keys(env),
            }
          : null,
      release: () => harnessEventChannel.releaseBus(launch.id),
    };
  });

  handleBounded('bus:send', (_event, request) =>
    dispatcher.send({
      from: OPERATOR,
      projectId: request.projectId,
      to: request.to,
      text: request.text,
    })
  );
  handleBounded('bus:list', (_event, projectId) => store.read(projectId));
  handleBounded('bus:thread', async (_event, projectId, a, b) => {
    const read = await store.read(projectId);
    return read.ok
      ? { ok: true, records: busThread(read.records, a, b) }
      : read;
  });
}
