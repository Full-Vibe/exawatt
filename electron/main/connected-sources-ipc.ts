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
  MAX_MESSAGE_CHARACTERS,
  type AgentMappingInput,
  type ConversationRequest,
  type SendToAgentOptions,
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
 * ENG-033 H2 opens exactly one command channel and no more: the operator can
 * ask a source for write access, read a coworker's primary conversation, send
 * to that conversation, and follow the reply. Three locks keep it that narrow.
 * The source grants the scope; `ConnectedGatewaySession` allows four write
 * methods and no admin method at all; and the send API here takes an Exawatt
 * Agent id, never a session key, so no renderer call can address a context
 * other than the coworker's primary conversation.
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
  /*
   * Unlike `changed`, this one carries content, because a reply the operator
   * is waiting for is the one thing a pull cannot deliver in time. It stays
   * bounded per run in the runtime, and it is ordered by Exawatt's own
   * counter rather than by a Gateway frame sequence that resets per
   * connection.
   */
  created.onConversationUpdate(update => {
    broadcastToWindows(
      BrowserWindow.getAllWindows(),
      'connected-sources:conversation-updated',
      update
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

/**
 * The paging request, narrowed. Only two fields exist, and neither of them
 * can name a context: which conversation is read follows from the Agent id.
 */
function readConversationRequest(value: unknown): ConversationRequest {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  return {
    limit: typeof row.limit === 'number' ? row.limit : undefined,
    beforeTurnId:
      typeof row.beforeTurnId === 'string' ? row.beforeTurnId : undefined,
  };
}

/**
 * The outbound message, kept bounded across the boundary without swallowing
 * the runtime's own limit.
 *
 * One character past the limit is deliberate: cutting exactly at the limit
 * would make an over-long message arrive as a silently shortened one that
 * passes, and quietly sending most of what the operator wrote is worse than
 * telling them it was too long. The runtime refuses it with a sentence.
 */
function readMessageText(value: unknown): string {
  return typeof value === 'string'
    ? value.slice(0, MAX_MESSAGE_CHARACTERS + 1)
    : '';
}

function readSendOptions(value: unknown): SendToAgentOptions {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  return {
    idempotencyKey:
      typeof row.idempotencyKey === 'string' ? row.idempotencyKey : undefined,
  };
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

  /** What Exawatt may do with each source. Reads state; asks nothing. */
  handleTrusted('connected-sources:command-authority', async () =>
    sourceRuntime().commandAuthority()
  );

  /**
   * Ask one source to raise Exawatt from observation to conversation
   * (ENG-033 H2). The Gateway may answer that a person has to approve the
   * device on the source itself, which is an answer rather than a failure.
   */
  handleTrusted(
    'connected-sources:request-command-authority',
    async (_event, id: unknown) =>
      sourceRuntime().requestCommandAuthority(assertString(id, 'source id'))
  );

  /** Hand write access back and keep observing. */
  handleTrusted(
    'connected-sources:relinquish-command-authority',
    async (_event, id: unknown) =>
      sourceRuntime().relinquishCommandAuthority(assertString(id, 'source id'))
  );

  /**
   * One coworker's primary conversation, bounded. `chat.history` is a read, so
   * this needs no command authority and works on a read-only source.
   */
  handleTrusted(
    'connected-sources:conversation',
    async (_event, agentId: unknown, request: unknown) =>
      sourceRuntime().conversation(
        assertString(agentId, 'Agent id'),
        readConversationRequest(request)
      )
  );

  /**
   * Send to that conversation and nothing else.
   *
   * The channel takes an Exawatt Agent id, and the runtime resolves the
   * address from the projection. There is deliberately no session-key
   * parameter here or anywhere above it: a renderer that opens a cron run or
   * a delegated child to read it still has no way to aim a message at one.
   */
  handleTrusted(
    'connected-sources:send',
    async (_event, agentId: unknown, text: unknown, options: unknown) =>
      sourceRuntime().send(
        assertString(agentId, 'Agent id'),
        readMessageText(text),
        readSendOptions(options)
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
