'use client';

/**
 * Connect existing Agent (ENG-010 C2).
 *
 * The surface for `connect-source-model.ts`. It renders the step the model is
 * on and reports what the operator did; it decides no policy of its own. The
 * house dialog contract applies: Radix primitives through `@/components/ui`,
 * one declared primary action per step with its chord printed on its face,
 * Cancel to its left, full keyboard operation, and visible focus.
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
  ArrowLeft,
  Check,
  Circle,
  LoaderCircle,
  Server,
  TriangleAlert,
} from 'lucide-react';
import { OpenClawIcon } from './harness-icons';
import { SourceIdentityMark } from './source-identity-mark';
import { WORKSPACE_HUD as HUD } from './workspace-theme';
import {
  CONNECT_FAILURE_COPY,
  CONNECT_STAGES,
  CONNECT_STAGE_COPY,
  DEFAULT_GATEWAY_PORT,
  canGoBack,
  cancelConnectFlow,
  connectFlowReducer,
  connectionFacts,
  credentialOwnerForTransport,
  existingSourceIdForAlias,
  initialConnectFlowState,
  partitionAgents,
  placementForTransport,
  resolvedDisplayName,
  saveConnectFlow,
  stageForPhase,
  validateManualDraft,
  type AgentMappingRow,
  type ConnectIssue,
  type ConnectStage,
  type ConnectStep,
  type ConnectionFact,
  type DiscoveredAgent,
  type ManualServerDraft,
  type ObservedSourceFacts,
  type ProjectTarget,
} from './connect-source-model';

/** OpenClaw's brand color, from `contracts/agent-sources.json`. */
const OPENCLAW_COLOR = '#8BB9ED';

export interface ConnectProjectOption {
  id: string;
  name: string;
}

export interface ConnectedAgentMapping {
  nativeAgentId: string;
  /** The name Exawatt shows. The source keeps its own. */
  displayName: string;
  project: ProjectTarget;
}

export interface ConnectSourceResult {
  sourceId: string;
  /** The Agent to open once the roster has it. */
  openAgentId: string | null;
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
    | { ok: true; source: { id: string } | null }
    | { ok: false; issues: readonly string[] }
  >;
  /** Bounded test plus read-only discovery. Answers once, at the end. */
  connect(sourceId: string): Promise<ConnectAttemptResult>;
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
    connect: sourceId => api.connect(sourceId),
    // Older bridges predate the channel. A dialog with no progress still
    // connects; it just cannot tick, so this degrades rather than throwing.
    onSourceChanged: handler =>
      typeof api.onChanged === 'function' ? api.onChanged(handler) : () => {},
    detach: sourceId => api.detach(sourceId),
  };
}

export function ConnectSourceDialog({
  open,
  onOpenChange,
  projects = [],
  bridge,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects an imported Agent can join. */
  projects?: readonly ConnectProjectOption[];
  /** Defaults to the Electron bridge; injected in tests and previews. */
  bridge?: ConnectSourceBridge | null;
  /** The saved source and its Project mapping, once the operator confirms. */
  onConnected?: (result: ConnectSourceResult) => void;
}) {
  const [state, dispatch] = useReducer(
    connectFlowReducer,
    undefined,
    initialConnectFlowState
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const aliasesRequested = useRef(false);
  /** The step's own content, so focus can follow a step change into it. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const retainedDraft = useRef<ManualServerDraft | null>(null);
  /** Bumped whenever a result in flight stops being the one on screen. */
  const attempt = useRef(0);

  const resolvedBridge = useMemo(
    () => (bridge === undefined ? electronBridge() : bridge),
    [bridge]
  );
  const bridgeRef = useRef(resolvedBridge);
  bridgeRef.current = resolvedBridge;

  const step = state.step;
  /** The source under test, read from inside a subscription that outlives it. */
  const pendingSourceId = useRef<string | null>(null);
  pendingSourceId.current = state.pendingSourceId;
  const knownProjectIds = useMemo(
    () => projects.map(project => project.id),
    [projects]
  );

  const leave = useCallback(() => onOpenChange(false), [onOpenChange]);

  /**
   * Closing is the only cancel path, whichever control reached it: the
   * button, Escape, or the host. Leaving releases the record this flow
   * created so a server the operator walked away from is not left half
   * connected, and touches nothing on the server itself.
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
    attempt.current += 1;
    aliasesRequested.current = false;
    retainedDraft.current = outcome.retainedDraft;
    if (outcome.releaseSourceId) {
      void bridgeRef.current?.detach(outcome.releaseSourceId).catch(() => {});
    }
    setServerError(null);
    setBusy(false);
    dispatch({ type: 'cancel' });
  }, [open, state]);

  // The operator's own typing comes back with them. An alias they merely
  // clicked leaves nothing to restore, so reopening starts clean.
  useEffect(() => {
    if (!open) return;
    const draft = retainedDraft.current;
    if (!draft) return;
    retainedDraft.current = null;
    dispatch({ type: 'choose-adapter', adapterId: 'openclaw' });
    dispatch({ type: 'set-manual', manual: true });
    dispatch({ type: 'edit-manual', patch: draft });
  }, [open]);

  // Alias enumeration reads local configuration only, and only once the
  // operator has asked for the server step.
  useEffect(() => {
    if (!open || step.kind !== 'choose-server' || aliasesRequested.current) {
      return;
    }
    const api = bridgeRef.current;
    if (!api) return;
    aliasesRequested.current = true;
    const token = attempt.current;
    void api
      .sshAliases()
      .then(result => {
        if (token !== attempt.current) return;
        dispatch({
          type: 'aliases-loaded',
          aliases: result.aliases,
          configPresent: result.configPresent,
          incompleteIncludes: result.incompleteIncludes,
        });
      })
      .catch(() => {
        if (token !== attempt.current) return;
        dispatch({
          type: 'aliases-loaded',
          aliases: [],
          configPresent: false,
          incompleteIncludes: false,
        });
      });
  }, [open, step.kind]);

  /**
   * The bounded test ticks from main's own connection channel.
   *
   * Subscribed for as long as the dialog is open, which is what makes the
   * first stage real: the tunnel phase is broadcast before `connect` resolves
   * and often before the operator's click has finished settling, so a
   * subscription taken when the test starts would miss the one stage that
   * takes the longest.
   *
   * Two filters keep somebody else's server off this screen. The change has
   * to name the source this flow is testing, and the reducer accepts a stage
   * only while the flow is standing on the bounded test, so a reconnect
   * ladder running behind Settings cannot drive the checklist.
   */
  useEffect(() => {
    if (!open || !resolvedBridge) return;
    return resolvedBridge.onSourceChanged(change => {
      if (change.sourceId !== pendingSourceId.current) return;
      const stage = stageForPhase(change.phase);
      if (stage === null) return;
      dispatch({ type: 'test-stage', stage });
    });
  }, [open, resolvedBridge]);

  const observe = useCallback(
    async (input: {
      sourceId: string;
      placement: AgentSourcePlacement;
      credentialOwner: SourceCredentialOwner;
      token: number;
    }) => {
      const api = bridgeRef.current;
      if (!api) return;
      try {
        const result = await api.connect(input.sourceId);
        if (input.token !== attempt.current) return;
        if (result.ok) {
          dispatch({
            type: 'agents-discovered',
            agents: result.agents,
            facts: connectionFacts({
              observed: result.observed ?? null,
              placement: input.placement,
              credentialOwner: input.credentialOwner,
            }),
          });
          return;
        }
        dispatch({
          type: 'test-failed',
          failure: result.failure ?? 'unknown',
          message: result.message,
        });
      } catch {
        if (input.token !== attempt.current) return;
        dispatch({
          type: 'test-failed',
          failure: 'unknown',
          message: '',
        });
      } finally {
        if (input.token === attempt.current) setBusy(false);
      }
    },
    []
  );

  const startTest = useCallback(
    async (input: {
      alias: string;
      displayName: string;
      transport: SourceTransport;
      operatorAuthored: boolean;
    }) => {
      const api = bridgeRef.current;
      if (!api || busy) return;
      const placement = placementForTransport(input.transport.kind);
      const credentialOwner = credentialOwnerForTransport(input.transport.kind);
      setServerError(null);
      setBusy(true);
      const token = ++attempt.current;
      let sourceId = existingSourceIdForAlias(state, input.alias);
      if (!sourceId) {
        try {
          const added = await api.add({
            adapterId: 'openclaw',
            placement,
            displayName: input.displayName,
            transport: input.transport,
            credentialOwner,
          });
          if (token !== attempt.current) return;
          sourceId = added.ok && added.source ? added.source.id : null;
        } catch {
          sourceId = null;
        }
        if (token !== attempt.current) return;
        if (!sourceId) {
          setServerError(
            'Exawatt could not save this server. Check the details and try again.'
          );
          setBusy(false);
          return;
        }
      }
      dispatch({
        type: 'test-started',
        alias: input.alias,
        sourceId,
        operatorAuthored: input.operatorAuthored,
      });
      await observe({ sourceId, placement, credentialOwner, token });
    },
    [busy, observe, state]
  );

  const retry = useCallback(() => {
    if (step.kind !== 'failed') return;
    const sourceId = state.pendingSourceId;
    if (!sourceId) return;
    setBusy(true);
    const token = ++attempt.current;
    dispatch({
      type: 'test-started',
      alias: step.alias,
      sourceId,
      operatorAuthored: state.operatorAuthored,
    });
    void observe({
      sourceId,
      placement: 'customer-hosted',
      credentialOwner: state.operatorAuthored
        ? 'exawatt-keychain'
        : 'source-owned-ssh',
      token,
    });
  }, [observe, state.operatorAuthored, state.pendingSourceId, step]);

  /**
   * Saving runs the machine's own decision rather than a second copy of it:
   * `saveConnectFlow` is the same function the reducer consults, so a mapping
   * this surface hands on is exactly a mapping the model accepted.
   *
   * Success closes through to the Agent. There is no confirmation screen to
   * land on, because the operator asked to open a coworker and a page that
   * says "Connected." with a Done button on it is one keystroke standing
   * between them and the person they came to see.
   */
  const finish = useCallback(() => {
    if (step.kind !== 'map-projects') return;
    const outcome = saveConnectFlow(state, knownProjectIds);
    dispatch({ type: 'save', knownProjectIds });
    if (!outcome.ok) return;
    onConnected?.({
      sourceId: outcome.sourceId,
      openAgentId: outcome.openAgentId,
      agents: outcome.rows.map(row => ({
        nativeAgentId: row.nativeAgentId,
        displayName: resolvedDisplayName(row),
        project: row.project,
      })),
    });
    onOpenChange(false);
  }, [knownProjectIds, onConnected, onOpenChange, state, step]);

  const manualIssues =
    step.kind === 'choose-server' && step.manual
      ? validateManualDraft(step.draft)
      : [];

  /**
   * Focus follows the step.
   *
   * Each step replaces the whole body, which destroys whatever the operator
   * had focused. Radix then falls back to the dialog element itself, which
   * paints the browser's own focus ring around the entire modal and leaves
   * Tab starting from the footer rather than from the step's own controls.
   * Moving focus to the first control of the new step is both the keyboard
   * path and the fix for the ring.
   */
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (!body) return;
    // Only when focus is orphaned. Keying on the step alone was not enough:
    // the server step renders empty and fills in when the alias read answers,
    // so the one pass happened while there was nothing to focus. Running on
    // every step update is safe because focus already inside the step is left
    // exactly where the operator put it.
    const active = document.activeElement;
    if (active instanceof HTMLElement && body.contains(active)) return;
    const first = body.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    // A step with nothing to press (the bounded test) keeps focus in the
    // dialog so Escape still cancels; it just does not steal it back.
    first?.focus();
  }, [open, step]);

  const primaryAction = (() => {
    switch (step.kind) {
      case 'choose-source':
        return {
          none: 'Choosing a source is a chooser rather than a form: each row is its own action.',
        };
      case 'choose-server':
        if (!step.manual) {
          return {
            none: 'The alias list is a chooser: each server is its own action.',
          };
        }
        return {
          label: 'Test connection',
          disabled: busy || manualIssues.length > 0,
          run: () => {
            const draft = step.draft;
            void startTest({
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
            });
          },
        };
      case 'testing':
        return {
          none: 'The connection test is already running. Cancel is the only action here, and a default button would press it by accident.',
        };
      case 'failed':
        return { label: 'Try again', disabled: busy, run: retry };
      case 'choose-agents':
        return {
          label: 'Continue',
          disabled: step.selected.size === 0,
          run: () => dispatch({ type: 'to-mapping' }),
        };
      case 'map-projects': {
        const lead = step.rows[0];
        return {
          label: lead
            ? `Connect and open ${resolvedDisplayName(lead)}`
            : 'Connect',
          run: finish,
        };
      }
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-connect-source
        primaryAction={primaryAction}
        className="max-h-[min(760px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-md border p-0 outline-none"
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
            Connect existing Agent
          </DialogTitle>
          <DialogDescription
            className="text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {describeStep(step.kind)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" ref={bodyRef}>
          {step.kind === 'choose-source' && (
            <SourceChooser
              available={resolvedBridge !== null}
              onChoose={() =>
                dispatch({ type: 'choose-adapter', adapterId: 'openclaw' })
              }
            />
          )}

          {step.kind === 'choose-server' && (
            <ServerChooser
              aliases={step.aliases}
              configPresent={step.configPresent}
              incompleteIncludes={step.incompleteIncludes}
              manual={step.manual}
              draft={step.draft}
              busy={busy}
              error={serverError}
              issues={manualIssues}
              onSetManual={manual => dispatch({ type: 'set-manual', manual })}
              onEdit={patch => dispatch({ type: 'edit-manual', patch })}
              onChooseAlias={alias =>
                void startTest({
                  alias: alias.alias,
                  displayName: alias.alias,
                  transport: {
                    kind: 'ssh-alias',
                    alias: alias.alias,
                    remotePort: DEFAULT_GATEWAY_PORT,
                  },
                  operatorAuthored: false,
                })
              }
            />
          )}

          {step.kind === 'testing' && (
            <div className="grid gap-3">
              <p className="text-sm" style={{ color: HUD.text }}>
                {step.alias}
              </p>
              <StageList stage={step.stage} outcome="running" />
            </div>
          )}

          {step.kind === 'failed' && (
            <FailureReport
              alias={step.alias}
              stage={step.stage}
              failure={step.failure}
              message={step.message}
            />
          )}

          {step.kind === 'choose-agents' && (
            <AgentChooser
              alias={step.alias}
              agents={step.agents}
              selected={step.selected}
              facts={step.facts}
              onToggle={nativeAgentId =>
                dispatch({ type: 'toggle-agent', nativeAgentId })
              }
            />
          )}

          {step.kind === 'map-projects' && (
            <ProjectMapper
              rows={step.rows}
              projects={projects}
              issues={state.issues}
              onEdit={(nativeAgentId, patch) =>
                dispatch({ type: 'edit-mapping', nativeAgentId, patch })
              }
            />
          )}
        </div>

        <DialogFooter
          className="items-center gap-2 border-t px-4 py-3 sm:justify-between"
          style={{ borderColor: HUD.strokeFaint }}
        >
          <div className="flex items-center gap-2">
            {canGoBack(state) && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'back' })}
                className="inline-flex h-8 items-center gap-2 rounded px-2 text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
              </button>
            )}
            <button
              type="button"
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

function describeStep(kind: ConnectStep['kind']): string {
  switch (kind) {
    case 'choose-source':
    case 'testing':
      return 'Read only. Nothing on the server changes.';
    case 'choose-server':
      return 'Exawatt reaches a server only once you choose it.';
    case 'failed':
      return 'The server keeps running its own work.';
    case 'choose-agents':
      return 'Configured Agents are selected.';
    case 'map-projects':
      return 'Names and Projects live in Exawatt. The server keeps its own.';
  }
}

function SourceChooser({
  available,
  onChoose,
}: {
  available: boolean;
  onChoose: () => void;
}) {
  if (!available) {
    return (
      <p className="text-sm" style={{ color: HUD.textDim }}>
        Connecting a server runs in the Exawatt desktop app.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex w-full min-w-0 items-center gap-3 rounded-md border p-3 text-left outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
      style={{
        borderColor: HUD.strokeFaint,
        background: HUD.surfaceInputSoft,
      }}
    >
      <SourceIdentityMark color={OPENCLAW_COLOR}>
        <OpenClawIcon size={12} />
      </SourceIdentityMark>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium" style={{ color: HUD.text }}>
          OpenClaw
        </span>
        <span className="block text-chrome-meta" style={{ color: HUD.textDim }}>
          Gateway on a server you host
        </span>
      </span>
    </button>
  );
}

function ServerChooser({
  aliases,
  configPresent,
  incompleteIncludes,
  manual,
  draft,
  busy,
  error,
  issues,
  onSetManual,
  onEdit,
  onChooseAlias,
}: {
  aliases: readonly SshHostAlias[];
  configPresent: boolean;
  incompleteIncludes: boolean;
  manual: boolean;
  draft: ManualServerDraft;
  busy: boolean;
  error: string | null;
  /** What the draft still needs. The model already names each one. */
  issues: readonly ConnectIssue[];
  onSetManual: (manual: boolean) => void;
  onEdit: (patch: Partial<ManualServerDraft>) => void;
  onChooseAlias: (alias: SshHostAlias) => void;
}) {
  return (
    <div className="grid gap-3">
      {manual ? (
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
            // The model has always computed these and the surface only used
            // them to disable the button, which left the operator looking at
            // a dead primary action with no reason on screen.
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
            These details go to your keychain. Leave the key file empty to use
            your SSH default.
          </p>
        </div>
      ) : (
        <>
          {aliases.length === 0 ? (
            <p className="text-sm" style={{ color: HUD.textDim }}>
              {configPresent
                ? 'No servers saved on this machine yet.'
                : 'Reading your SSH configuration.'}
            </p>
          ) : (
            <div className="grid gap-1">
              {/* The list is a chooser, so it says what choosing does.
                  Without a heading it is three bare names under a caption
                  about privacy, and the operator has to guess the verb. */}
              <h3
                className="px-3 pb-1 text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                Choose a server
              </h3>
              {aliases.map(alias => (
                <button
                  key={alias.alias}
                  type="button"
                  disabled={busy}
                  onClick={() => onChooseAlias(alias)}
                  className="flex min-h-9 min-w-0 items-center gap-3 rounded px-3 py-2 text-left outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:opacity-50"
                >
                  <Server
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden
                    style={{ color: HUD.textDim }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm"
                      style={{ color: HUD.text }}
                    >
                      {alias.alias}
                    </span>
                    <span
                      className="mt-0.5 flex flex-wrap gap-1.5 font-mono text-chrome-micro"
                      style={{ color: HUD.textDim }}
                    >
                      {declaredKeywords(alias).map(keyword => (
                        <span
                          key={keyword}
                          className="rounded border px-1.5 py-0.5"
                          style={{ borderColor: HUD.strokeFaint }}
                        >
                          {keyword}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {incompleteIncludes && (
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              Your SSH configuration includes other files Exawatt did not read.
            </p>
          )}
        </>
      )}

      {configPresent && (
        <div>
          {/* With no saved servers to choose from, describing one IS the path,
              so it wears a control's border rather than sitting under a
              negative sentence as a text link the operator has to find. */}
          <button
            type="button"
            onClick={() => onSetManual(!manual)}
            className="inline-flex h-9 items-center rounded border px-3 text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              color: !manual && aliases.length === 0 ? HUD.text : HUD.textDim,
              borderColor:
                !manual && aliases.length === 0
                  ? HUD.strokeSoft
                  : 'transparent',
            }}
          >
            {manual ? 'Choose a saved server' : 'Describe a server instead'}
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="text-chrome-label"
          style={{ color: HUD.red }}
        >
          {error}
        </p>
      )}
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

/**
 * Which keywords the operator's own Host block declares. Never their values:
 * those are read in Electron main and never cross the bridge.
 */
function declaredKeywords(alias: SshHostAlias): string[] {
  const keywords: string[] = [];
  if (alias.hasHostName) keywords.push('Hostname');
  if (alias.hasUser) keywords.push('User');
  if (alias.hasIdentityFile) keywords.push('Key file');
  if (keywords.length === 0) keywords.push('Defaults from your SSH config');
  return keywords;
}

function toPort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The bounded test, stage by stage.
 *
 * Naming the stage in progress is the point: a bare spinner would leave the
 * operator guessing which half of the handshake is slow, and the tunnel is
 * usually the slow half. The stages here are the session's own phases, so
 * this list moves because the connection moved and for no other reason.
 *
 * `outcome` decides what the row the flow stopped on means. While the test
 * runs it is the step in progress and turns; once it has failed it is the
 * step that failed and holds still, so the operator reads the report against
 * the point the connection actually reached.
 */
function StageList({
  stage,
  outcome,
}: {
  stage: ConnectStage;
  outcome: 'running' | 'failed';
}) {
  const current = CONNECT_STAGES.indexOf(stage);
  const failed = outcome === 'failed';
  return (
    <ol
      className="grid gap-1.5"
      // Live only while it is live. The failure screen is already an alert,
      // and a frozen list inside it announcing itself a second time would
      // read the whole checklist back over the sentence that matters.
      aria-live={failed ? undefined : 'polite'}
      data-connect-stages={outcome}
    >
      {CONNECT_STAGES.map((entry, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={entry}
            data-stage={entry}
            data-stage-state={
              active
                ? failed
                  ? 'failed'
                  : 'active'
                : done
                  ? 'done'
                  : 'waiting'
            }
            aria-current={active ? 'step' : undefined}
            className="flex items-center gap-2 text-chrome-label"
            style={{ color: active || done ? HUD.text : HUD.textDim }}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {done ? (
                <Check
                  className="h-3 w-3"
                  aria-hidden
                  style={{ color: HUD.green }}
                />
              ) : active && failed ? (
                <TriangleAlert
                  className="h-3 w-3"
                  aria-hidden
                  style={{ color: HUD.amber }}
                />
              ) : active ? (
                // The one moving thing on the screen, and it moves only while
                // the round trip is actually open. Reduced motion renders the
                // same mark held still.
                <LoaderCircle
                  className="h-3 w-3 animate-spin motion-reduce:animate-none"
                  aria-hidden
                  style={{ color: HUD.cyan }}
                />
              ) : (
                <Circle
                  className="h-2 w-2"
                  aria-hidden
                  style={{ color: HUD.idle, fill: 'transparent' }}
                />
              )}
            </span>
            {CONNECT_STAGE_COPY[entry]}
            {/* Shape and icon already separate the four row states; this is
                the third channel, so none of it is carried by hue alone. */}
            {active && failed && (
              <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
                did not complete
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function FailureReport({
  alias,
  stage,
  failure,
  message,
}: {
  alias: string;
  stage: ConnectStage;
  failure: SourceFailureClass;
  message: string;
}) {
  const copy = CONNECT_FAILURE_COPY[failure];
  return (
    <div className="grid gap-3" role="alert">
      <div className="grid gap-2">
        {/* Which server. A operator with several saved servers reads this
            screen after a wait and otherwise cannot tell which one failed. */}
        <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
          {alias}
        </p>
        <p className="text-base font-semibold" style={{ color: HUD.text }}>
          {copy.headline}
        </p>
        <p className="text-sm" style={{ color: HUD.text }}>
          {copy.nextStep}
        </p>
        {message && (
          <p
            className="font-mono text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {message}
          </p>
        )}
      </div>
      {/* The checklist the operator was already reading, held at the step it
          stopped on. How far the connection got is half the diagnosis, and
          resetting it to the first step would throw that half away. */}
      <StageList stage={stage} outcome="failed" />
    </div>
  );
}

function AgentChooser({
  alias,
  agents,
  selected,
  facts,
  onToggle,
}: {
  alias: string;
  agents: readonly DiscoveredAgent[];
  selected: ReadonlySet<string>;
  facts: readonly ConnectionFact[];
  onToggle: (nativeAgentId: string) => void;
}) {
  const { configured, retired } = partitionAgents(agents);
  return (
    <div className="grid gap-4">
      {/* The connected server, so the facts beneath it have a subject. */}
      <p className="text-sm font-medium" style={{ color: HUD.text }}>
        {alias}
      </p>
      <dl className="grid gap-1.5">
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

      <AgentGroup
        heading="Agents"
        agents={configured}
        selected={selected}
        onToggle={onToggle}
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
            onToggle={onToggle}
          />
          <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
            These join your roster when you choose them.
          </p>
        </div>
      )}
    </div>
  );
}

function AgentGroup({
  heading,
  agents,
  selected,
  onToggle,
}: {
  heading: string;
  agents: readonly DiscoveredAgent[];
  selected: ReadonlySet<string>;
  onToggle: (nativeAgentId: string) => void;
}) {
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
          return (
            <button
              key={agent.nativeAgentId}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => onToggle(agent.nativeAgentId)}
              className="flex min-h-9 min-w-0 items-center gap-3 rounded px-3 py-2 text-left outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
            >
              <span
                className="grid h-4 w-4 shrink-0 place-items-center border"
                style={{
                  borderColor: checked ? HUD.cyan : HUD.textDim,
                  color: HUD.cyan,
                }}
              >
                {checked && <Check className="h-3 w-3" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm"
                  style={{ color: HUD.text }}
                >
                  {agent.displayName}
                </span>
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
                </span>
              </span>
            </button>
          );
        })
      )}
    </section>
  );
}

function ProjectMapper({
  rows,
  projects,
  issues,
  onEdit,
}: {
  rows: readonly AgentMappingRow[];
  projects: readonly ConnectProjectOption[];
  issues: readonly ConnectIssue[];
  onEdit: (
    nativeAgentId: string,
    patch: { nameOverride?: string | null; project?: ProjectTarget }
  ) => void;
}) {
  return (
    <div className="grid gap-4">
      {rows.map(row => {
        const rowIssues = issues.filter(
          entry => entry.nativeAgentId === row.nativeAgentId
        );
        const nameId = `connect-name-${row.nativeAgentId}`;
        const projectId = `connect-project-${row.nativeAgentId}`;
        const projectNameId = `connect-project-name-${row.nativeAgentId}`;
        return (
          <div
            key={row.nativeAgentId}
            className="grid gap-3 rounded-md border p-4"
            style={{
              borderColor: HUD.strokeFaint,
              background: HUD.surfaceInputSoft,
            }}
          >
            {/* Three identical forms stacked with the Agent's name only in a
                placeholder is unreadable at a glance. The card says whose
                settings these are. */}
            <h3
              className="text-chrome-title font-medium"
              style={{ color: HUD.text }}
            >
              {resolvedDisplayName(row)}
            </h3>
            <div className="grid gap-1">
              <label
                htmlFor={nameId}
                className="text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                Name
              </label>
              <input
                id={nameId}
                value={row.nameOverride ?? ''}
                placeholder={row.sourceName}
                onChange={event =>
                  onEdit(row.nativeAgentId, {
                    nameOverride: event.target.value,
                  })
                }
                className="h-9 min-w-0 rounded border px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeSoft,
                  background: HUD.surfaceInput,
                }}
              />
              <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {`The server calls it ${row.sourceName}.`}
              </p>
            </div>

            <div className="grid gap-1">
              <label
                htmlFor={projectId}
                className="text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                Project
              </label>
              <select
                id={projectId}
                value={
                  row.project.kind === 'new-project'
                    ? 'new-project'
                    : row.project.projectId
                }
                onChange={event =>
                  onEdit(row.nativeAgentId, {
                    project:
                      event.target.value === 'new-project'
                        ? {
                            kind: 'new-project',
                            name: row.nameOverride ?? row.sourceName,
                          }
                        : {
                            kind: 'existing-project',
                            projectId: event.target.value,
                          },
                  })
                }
                className="h-9 min-w-0 rounded border px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeSoft,
                  background: HUD.surfaceInput,
                }}
              >
                <option value="new-project">New Project</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            {row.project.kind === 'new-project' && (
              <div className="grid gap-1">
                <label
                  htmlFor={projectNameId}
                  className="text-chrome-meta"
                  style={{ color: HUD.textDim }}
                >
                  Project name
                </label>
                <input
                  id={projectNameId}
                  value={row.project.name}
                  onChange={event =>
                    onEdit(row.nativeAgentId, {
                      project: {
                        kind: 'new-project',
                        name: event.target.value,
                      },
                    })
                  }
                  className="h-9 min-w-0 rounded border px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{
                    color: HUD.text,
                    borderColor: HUD.strokeSoft,
                    background: HUD.surfaceInput,
                  }}
                />
              </div>
            )}

            {rowIssues.map(entry => (
              <p
                key={entry.message}
                role="alert"
                className="text-chrome-label"
                style={{ color: HUD.red }}
              >
                {entry.message}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
