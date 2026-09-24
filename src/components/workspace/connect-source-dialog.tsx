'use client';

/**
 * Connect a server (ENG-010 C2, reshaped into one screen by ENG-033 H2.4 P2).
 *
 * The surface for `connect-source-model.ts`. It renders what the model hands
 * it and reports what the operator did; it decides no policy of its own. The
 * house dialog contract applies: Radix primitives through `@/components/ui`,
 * one declared primary action with its chord printed on its face, Cancel to
 * its left, full keyboard operation, and visible focus.
 *
 * One screen: the operator's servers with a filter, each tested in place when
 * picked; the Agents of the server that answered, checked and renameable in
 * place; one Project for the batch; and "Connect N Agents". A failure stays on
 * its row and saves nothing.
 *
 * Two things this surface never does. It never shows the value of a HostName,
 * User, or IdentityFile line: alias metadata crosses the bridge as booleans
 * and the values stay in Electron main. And no failure copy suggests the
 * remote runtime changed, because losing sight of a server says nothing about
 * the work running on it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  AgentSourceAdapterId,
  AgentSourcePlacement,
  SourceCredentialOwner,
  SourceFailureClass,
  SourceTransport,
  SshHostAlias,
} from '@exawatt/core';
import {
  Check,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Search,
  Server,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import {
  useLatestRequest,
  type RequestTicket,
} from '@/hooks/use-latest-request';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import { OpenClawIcon } from './harness-icons';
import { SourceIdentityMark } from './source-identity-mark';
import { WORKSPACE_HUD as HUD } from './workspace-theme';
import {
  archiveProject,
  openManualProject,
  ProjectRegistryUnavailableError,
} from '@/lib/projects/registry';
import {
  DEFAULT_GATEWAY_PORT,
  canTestServer,
  cancelConnectFlow,
  connectFlowReducer,
  connectionFacts,
  credentialOwnerForTransport,
  initialConnectFlowState,
  partitionAgents,
  placementForTransport,
  resolvedDisplayName,
  saveConnectFlow,
  stageForPhase,
  validateManualDraft,
  visibleServerRows,
  type ConnectAttempt,
  type ConnectIssue,
  type ConnectedServer,
  type DiscoveredAgent,
  type ManualServerDraft,
  type ObservedSourceFacts,
  type ProjectTarget,
  type ServerRow,
} from './connect-source-model';

/** OpenClaw's brand color, read from its declaration in
 *  `contracts/agent-sources.json` rather than copied out of it (BUG-208). */
const OPENCLAW_COLOR = agentSourceDeclaration('openclaw').color;

export interface ConnectProjectOption {
  /** Opaque durable Project identity, never inferred from the display name. */
  id: string;
  name: string;
  /** Folder binding for local actions. Null means this Project is folderless. */
  rootPath?: string | null;
}

export interface ConnectedProjectMapping {
  id: string;
  name: string;
  rootPath: string | null;
}

export interface ConnectedAgentMapping {
  nativeAgentId: string;
  /** The name Exawatt shows. The source keeps its own. */
  displayName: string;
  project: ConnectedProjectMapping;
}

export interface ConnectSourceResult {
  sourceId: string;
  /** Source-native identity to resolve to the projected Agent after saving. */
  openNativeAgentId: string | null;
  agents: readonly ConnectedAgentMapping[];
}

export type ConnectAttemptResult =
  | {
      ok: true;
      agents: readonly DiscoveredAgent[];
      /** What the source declared about itself during the test. */
      observed?: ObservedSourceFacts | null;
    }
  | {
      ok: false;
      /** Null is main declining to classify; the surface reads it as unknown. */
      failure: SourceFailureClass | null;
      message: string;
    };

/**
 * One tick of main's per-source connection channel.
 *
 * Structurally the front of `ConnectedSourceChange`, and deliberately only
 * the front: this surface needs to know which source moved and what phase it
 * is in, and nothing else on that payload is progress.
 */
export interface ConnectSourceProgress {
  sourceId: string;
  phase: string;
}

/** The main-process capability this dialog drives. */
export interface ConnectSourceBridge {
  /** Reads local configuration. Listing a server is not contacting it. */
  sshAliases(): Promise<{
    aliases: readonly SshHostAlias[];
    configPresent: boolean;
    incompleteIncludes: boolean;
  }>;
  add(input: {
    adapterId: AgentSourceAdapterId;
    placement: AgentSourcePlacement;
    displayName: string;
    transport: SourceTransport;
    credentialOwner: SourceCredentialOwner;
  }): Promise<
    | {
        ok: true;
        source: { id: string } | null;
        /** False when the server was already saved (BUG-155). */
        created?: boolean;
      }
    | { ok: false; issues: readonly string[] }
  >;
  /**
   * The sources already saved, so the server list can mark them. Optional:
   * a bridge without it lists every alias as available, which is what the
   * guard in `startTest` backs up.
   */
  list?(): Promise<readonly { id: string; alias: string | null }[]>;
  /**
   * The coworkers already connected, so a saved server's row names them and
   * the batch defaults to the Project they already live in. Optional, like
   * `list`: without it the rows say Connected and the batch defaults to a new
   * Project.
   */
  agents?(): Promise<
    readonly {
      displayName: string;
      projectId: string;
      source: { id: string };
    }[]
  >;
  /** Bounded test plus read-only discovery. Answers once, at the end. */
  connect(sourceId: string): Promise<ConnectAttemptResult>;
  /** Persists the whole Exawatt-side projection decision atomically in main. */
  mapAgents(
    sourceId: string,
    mappings: readonly {
      nativeAgentId: string;
      projectId: string;
      projectLabel: string;
      displayNameOverride: string | null;
    }[]
  ): Promise<
    { ok: true; mapped: number } | { ok: false; issues: readonly string[] }
  >;
  /**
   * Main's per-source connection channel, where the bounded test's progress
   * actually lives.
   *
   * Progress cannot ride on `connect`. That call is an `invoke` across the
   * context bridge and a function is not a structured-clonable argument, so a
   * callback handed to it is dropped on the way over and the operator watches
   * a frozen checklist for the whole round trip. The session already
   * broadcasts every phase it enters on this channel for every source, so the
   * fix is to listen to the channel that is already right rather than to
   * build a second one for one dialog.
   */
  onSourceChanged(handler: (change: ConnectSourceProgress) => void): () => void;
  /** Removes Exawatt's record only. The remote installation is untouched. */
  detach(sourceId: string): Promise<{ ok: boolean }>;
}

type ConnectedSourcesApi = NonNullable<
  NonNullable<Window['electron']>['connectedSources']
>;

/**
 * The Electron bridge, when there is one. `connect` is checked at runtime
 * rather than assumed: a renderer running outside the desktop app has the
 * whole surface absent, and the chooser says where connecting happens instead
 * of offering a control that would answer nothing.
 */
function electronBridge(): ConnectSourceBridge | null {
  if (typeof window === 'undefined') return null;
  const api: ConnectedSourcesApi | undefined =
    window.electron?.connectedSources;
  if (!api || typeof api.connect !== 'function') return null;
  return {
    sshAliases: () => api.sshAliases(),
    add: input => api.add(input),
    // Guarded like the change channel below: a bridge without it lists every
    // alias as available, and the add-time guard still refuses a saved one.
    list: typeof api.list === 'function' ? () => api.list() : undefined,
    agents: typeof api.agents === 'function' ? () => api.agents() : undefined,
    connect: sourceId => api.connect(sourceId),
    mapAgents: (sourceId, mappings) => api.mapAgents(sourceId, [...mappings]),
    // Older bridges predate the channel. A dialog with no progress still
    // connects; it just cannot tick, so this degrades rather than throwing.
    onSourceChanged: handler =>
      typeof api.onChanged === 'function' ? api.onChanged(handler) : () => {},
    detach: sourceId => api.detach(sourceId),
  };
}

/** The name the batch's Project gets when nothing better is known. */
export const DEFAULT_REMOTE_PROJECT_NAME = 'Remote';

/**
 * Where the batch lands unless the operator says otherwise: the Project the
 * connected coworkers already live in, by identity, or a new one named for
 * where remote coworkers live (ENG-033 H2.4, "a special project, like
 * remote"). Never a Project named after the server.
 */
function defaultProjectFor(
  projects: readonly ConnectProjectOption[],
  coworkerProjectIds: readonly string[]
): ProjectTarget {
  const known = new Set(projects.map(project => project.id));
  const counts = new Map<string, number>();
  for (const id of coworkerProjectIds) {
    if (known.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const home = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return home
    ? { kind: 'existing-project', projectId: home }
    : { kind: 'new-project', name: DEFAULT_REMOTE_PROJECT_NAME };
}

interface TestInput {
  alias: string;
  displayName: string;
  transport: SourceTransport;
  operatorAuthored: boolean;
}

function aliasInput(alias: string): TestInput {
  return {
    alias,
    displayName: alias,
    transport: {
      kind: 'ssh-alias',
      alias,
      remotePort: DEFAULT_GATEWAY_PORT,
    },
    operatorAuthored: false,
  };
}

function manualInput(draft: ManualServerDraft): TestInput {
  return {
    alias: draft.label.trim(),
    displayName: draft.label.trim(),
    transport: {
      kind: 'ssh-manual',
      host: draft.host.trim(),
      user: draft.user.trim(),
      port: draft.port,
      identityFile: draft.identityFile.trim() || null,
      remotePort: draft.gatewayPort,
    },
    operatorAuthored: true,
  };
}

export function ConnectSourceDialog({
  open,
  onOpenChange,
  projects = [],
  bridge,
  onConnected,
  onManageServer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects an imported Agent can join. */
  projects?: readonly ConnectProjectOption[];
  /** Defaults to the Electron bridge; injected in tests and previews. */
  bridge?: ConnectSourceBridge | null;
  /** The saved source and its Project mapping, once the operator confirms. */
  onConnected?: (result: ConnectSourceResult) => void;
  /**
   * Where a connected server's Manage goes. Absent, it links to Settings;
   * Settings itself passes a close, because the operator is already there.
   */
  onManageServer?: () => void;
}) {
  const [state, dispatch] = useReducer(
    connectFlowReducer,
    undefined,
    initialConnectFlowState
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coworkerProjectIds, setCoworkerProjectIds] = useState<
    readonly string[]
  >([]);
  const serversRequested = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const retainedDraft = useRef<ManualServerDraft | null>(null);
  /** Superseded whenever a result in flight stops being the one on screen. */
  const attempts = useLatestRequest();
  /**
   * A retry reuses the same opaque identity. The source mapping write may
   * have committed even when its acknowledgement was lost, so minting a new
   * Project on every click would turn a transport retry into product state.
   */
  const manualProjectIds = useRef(new Map<string, string>());
  /** Projects that may already be referenced by a mapping whose ack was lost. */
  const uncertainProjectIds = useRef(new Set<string>());
  /** Main accepted this source's whole projection plan; cleanup cannot detach it. */
  const committedSourceId = useRef<string | null>(null);

  const resolvedBridge = useMemo(
    () => (bridge === undefined ? electronBridge() : bridge),
    [bridge]
  );
  const bridgeRef = useRef(resolvedBridge);
  bridgeRef.current = resolvedBridge;

  /** The source under test, read from inside a subscription that outlives it. */
  const testingSourceId = useRef<string | null>(null);
  testingSourceId.current =
    state.attempt?.phase.kind === 'testing' ? state.attempt.sourceId : null;
  const knownProjectIds = useMemo(
    () => projects.map(project => project.id),
    [projects]
  );
  const defaultProject = useMemo(
    () => defaultProjectFor(projects, coworkerProjectIds),
    [coworkerProjectIds, projects]
  );
  const project = state.project ?? defaultProject;

  const leave = useCallback(() => onOpenChange(false), [onOpenChange]);

  /**
   * Closing is the only cancel path, whichever control reached it: the
   * button, Escape, or the host. Leaving releases the record this flow
   * created, and touches nothing on the server itself.
   */
  const closed = useRef(true);
  useEffect(() => {
    if (open) {
      closed.current = false;
      return;
    }
    if (closed.current) return;
    closed.current = true;
    const outcome = cancelConnectFlow(state);
    attempts.invalidate();
    serversRequested.current = false;
    retainedDraft.current = outcome.retainedDraft;
    if (
      outcome.releaseSourceId &&
      outcome.releaseSourceId !== committedSourceId.current
    ) {
      void bridgeRef.current?.detach(outcome.releaseSourceId).catch(() => {});
    }
    committedSourceId.current = null;
    manualProjectIds.current.clear();
    uncertainProjectIds.current.clear();
    setServerError(null);
    setMappingError(null);
    setBusy(false);
    dispatch({ type: 'cancel' });
  }, [attempts, open, state]);

  // The operator's own typing comes back with them. An alias they merely
  // clicked leaves nothing to restore, so reopening starts clean.
  useEffect(() => {
    if (!open) return;
    const draft = retainedDraft.current;
    if (!draft) return;
    retainedDraft.current = null;
    dispatch({ type: 'set-manual', manual: true });
    dispatch({ type: 'edit-manual', patch: draft });
  }, [open]);

  // Listing reads local configuration and Exawatt's own records only.
  // Listing a server is not contacting it.
  useEffect(() => {
    if (!open || serversRequested.current) return;
    const api = bridgeRef.current;
    if (!api) return;
    serversRequested.current = true;
    const ticket = attempts.current();
    const saved = api.list
      ? api
          .list()
          .catch(() => [] as readonly { id: string; alias: string | null }[])
      : Promise.resolve([] as readonly { id: string; alias: string | null }[]);
    const coworkers = api.agents
      ? api.agents().catch(() => [])
      : Promise.resolve([]);
    void Promise.all([api.sshAliases(), saved, coworkers])
      .then(([result, sources, agents]) => {
        if (!ticket.current) return;
        const connected: ConnectedServer[] = sources.flatMap(source =>
          source.alias === null
            ? []
            : [
                {
                  alias: source.alias,
                  agentNames: agents
                    .filter(agent => agent.source.id === source.id)
                    .map(agent => agent.displayName),
                },
              ]
        );
        setCoworkerProjectIds(agents.map(agent => agent.projectId));
        dispatch({
          type: 'servers-loaded',
          aliases: result.aliases,
          connected,
          configPresent: result.configPresent,
          incompleteIncludes: result.incompleteIncludes,
        });
      })
      .catch(() => {
        if (!ticket.current) return;
        dispatch({
          type: 'servers-loaded',
          aliases: [],
          connected: [],
          configPresent: false,
          incompleteIncludes: false,
        });
      });
  }, [attempts, open]);

  /**
   * The bounded test ticks from main's own connection channel, subscribed for
   * as long as the dialog is open so the first stage is never missed. Only the
   * source under test moves the row, and only while it is under test.
   */
  useEffect(() => {
    if (!open || !resolvedBridge) return;
    return resolvedBridge.onSourceChanged(change => {
      if (change.sourceId !== testingSourceId.current) return;
      const stage = stageForPhase(change.phase);
      if (stage === null) return;
      dispatch({ type: 'test-stage', stage });
    });
  }, [open, resolvedBridge]);

  /**
   * Run the bounded test on a saved record. A failure releases the record at
   * once, so the row's "Nothing was saved" is true when it is shown; a release
   * that itself fails says so instead.
   */
  const observe = useCallback(
    async (input: {
      sourceId: string;
      placement: AgentSourcePlacement;
      credentialOwner: SourceCredentialOwner;
      ticket: RequestTicket;
    }) => {
      const api = bridgeRef.current;
      if (!api) return;
      const fail = async (
        failure: SourceFailureClass,
        message: string
      ): Promise<void> => {
        const released = await api
          .detach(input.sourceId)
          .then(result => result.ok)
          .catch(() => false);
        if (!input.ticket.current) return;
        dispatch({ type: 'test-failed', failure, message, released });
      };
      try {
        const result = await api.connect(input.sourceId);
        if (!input.ticket.current) return;
        if (result.ok) {
          const observed = result.observed ?? null;
          dispatch({
            type: 'agents-discovered',
            agents: result.agents,
            facts: connectionFacts({
              observed,
              placement: input.placement,
              credentialOwner: input.credentialOwner,
            }),
            version: observed?.version ?? null,
          });
          return;
        }
        await fail(result.failure ?? 'unknown', result.message);
      } catch {
        if (!input.ticket.current) return;
        await fail('unknown', '');
      } finally {
        if (input.ticket.current) setBusy(false);
      }
    },
    []
  );

  const startTest = useCallback(
    async (input: TestInput) => {
      const api = bridgeRef.current;
      if (!api || busy || !canTestServer(state, input.alias)) return;
      const placement = placementForTransport(input.transport.kind);
      const credentialOwner = credentialOwnerForTransport(input.transport.kind);
      setServerError(null);
      setMappingError(null);
      setBusy(true);
      const ticket = attempts.begin();
      // Picking another server releases the one this flow tested and has not
      // connected. Left in place, it stayed saved and was dialed in the
      // background indefinitely (BUG-157).
      const previous = state.attempt;
      if (previous && previous.owned && !state.settled) {
        await api.detach(previous.sourceId).catch(() => undefined);
        if (!ticket.current) return;
        dispatch({ type: 'attempt-released' });
      }
      let sourceId: string | null = null;
      let owned = false;
      try {
        const added = await api.add({
          adapterId: 'openclaw',
          placement,
          displayName: input.displayName,
          transport: input.transport,
          credentialOwner,
        });
        if (!ticket.current) return;
        sourceId = added.ok && added.source ? added.source.id : null;
        owned = added.ok && added.created !== false;
      } catch {
        sourceId = null;
      }
      if (!ticket.current) return;
      if (!sourceId) {
        setServerError(
          'Exawatt could not save this server. Check the details and try again.'
        );
        setBusy(false);
        return;
      }
      // A server that is already saved is not this flow's to test, map, or
      // release. Adopting it let Cancel detach a working connection
      // (BUG-155).
      if (!owned) {
        setServerError(
          `${input.alias} is already connected. Manage it in Settings.`
        );
        setBusy(false);
        return;
      }
      dispatch({
        type: 'test-started',
        alias: input.alias,
        sourceId,
        operatorAuthored: input.operatorAuthored,
        owned,
      });
      await observe({ sourceId, placement, credentialOwner, ticket });
    },
    [attempts, busy, observe, state]
  );

  /** A row's Try again: the same server, the way it was reached. */
  const retry = useCallback(
    (alias: string) => {
      const listed = state.servers.aliases.some(entry => entry.alias === alias);
      void startTest(listed ? aliasInput(alias) : manualInput(state.draft));
    },
    [startTest, state.draft, state.servers.aliases]
  );

  /**
   * Saving runs the machine's own decision rather than a second copy of it.
   * Success closes through to the Agent: the operator asked to open a
   * coworker, and a "Connected." page between them is one step too many.
   */
  const finish = useCallback(async () => {
    if (busy) return;
    const outcome = saveConnectFlow(state, knownProjectIds, defaultProject);
    if (!outcome.ok) {
      dispatch({ type: 'save', knownProjectIds, project: defaultProject });
      return;
    }
    const api = bridgeRef.current;
    if (!api) return;

    setBusy(true);
    setMappingError(null);
    const createdProjectIds: string[] = [];
    let mapAttempted = false;
    try {
      const target = outcome.rows[0]!.project;
      let mapped: ConnectedProjectMapping;
      if (target.kind === 'existing-project') {
        const known = projects.find(
          candidate => candidate.id === target.projectId
        );
        if (!known) {
          setMappingError('Choose a Project that still exists.');
          return;
        }
        mapped = {
          id: known.id,
          name: known.name,
          rootPath: known.rootPath ?? null,
        };
      } else {
        // One Project for the batch, so one identity, reused across retries.
        const projectId =
          manualProjectIds.current.get(outcome.sourceId) ?? crypto.randomUUID();
        manualProjectIds.current.set(outcome.sourceId, projectId);
        const created = await openManualProject({
          id: projectId,
          name: target.name.trim(),
        });
        createdProjectIds.push(created.id);
        mapped = {
          id: created.id,
          name: created.name,
          rootPath: created.root_path,
        };
      }
      const agents: ConnectedAgentMapping[] = outcome.rows.map(row => ({
        nativeAgentId: row.nativeAgentId,
        displayName: resolvedDisplayName(row),
        project: mapped,
      }));
      const inputs = outcome.rows.map(row => ({
        nativeAgentId: row.nativeAgentId,
        projectId: mapped.id,
        projectLabel: mapped.name,
        displayNameOverride: row.nameOverride,
      }));

      mapAttempted = true;
      const saved = await api.mapAgents(outcome.sourceId, inputs);
      if (!saved.ok) {
        // A previous acknowledgement may have been lost. An explicit refusal
        // now does not prove the earlier atomic write failed, so only Projects
        // that have never crossed that ambiguous boundary are safe to archive.
        await Promise.allSettled(
          createdProjectIds
            .filter(id => !uncertainProjectIds.current.has(id))
            .map(archiveProject)
        );
        setMappingError(
          saved.issues[0] ?? 'Exawatt could not save these Agent mappings.'
        );
        return;
      }

      for (const id of createdProjectIds)
        uncertainProjectIds.current.delete(id);
      committedSourceId.current = outcome.sourceId;
      dispatch({ type: 'save', knownProjectIds, project: defaultProject });
      onConnected?.({
        sourceId: outcome.sourceId,
        openNativeAgentId: outcome.openAgentId,
        agents,
      });
      onOpenChange(false);
    } catch (cause) {
      if (!mapAttempted) {
        await Promise.allSettled(createdProjectIds.map(archiveProject));
      } else {
        for (const id of createdProjectIds) uncertainProjectIds.current.add(id);
      }
      // Once mapAgents has been invoked, losing its acknowledgement is not
      // proof that main failed to commit, so durable Projects stay intact.
      // A registry that refused because it could not tell whether the
      // operator is signed in says so; nothing was written (BUG-190).
      setMappingError(
        cause instanceof ProjectRegistryUnavailableError
          ? `${cause.message} Try again.`
          : 'Exawatt could not save these Agent mappings. Try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    defaultProject,
    knownProjectIds,
    onConnected,
    onOpenChange,
    projects,
    state,
  ]);

  const manualIssues = state.manual ? validateManualDraft(state.draft) : [];
  const ready = state.attempt?.phase.kind === 'ready' ? state.attempt : null;
  const selectedCount =
    ready?.phase.kind === 'ready' ? ready.phase.selected.size : 0;
  const { rows, total } = visibleServerRows(state);
  const readyPanel =
    ready && ready.phase.kind === 'ready' ? (
      <ReadyPanel
        attempt={ready}
        issues={state.issues}
        mappingError={mappingError}
        project={project}
        projects={projects}
        onToggle={nativeAgentId =>
          dispatch({ type: 'toggle-agent', nativeAgentId })
        }
        onRename={(nativeAgentId, name) => {
          setMappingError(null);
          dispatch({ type: 'rename-agent', nativeAgentId, name });
        }}
        onProject={next => {
          setMappingError(null);
          dispatch({ type: 'set-project', project: next });
        }}
      />
    ) : null;

  const primaryAction = (() => {
    if (ready && ready.phase.kind === 'ready') {
      const chosen = ready.phase.agents.filter(agent =>
        ready.phase.kind === 'ready'
          ? ready.phase.selected.has(agent.nativeAgentId)
          : false
      );
      const lead = chosen[0];
      return {
        label:
          chosen.length === 1 && lead
            ? `Connect ${ready.phase.names[lead.nativeAgentId] ?? lead.displayName}`
            : chosen.length > 1
              ? `Connect ${chosen.length} Agents`
              : 'Connect',
        disabled: busy || selectedCount === 0,
        run: () => void finish(),
      };
    }
    if (state.manual) {
      return {
        label: 'Test connection',
        disabled: busy || manualIssues.length > 0,
        run: () => void startTest(manualInput(state.draft)),
      };
    }
    return {
      none: 'Picking a server tests it in place; Connect is offered once one answers.',
    };
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next && busy && ready) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-connect-source
        primaryAction={primaryAction}
        className="flex max-h-[min(760px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden rounded-md border p-0 outline-none"
        style={{ background: HUD.bg.deep, borderColor: HUD.strokeSoft }}
      >
        <DialogHeader
          className="gap-1 border-b px-5 py-4 pr-12"
          style={{ borderColor: HUD.strokeFaint }}
        >
          <DialogTitle
            className="font-display text-base"
            style={{ color: HUD.text }}
          >
            Connect a server
          </DialogTitle>
          <DialogDescription
            className="text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            Read only. Nothing on the server changes.
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4"
          ref={bodyRef}
        >
          {!resolvedBridge ? (
            <p className="text-sm" style={{ color: HUD.textDim }}>
              Connecting a server runs in the Exawatt desktop app.
            </p>
          ) : state.manual ? (
            <ManualForm
              configPresent={state.servers.configPresent}
              draft={state.draft}
              issues={manualIssues}
              onEdit={patch => dispatch({ type: 'edit-manual', patch })}
            />
          ) : (
            <ServerList
              busy={busy}
              filter={state.filter}
              incompleteIncludes={state.servers.incompleteIncludes}
              loaded={state.servers.loaded}
              configPresent={state.servers.configPresent}
              rows={rows}
              total={total}
              onFilter={text => dispatch({ type: 'filter', text })}
              onManage={onManageServer}
              onPick={alias => void startTest(aliasInput(alias))}
              onRetry={retry}
              canPick={alias => canTestServer(state, alias)}
              readyAlias={ready?.alias ?? null}
              readyPanel={readyPanel}
            />
          )}

          {state.manual ? (
            // A described server under test or failed still needs a row to
            // stand on while the form is open.
            <ul className="grid gap-0.5">
              {rows
                .filter(
                  row =>
                    row.alias === state.draft.label.trim() &&
                    row.state !== 'idle'
                )
                .map(row => (
                  <ServerRowView
                    key={row.alias}
                    row={row}
                    disabled={busy}
                    onRetry={() => retry(row.alias)}
                  >
                    {row.state === 'ready' ? readyPanel : null}
                  </ServerRowView>
                ))}
            </ul>
          ) : null}

          {serverError && (
            <p
              role="alert"
              className="text-chrome-label"
              style={{ color: HUD.red }}
            >
              {serverError}
            </p>
          )}
        </div>

        <DialogFooter
          className="items-center gap-2 border-t px-4 py-3 sm:justify-between"
          style={{ borderColor: HUD.strokeFaint }}
        >
          <div className="flex items-center gap-2">
            {resolvedBridge && state.servers.configPresent ? (
              <button
                type="button"
                data-connect-describe
                disabled={busy}
                onClick={() =>
                  dispatch({ type: 'set-manual', manual: !state.manual })
                }
                className="inline-flex h-8 items-center rounded px-2 text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:opacity-50"
                style={{ color: HUD.textDim }}
              >
                {state.manual ? 'Choose a saved server' : 'Describe a server'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy && Boolean(ready)}
              onClick={leave}
              className="inline-flex h-8 items-center rounded border px-3 text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.text, borderColor: HUD.strokeSoft }}
            >
              Cancel
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServerList({
  busy,
  filter,
  loaded,
  configPresent,
  incompleteIncludes,
  rows,
  total,
  onFilter,
  onManage,
  onPick,
  onRetry,
  canPick,
  readyAlias,
  readyPanel,
}: {
  busy: boolean;
  filter: string;
  loaded: boolean;
  configPresent: boolean;
  incompleteIncludes: boolean;
  rows: readonly ServerRow[];
  total: number;
  onFilter: (text: string) => void;
  onManage?: () => void;
  onPick: (alias: string) => void;
  onRetry: (alias: string) => void;
  canPick: (alias: string) => boolean;
  /** The server that answered, whose Agents open inline beneath it. */
  readyAlias: string | null;
  readyPanel: ReactNode;
}) {
  if (!loaded) {
    return (
      <p className="text-sm" style={{ color: HUD.textDim }}>
        Reading your SSH configuration.
      </p>
    );
  }
  if (total === 0) {
    return (
      <p className="text-sm" style={{ color: HUD.textDim }}>
        {configPresent
          ? 'No servers saved on this machine yet. Describe one instead.'
          : 'This machine has no SSH configuration yet.'}
      </p>
    );
  }
  const narrowed = filter.trim().length > 0;
  return (
    <div className="grid gap-2">
      <label
        className="flex h-9 items-center gap-2 rounded border px-3"
        style={{ borderColor: HUD.stroke, background: HUD.surfaceInput }}
      >
        <Search
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden
          style={{ color: HUD.textDim }}
        />
        <input
          aria-label="Filter servers"
          autoFocus
          data-connect-filter
          value={filter}
          onChange={event => onFilter(event.target.value)}
          onKeyDown={event => {
            // Return on a narrowed list picks the one server left, so a
            // typed name is one keystroke from its test.
            if (event.key !== 'Enter' || event.metaKey || event.ctrlKey) {
              return;
            }
            const pickable = rows.filter(row => canPick(row.alias));
            if (narrowed && pickable.length === 1 && !busy) {
              event.preventDefault();
              const only = pickable[0]!;
              if (only.state === 'failed') onRetry(only.alias);
              else onPick(only.alias);
            }
          }}
          placeholder="Filter servers"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          style={{ color: HUD.text }}
        />
        {narrowed ? (
          <span
            className="shrink-0 font-mono text-chrome-micro"
            data-connect-filter-count
            style={{ color: HUD.textDim }}
          >
            {`${rows.length} of ${total} servers`}
          </span>
        ) : null}
      </label>
      {rows.length === 0 ? (
        <p className="px-3 text-chrome-meta" style={{ color: HUD.textDim }}>
          No server matches.
        </p>
      ) : (
        <ul className="grid gap-0.5" aria-label="Servers">
          {rows.map(row => (
            <ServerRowView
              key={row.alias}
              row={row}
              disabled={busy || !canPick(row.alias)}
              onManage={onManage}
              onPick={() => onPick(row.alias)}
              onRetry={() => onRetry(row.alias)}
            >
              {row.alias === readyAlias ? readyPanel : null}
            </ServerRowView>
          ))}
        </ul>
      )}
      {incompleteIncludes && (
        <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
          Your SSH configuration includes other files Exawatt did not read.
        </p>
      )}
    </div>
  );
}

function ServerRowView({
  row,
  disabled = true,
  onManage,
  onPick,
  onRetry,
  children,
}: {
  row: ServerRow;
  disabled?: boolean;
  onManage?: () => void;
  onPick?: () => void;
  onRetry?: () => void;
  /** What opens beneath the row: the answered server's Agents. */
  children?: ReactNode;
}) {
  const mark =
    row.state === 'connected' || row.state === 'ready' ? (
      <Check className="h-3.5 w-3.5" aria-hidden style={{ color: HUD.green }} />
    ) : row.state === 'testing' ? (
      // The one moving thing on the screen, and it moves only while the round
      // trip is open. Reduced motion holds it still.
      <LoaderCircle
        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
        aria-hidden
        style={{ color: HUD.cyan }}
      />
    ) : row.state === 'failed' ? (
      <TriangleAlert
        className="h-3.5 w-3.5"
        aria-hidden
        style={{ color: HUD.amber }}
      />
    ) : (
      <Server
        className="h-3.5 w-3.5"
        aria-hidden
        style={{ color: HUD.textDim }}
      />
    );
  const text = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm" style={{ color: HUD.text }}>
        {row.alias}
      </span>
      {row.detail ? (
        <span
          className="block text-chrome-meta"
          aria-live={row.state === 'testing' ? 'polite' : undefined}
          style={{ color: row.state === 'failed' ? HUD.amber : HUD.textDim }}
        >
          {row.detail}
        </span>
      ) : null}
      {row.note ? (
        <span
          className="block font-mono text-chrome-micro"
          style={{ color: HUD.textDim }}
        >
          {row.note}
        </span>
      ) : null}
    </span>
  );
  const active =
    row.state === 'testing' || row.state === 'ready'
      ? { background: HUD.fill }
      : undefined;
  return (
    <li
      className="grid rounded"
      data-connect-server={row.alias}
      data-server-state={row.state}
      data-connected={row.state === 'connected' || undefined}
      role={row.state === 'failed' ? 'alert' : undefined}
      style={active}
    >
      <div className="flex min-h-9 items-center gap-3">
        {row.state === 'idle' && onPick ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onPick}
            className="flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded px-3 py-2 text-left outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:opacity-50"
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {mark}
            </span>
            {text}
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden
              style={{ color: HUD.textDim }}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {mark}
            </span>
            {text}
            {row.state === 'connected' ? (
              onManage ? (
                <button
                  type="button"
                  data-connect-manage
                  onClick={onManage}
                  className="shrink-0 rounded px-1 text-chrome-label underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{ color: HUD.textDim }}
                >
                  Manage
                </button>
              ) : (
                <Link
                  data-connect-manage
                  href="/settings"
                  className="shrink-0 rounded px-1 text-chrome-label underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{ color: HUD.textDim }}
                >
                  Manage
                </Link>
              )
            ) : null}
            {row.state === 'failed' && onRetry ? (
              <button
                type="button"
                data-connect-retry
                disabled={disabled}
                onClick={onRetry}
                className="inline-flex h-8 shrink-0 items-center rounded border px-3 text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:opacity-50"
                style={{ color: HUD.text, borderColor: HUD.strokeSoft }}
              >
                Try again
              </button>
            ) : null}
          </div>
        )}
      </div>
      {children ? <ReadyScroll>{children}</ReadyScroll> : null}
    </li>
  );
}

/**
 * The answered server's Agents, brought into view as they open. In a long
 * list the ready row can sit below the fold, and a Connect button for Agents
 * the operator cannot see is a button they cannot judge.
 */
function ReadyScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div className="px-3 pt-1 pb-3" ref={ref}>
      {children}
    </div>
  );
}

function ManualForm({
  configPresent,
  draft,
  issues,
  onEdit,
}: {
  configPresent: boolean;
  draft: ManualServerDraft;
  /** What the draft still needs. The model already names each one. */
  issues: readonly ConnectIssue[];
  onEdit: (patch: Partial<ManualServerDraft>) => void;
}) {
  return (
    <div className="grid gap-3">
      {!configPresent && (
        <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
          This machine has no SSH configuration yet. Describe the server and
          Exawatt connects over SSH.
        </p>
      )}
      <ManualField
        id="connect-server-label"
        label="Name"
        value={draft.label}
        autoFocus
        onChange={value => onEdit({ label: value })}
      />
      <ManualField
        id="connect-server-host"
        label="Address"
        value={draft.host}
        onChange={value => onEdit({ host: value })}
      />
      <ManualField
        id="connect-server-user"
        label="SSH user"
        value={draft.user}
        onChange={value => onEdit({ user: value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <ManualField
          id="connect-server-port"
          label="SSH port"
          value={String(draft.port)}
          inputMode="numeric"
          onChange={value => onEdit({ port: toPort(value) })}
        />
        <ManualField
          id="connect-server-gateway-port"
          label="Gateway port"
          value={String(draft.gatewayPort)}
          inputMode="numeric"
          onChange={value => onEdit({ gatewayPort: toPort(value) })}
        />
      </div>
      <ManualField
        id="connect-server-identity"
        label="Key file"
        value={draft.identityFile}
        onChange={value => onEdit({ identityFile: value })}
      />
      {issues.length > 0 && (
        <ul className="grid gap-0.5" data-manual-issues>
          {issues.map(entry => (
            <li
              className="text-chrome-meta"
              key={entry.code}
              style={{ color: HUD.textDim }}
            >
              {entry.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        These details go to your keychain. Leave the key file empty to use your
        SSH default.
      </p>
    </div>
  );
}

function ManualField({
  id,
  label,
  value,
  autoFocus,
  inputMode,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  autoFocus?: boolean;
  inputMode?: 'numeric';
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <label
        htmlFor={id}
        className="text-chrome-meta"
        style={{ color: HUD.textDim }}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        // The modal opens on this form, so focus belongs on its first field,
        // the way the Project opener's search field takes it.
        autoFocus={autoFocus}
        inputMode={inputMode}
        onChange={event => onChange(event.target.value)}
        className="h-9 min-w-0 rounded border px-3 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: HUD.text,
          borderColor: HUD.strokeSoft,
          background: HUD.surfaceInput,
        }}
      />
    </div>
  );
}

function toPort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ReadyPanel({
  attempt,
  issues,
  mappingError,
  project,
  projects,
  onToggle,
  onRename,
  onProject,
}: {
  attempt: ConnectAttempt;
  issues: readonly ConnectIssue[];
  mappingError: string | null;
  project: ProjectTarget;
  projects: readonly ConnectProjectOption[];
  onToggle: (nativeAgentId: string) => void;
  onRename: (nativeAgentId: string, name: string | null) => void;
  onProject: (project: ProjectTarget) => void;
}) {
  if (attempt.phase.kind !== 'ready') return null;
  const { agents, selected, names, facts } = attempt.phase;
  const { configured, retired } = partitionAgents(agents);
  const flowIssues = issues.filter(entry => entry.nativeAgentId === null);
  return (
    <div className="grid gap-4" data-connect-ready={attempt.alias}>
      <AgentGroup
        heading={`Agents on ${attempt.alias}`}
        agents={configured}
        selected={selected}
        names={names}
        issues={issues}
        onToggle={onToggle}
        onRename={onRename}
      />
      {retired.length > 0 && (
        <div
          className="grid gap-2 border-t pt-3"
          style={{ borderColor: HUD.strokeFaint }}
        >
          <AgentGroup
            heading="Retired on this server"
            agents={retired}
            selected={selected}
            names={names}
            issues={issues}
            onToggle={onToggle}
            onRename={onRename}
          />
          <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
            These join your roster when you choose them.
          </p>
        </div>
      )}

      <ProjectChoice
        project={project}
        projects={projects}
        onProject={onProject}
      />

      {/* Identity, version, placement, credentials, and capabilities, kept
          apart as the Connect contract requires, one disclosure away. */}
      <details data-connect-facts className="group">
        <summary
          className="w-fit cursor-pointer rounded px-1 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{ color: HUD.textDim }}
        >
          Connection details
        </summary>
        <dl className="mt-2 grid gap-1.5">
          {facts.map(fact => (
            <div key={fact.id} className="flex items-baseline gap-3">
              <dt
                className="w-28 shrink-0 text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {fact.label}
              </dt>
              <dd
                className="min-w-0 text-chrome-label"
                style={{ color: HUD.text }}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {[...flowIssues.map(entry => entry.message), mappingError]
        .filter((message): message is string => Boolean(message))
        .map(message => (
          <p
            key={message}
            role="alert"
            className="text-chrome-label"
            style={{ color: HUD.red }}
          >
            {message}
          </p>
        ))}
    </div>
  );
}

function AgentGroup({
  heading,
  agents,
  selected,
  names,
  issues,
  onToggle,
  onRename,
}: {
  heading: string;
  agents: readonly DiscoveredAgent[];
  selected: ReadonlySet<string>;
  names: Readonly<Record<string, string | null>>;
  issues: readonly ConnectIssue[];
  onToggle: (nativeAgentId: string) => void;
  onRename: (nativeAgentId: string, name: string | null) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <section className="grid gap-1">
      <h3 className="text-chrome-meta" style={{ color: HUD.textDim }}>
        {heading}
      </h3>
      {agents.length === 0 ? (
        <p className="text-sm" style={{ color: HUD.textDim }}>
          This server configures no Agents yet.
        </p>
      ) : (
        agents.map(agent => {
          const checked = selected.has(agent.nativeAgentId);
          const shown = names[agent.nativeAgentId] ?? agent.displayName;
          const rowIssues = issues.filter(
            entry => entry.nativeAgentId === agent.nativeAgentId
          );
          const nameId = `connect-name-${agent.nativeAgentId}`;
          return (
            <div
              key={agent.nativeAgentId}
              className="grid gap-1"
              data-connect-agent={agent.nativeAgentId}
            >
              <div className="flex min-h-9 items-center gap-3 rounded px-3 py-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`Connect ${shown}`}
                  onClick={() => onToggle(agent.nativeAgentId)}
                  className="grid h-4 w-4 shrink-0 place-items-center border outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{
                    borderColor: checked ? HUD.cyan : HUD.textDim,
                    color: HUD.cyan,
                  }}
                >
                  {checked && <Check className="h-3 w-3" aria-hidden />}
                </button>
                <SourceIdentityMark color={OPENCLAW_COLOR}>
                  <OpenClawIcon size={12} />
                </SourceIdentityMark>
                <span className="min-w-0 flex-1">
                  {renaming === agent.nativeAgentId ? (
                    <input
                      id={nameId}
                      aria-label={`Name for ${agent.displayName}`}
                      autoFocus
                      defaultValue={names[agent.nativeAgentId] ?? ''}
                      placeholder={agent.displayName}
                      onBlur={event => {
                        onRename(agent.nativeAgentId, event.target.value);
                        setRenaming(null);
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.metaKey) {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === 'Escape') {
                          // Escape leaves the rename, not the dialog.
                          event.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="h-7 w-full min-w-0 rounded border px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                      style={{
                        color: HUD.text,
                        borderColor: HUD.strokeSoft,
                        background: HUD.surfaceInput,
                      }}
                    />
                  ) : (
                    <span
                      className="flex items-center gap-2 text-sm"
                      style={{ color: HUD.text }}
                    >
                      <span className="truncate">{shown}</span>
                      <button
                        type="button"
                        aria-label={`Rename ${shown}`}
                        data-connect-rename={agent.nativeAgentId}
                        onClick={() => setRenaming(agent.nativeAgentId)}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                        style={{ color: HUD.textDim }}
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  )}
                  <span
                    className="block truncate text-chrome-meta"
                    style={{ color: HUD.textDim }}
                  >
                    {agent.hasPrimaryConversation
                      ? 'Conversation'
                      : 'No conversation yet'}
                    {' · '}
                    {agent.contextCount === 1
                      ? '1 context'
                      : `${agent.contextCount} contexts`}
                    {names[agent.nativeAgentId]
                      ? ` · the server calls it ${agent.displayName}`
                      : ''}
                  </span>
                </span>
              </div>
              {rowIssues.map(entry => (
                <p
                  key={entry.message}
                  role="alert"
                  className="px-3 text-chrome-label"
                  style={{ color: HUD.red }}
                >
                  {entry.message}
                </p>
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}

function ProjectChoice({
  project,
  projects,
  onProject,
}: {
  project: ProjectTarget;
  projects: readonly ConnectProjectOption[];
  onProject: (project: ProjectTarget) => void;
}) {
  return (
    <div className="grid gap-2" data-connect-project>
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="connect-project"
          className="text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          Add to
        </label>
        <select
          id="connect-project"
          value={
            project.kind === 'new-project' ? 'new-project' : project.projectId
          }
          onChange={event =>
            onProject(
              event.target.value === 'new-project'
                ? {
                    kind: 'new-project',
                    name:
                      project.kind === 'new-project'
                        ? project.name
                        : DEFAULT_REMOTE_PROJECT_NAME,
                  }
                : { kind: 'existing-project', projectId: event.target.value }
            )
          }
          className="h-8 min-w-0 rounded border px-2 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{
            color: HUD.text,
            borderColor: HUD.strokeSoft,
            background: HUD.surfaceInput,
          }}
        >
          <option value="new-project">New Project</option>
          {projects.map(option => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {project.kind === 'new-project' ? (
          <input
            aria-label="Project name"
            value={project.name}
            onChange={event =>
              onProject({ kind: 'new-project', name: event.target.value })
            }
            className="h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              color: HUD.text,
              borderColor: HUD.strokeSoft,
              background: HUD.surfaceInput,
            }}
          />
        ) : null}
      </div>
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        Names and Projects live in Exawatt. The server keeps its own.
      </p>
    </div>
  );
}
