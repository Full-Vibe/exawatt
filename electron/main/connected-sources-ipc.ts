import { app, BrowserWindow, safeStorage } from 'electron';
import { OCClient, type OCClientConfig } from '@exawatt/core';
import { handleTrusted } from './ipc-security';
import {
  ConnectedSourceStore,
  type AddConnectedSourceInput,
} from './connected-source-store';
import { ConnectedGatewaySession } from './connected-gateway';
import {
  ConnectedSourceRuntime,
  FileConnectedAgentProjectionPlanStore,
  type AgentMappingInput,
} from './connected-source-runtime';
import {
  createSshRemoteExec,
  resolveGatewayCredential,
} from './gateway-bootstrap';
import { openSshTunnel } from './ssh-tunnel';
import { readSshAliasCandidates } from './ssh-alias-candidates';
import { broadcastToWindows } from './window-broadcast';

/**
 * Renderer-safe control plane for configured Agent Sources (ENG-010 C1/C2).
 *
 * The renderer may list what is configured, list the SSH aliases it could
 * offer, add/rename/detach a source, and — since C2 — connect one, read its
 * freshness, read the coworkers it projects, and save where each of them
 * belongs. It never receives connection material: every read goes through a
 * view projection, and the OS keychain lives entirely on this side.
 *
 * There is deliberately still no command channel. H1 observes; nothing here
 * can send, steer, abort, or schedule, and `ConnectedGatewaySession`'s method
 * allowlist plus the source's own `operator.read` scope remain the two locks
 * that make that true rather than merely intended.
 */

let store: ConnectedSourceStore | null = null;
let runtime: ConnectedSourceRuntime | null = null;

function sourceStore(): ConnectedSourceStore {
  store ??= new ConnectedSourceStore({
    userDataDir: app.getPath('userData'),
    encryption: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: plain => safeStorage.encryptString(plain),
      decryptString: encrypted => safeStorage.decryptString(encrypted),
    },
  });
  return store;
}

function sourceRuntime(): ConnectedSourceRuntime {
  if (runtime) return runtime;
  const created = new ConnectedSourceRuntime({
    store: sourceStore(),
    plans: new FileConnectedAgentProjectionPlanStore(app.getPath('userData')),
    createSession: record =>
      new ConnectedGatewaySession(record, {
        store: sourceStore(),
        openTunnel: openSshTunnel,
        resolveCredential: resolveGatewayCredential,
        remoteExec: createSshRemoteExec(),
        createClient: (config: OCClientConfig) => new OCClient(config),
        now: Date.now,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: handle => clearTimeout(handle as NodeJS.Timeout),
      }),
    now: Date.now,
  });
  created.onChange(change => {
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'connected-sources:changed',
      change
    );
  });
  runtime = created;
  return created;
}

/** Exposed for tests. */
export function setConnectedSourceStoreForTesting(
  replacement: ConnectedSourceStore | null
): void {
  store = replacement;
}

/** Exposed for tests. */
export function setConnectedSourceRuntimeForTesting(
  replacement: ConnectedSourceRuntime | null
): void {
  runtime = replacement;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  if (value.length > 512) throw new Error(`Invalid ${label}`);
  return value;
}

/**
 * The renderer hands over Project and name decisions, never anything the
 * Gateway will see. Shapes are narrowed here; the runtime validates the
 * content and answers with issues rather than throwing.
 */
function readMappingInputs(value: unknown): AgentMappingInput[] {
  if (!Array.isArray(value)) throw new Error('Invalid agent mappings');
  if (value.length > 2_000) throw new Error('Invalid agent mappings');
  return value.map(candidate => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid agent mappings');
    }
    const row = candidate as Record<string, unknown>;
    return {
      nativeAgentId: assertString(row.nativeAgentId, 'source Agent'),
      projectId: assertString(row.projectId, 'Project'),
      projectLabel:
        typeof row.projectLabel === 'string' ? row.projectLabel : undefined,
      displayNameOverride:
        typeof row.displayNameOverride === 'string'
          ? row.displayNameOverride
          : null,
    };
  });
}

export function registerConnectedSourcesIPC(): void {
  handleTrusted('connected-sources:list', async () =>
    sourceStore().listViews()
  );

  /**
   * Passive enumeration only. Listing an alias is not contacting a server;
   * selecting one is, and that happens through connect below.
   */
  handleTrusted('connected-sources:ssh-aliases', async () =>
    readSshAliasCandidates()
  );

  handleTrusted(
    'connected-sources:add',
    async (_event, input: AddConnectedSourceInput) => {
      if (!input || typeof input !== 'object') {
        throw new Error('Invalid source');
      }
      // The store validates exhaustively, including the alias injection guard.
      // This layer only refuses shapes that are not worth handing on.
      assertString(input.displayName, 'source name');
      const result = sourceStore().add(input);
      if (!result.ok) return { ok: false as const, issues: result.issues };
      const view = sourceStore()
        .listViews()
        .find(candidate => candidate.id === result.record.id);
      return { ok: true as const, source: view ?? null };
    }
  );

  handleTrusted(
    'connected-sources:rename',
    async (_event, id: unknown, displayName: unknown) => ({
      ok: sourceStore().rename(
        assertString(id, 'source id'),
        assertString(displayName, 'source name')
      ),
    })
  );

  /**
   * Connect one saved source and answer with the Agents it configures. This is
   * the operator act that reaches a server, and it is read-only end to end.
   */
  handleTrusted('connected-sources:connect', async (_event, id: unknown) =>
    sourceRuntime().connect(assertString(id, 'source id'))
  );

  /**
   * Per-source freshness. Reading it also resumes the sources the operator
   * already paired a device credential with, which is why nothing reconnects
   * at process boot: the first surface that asks is an operator opening the
   * app, not Electron starting up.
   */
  handleTrusted('connected-sources:status', async () => {
    const active = sourceRuntime();
    void active.observeSavedSources();
    return active.status();
  });

  /** The projected coworkers, for the roster. */
  handleTrusted('connected-sources:agents', async () => {
    const active = sourceRuntime();
    void active.observeSavedSources();
    return active.agents();
  });

  /**
   * Save the Project and name decisions the Connect flow collected. A mapping
   * edit is Exawatt's alone: this issues no Gateway call, so it cannot rename,
   * move, or disturb anything on the source.
   */
  handleTrusted(
    'connected-sources:map-agents',
    async (_event, id: unknown, mappings: unknown) =>
      sourceRuntime().mapAgents(
        assertString(id, 'source id'),
        readMappingInputs(mappings)
      )
  );

  /**
   * Stop observing. The remote installation keeps working, its coworkers stay
   * in the roster as last-known, and their freshness says so.
   */
  handleTrusted('connected-sources:disconnect', async (_event, id: unknown) =>
    sourceRuntime().disconnect(assertString(id, 'source id'))
  );

  /**
   * Detach. Exawatt forgets the source and its stored credential. The remote
   * installation, its Agents, workspaces, history, and automations are not
   * touched, and the paired device stays revocable on the source itself.
   */
  handleTrusted('connected-sources:detach', async (_event, id: unknown) => {
    const sourceId = assertString(id, 'source id');
    await sourceRuntime().disconnect(sourceId);
    return { ok: sourceStore().remove(sourceId) };
  });

  /*
   * Quitting Exawatt detaches observation, never execution. Every session
   * closes exactly once; no remote work is paused, stopped, or rescheduled.
   */
  app.on('before-quit', () => {
    void runtime?.dispose();
  });
}
