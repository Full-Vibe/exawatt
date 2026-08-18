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
import { ArrowLeft, Check, Circle, Server } from 'lucide-react';
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
      observed?: ObservedSourceFacts;
    }
  | { ok: false; failure: SourceFailureClass; message: string };

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
  /** Bounded test plus read-only discovery. `onStage` reports each stage. */
  connect(
    sourceId: string,
    options?: { onStage?: (stage: ConnectStage) => void }
  ): Promise<ConnectAttemptResult>;
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
  const api = window.electron?.connectedSources as
    | (ConnectedSourcesApi & Partial<Pick<ConnectSourceBridge, 'connect'>>)
    | undefined;
  if (!api || typeof api.connect !== 'function') return null;
  const connect = api.connect;
  return {
    sshAliases: () => api.sshAliases(),
    add: input => api.add(input),
    connect: (sourceId, options) => connect(sourceId, options),
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
        const result = await api.connect(input.sourceId, {
          onStage: stage => {
            if (input.token !== attempt.current) return;
            dispatch({ type: 'test-stage', stage });
          },
        });
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
          failure: result.failure,
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
   * Saving runs the reducer's own decision rather than a second copy of it:
   * the mapping is handed on only if the machine actually reached `saved`.
   */
  const finish = useCallback(() => {
    if (step.kind !== 'map-projects') return;
    const action = { type: 'save', knownProjectIds } as const;
    const next = connectFlowReducer(state, action);
    dispatch(action);
    if (next.step.kind !== 'saved') return;
    onConnected?.({
      sourceId: step.sourceId,
      openAgentId: next.step.openAgentId,
      agents: step.rows.map(row => ({
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
      case 'saved':
        return { label: 'Done', run: () => onOpenChange(false) };
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-connect-source
        primaryAction={primaryAction}
        className="max-h-[min(760px,calc(100vh-3rem))] w-[min(720px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-md border p-0"
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
            className="font-mono text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {describeStep(step.kind)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
            <StageList alias={step.alias} stage={step.stage} />
          )}

          {step.kind === 'failed' && (
            <FailureReport failure={step.failure} message={step.message} />
          )}

          {step.kind === 'choose-agents' && (
            <AgentChooser
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

          {step.kind === 'saved' && (
            <p className="text-sm" style={{ color: HUD.text }}>
              Connected. Your roster has the Agents you chose.
            </p>
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
                className="inline-flex h-8 items-center gap-2 rounded px-2 font-mono text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
              </button>
            )}
            {step.kind !== 'saved' && (
              <button
                type="button"
                onClick={leave}
                className="inline-flex h-8 items-center rounded border px-3 font-mono text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.text, borderColor: HUD.strokeSoft }}
              >
                Cancel
              </button>
            )}
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
    case 'saved':
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
        <span
          className="block font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
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
  onSetManual: (manual: boolean) => void;
  onEdit: (patch: Partial<ManualServerDraft>) => void;
  onChooseAlias: (alias: SshHostAlias) => void;
}) {
  return (
    <div className="grid gap-3">
      {manual ? (
        <div className="grid gap-3">
          {!configPresent && (
            <p
              className="font-mono text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
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
          <p
            className="font-mono text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            These details go to your keychain. Leave the key file empty to use
            your SSH default.
          </p>
        </div>
      ) : (
        <>
          {aliases.length === 0 ? (
            <p className="text-sm" style={{ color: HUD.textDim }}>
              {configPresent
                ? 'Your SSH configuration lists no host aliases.'
                : 'Reading your SSH configuration.'}
            </p>
          ) : (
            <div className="grid gap-1">
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
            <p
              className="font-mono text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              Your SSH configuration includes other files Exawatt did not read.
            </p>
          )}
        </>
      )}

      {configPresent && (
        <div>
          <button
            type="button"
            onClick={() => onSetManual(!manual)}
            className="inline-flex h-8 items-center rounded px-2 font-mono text-chrome-label outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{ color: HUD.textDim }}
          >
            {manual ? 'Choose a saved alias' : 'Describe a server instead'}
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="font-mono text-chrome-label"
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
        className="font-mono text-chrome-meta"
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
 * The bounded test, stage by stage. Naming the stage in progress is the point:
 * a spinner would leave the operator guessing which half of the handshake is
 * slow. Nothing here animates, so reduced motion needs no separate path.
 */
function StageList({ alias, stage }: { alias: string; stage: ConnectStage }) {
  const current = CONNECT_STAGES.indexOf(stage);
  return (
    <div className="grid gap-3">
      <p className="text-sm" style={{ color: HUD.text }}>
        {alias}
      </p>
      <ol className="grid gap-1.5" aria-live="polite">
        {CONNECT_STAGES.map((entry, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={entry}
              aria-current={active ? 'step' : undefined}
              className="flex items-center gap-2 font-mono text-chrome-label"
              style={{ color: active || done ? HUD.text : HUD.textDim }}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center">
                {done ? (
                  <Check
                    className="h-3 w-3"
                    aria-hidden
                    style={{ color: HUD.green }}
                  />
                ) : (
                  <Circle
                    className="h-2 w-2"
                    aria-hidden
                    style={{
                      color: active ? HUD.cyan : HUD.idle,
                      fill: active ? HUD.cyan : 'transparent',
                    }}
                  />
                )}
              </span>
              {CONNECT_STAGE_COPY[entry]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FailureReport({
  failure,
  message,
}: {
  failure: SourceFailureClass;
  message: string;
}) {
  const copy = CONNECT_FAILURE_COPY[failure];
  return (
    <div className="grid gap-2" role="alert">
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
  );
}

function AgentChooser({
  agents,
  selected,
  facts,
  onToggle,
}: {
  agents: readonly DiscoveredAgent[];
  selected: ReadonlySet<string>;
  facts: readonly ConnectionFact[];
  onToggle: (nativeAgentId: string) => void;
}) {
  const { configured, retired } = partitionAgents(agents);
  return (
    <div className="grid gap-4">
      <dl className="grid gap-1.5">
        {facts.map(fact => (
          <div key={fact.id} className="flex items-baseline gap-3">
            <dt
              className="w-28 shrink-0 font-mono text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              {fact.label}
            </dt>
            <dd
              className="min-w-0 font-mono text-chrome-label"
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
          <p
            className="font-mono text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
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
      <h3 className="font-mono text-chrome-meta" style={{ color: HUD.textDim }}>
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
                  className="block truncate font-mono text-chrome-meta"
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
            <div className="grid gap-1">
              <label
                htmlFor={nameId}
                className="font-mono text-chrome-meta"
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
              <p
                className="font-mono text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {`The server calls it ${row.sourceName}.`}
              </p>
            </div>

            <div className="grid gap-1">
              <label
                htmlFor={projectId}
                className="font-mono text-chrome-meta"
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
                  className="font-mono text-chrome-meta"
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
                className="font-mono text-chrome-label"
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
