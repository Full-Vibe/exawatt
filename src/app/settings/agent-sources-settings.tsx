'use client';

import { ChevronRight, Info, Plus } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ComingSoonMarker } from '@/components/readiness';
import { useLatestRequest } from '@/hooks/use-latest-request';
import { useAgentSourceRegistry } from '@/components/workspace/use-agent-source-registry';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AgentSourceMark } from '@/components/workspace/agent-source-mark';
import { useRouter } from 'next/navigation';
import { runAgentSourceAction } from '@/components/workspace/agent-sources';
import { openSourceShell } from '@/components/workspace/session-jump';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import {
  SourceCard,
  SourceDisclosureText,
  SourceObservationTime,
  SourceStateGlyph,
  sourceAttention,
  sourceCardStep,
  sourceStateTone,
} from '@/components/agent-sources/source-card';
import {
  ConnectedSourceDetail,
  ConnectedSourcesRail,
  useConnectedSources,
} from './connected-sources-section';
import type {
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceFact,
  AgentSourceSnapshot,
} from '@exawatt/core';

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--settings-faint)] outline-none transition-colors hover:bg-[var(--settings-hover-strong)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
        >
          <Info aria-hidden size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3 py-2 font-ui text-chrome-label leading-4.5 text-[var(--settings-soft)] shadow-xl">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function FactRow({
  label,
  fact,
  now,
}: {
  label: string;
  fact: AgentSourceFact;
  now: number;
}) {
  const basisLabel =
    fact.basis === 'observed'
      ? 'Observed'
      : fact.basis === 'simulated'
        ? 'Simulated'
        : 'Declared';
  return (
    <div
      data-source-fact-state={fact.state}
      className="grid min-h-[66px] grid-cols-[minmax(112px,0.62fr)_minmax(0,1.38fr)] items-center gap-5 border-t border-[var(--settings-line)] py-3 max-[520px]:grid-cols-1 max-[520px]:gap-1.5"
    >
      <span className="font-ui text-chrome-title text-[var(--settings-dim)]">
        {label}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-ui text-sm font-medium text-[var(--settings-soft)]">
            {fact.value}
          </span>
          <InfoTip label={fact.detail} />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 font-ui text-chrome-label text-[var(--settings-faint)]">
          <span className="truncate">
            {basisLabel} · {fact.provenance.label}
          </span>
          {fact.basis === 'observed' && (
            <>
              <span aria-hidden>·</span>
              <SourceObservationTime
                timestamp={fact.provenance.observedAt}
                now={now}
              />
            </>
          )}
        </span>
      </span>
    </div>
  );
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-5 border-t border-[var(--settings-line)] py-2.5 max-[520px]:items-start">
      <span className="font-ui text-chrome-title text-[var(--settings-dim)]">
        {label}
      </span>
      <span className="max-w-[62%] text-right font-ui text-chrome-title font-medium text-[var(--settings-soft)]">
        {value}
      </span>
    </div>
  );
}

function RegistryRail({
  sources,
  selectedId,
  adding,
  onSelect,
  onAdd,
  children,
}: {
  sources: AgentSourceSnapshot[];
  selectedId: string;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** The configured-connection group (ENG-010 C2), below the adapters. */
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="Agent Source registry"
      data-agent-source-registry
      className="border-b border-[var(--settings-line)] bg-[var(--settings-panel)] lg:border-r lg:border-b-0"
    >
      <div className="flex min-h-[72px] items-center justify-between border-b border-[var(--settings-line)] px-5">
        <h3 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--settings-text)]">
          Built-in sources
        </h3>
        <button
          type="button"
          aria-label="Browse Agent Sources"
          data-agent-source-browse
          aria-pressed={adding}
          onClick={onAdd}
          className="flex size-10 items-center justify-center rounded-lg border outline-none transition-colors hover:bg-[var(--settings-hover-strong)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
          style={{
            color: adding ? 'var(--settings-teal)' : 'var(--settings-soft)',
            borderColor: adding
              ? 'color-mix(in srgb, var(--settings-teal) 54%, transparent)'
              : 'var(--settings-line-strong)',
            background: adding ? 'var(--settings-teal-wash)' : 'transparent',
          }}
        >
          <Plus aria-hidden size={18} />
        </button>
      </div>
      <div className="grid grid-cols-2 p-2 sm:grid-cols-4 lg:grid-cols-1">
        {sources.map(source => {
          const active = selectedId === source.id && !adding;
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelect(source.id)}
              aria-label={`${source.label}, ${source.connectionName}, ${source.stateLabel}`}
              data-agent-source={source.adapterId}
              aria-pressed={active}
              className="group relative flex min-h-[78px] min-w-0 items-center gap-3 rounded-lg border px-3 text-left outline-none transition-[background-color,border-color] duration-150 hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
              style={{
                background: active ? 'var(--settings-selected)' : 'transparent',
                borderColor: active
                  ? 'var(--settings-line-strong)'
                  : 'transparent',
              }}
            >
              <AgentSourceMark
                plate
                source={source.adapterId}
                size={19}
                className="size-9 rounded-lg"
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate font-ui text-sm font-medium"
                  style={{
                    color: active
                      ? 'var(--settings-text)'
                      : 'var(--settings-soft)',
                  }}
                >
                  {source.label}
                </span>
                <span className="mt-0.5 block truncate font-ui text-chrome-label text-[var(--settings-dim)]">
                  {source.connectionName}
                </span>
              </span>
              <span className="hidden shrink-0 lg:block">
                <SourceStateGlyph state={source.state} />
              </span>
              <span
                aria-hidden
                className="absolute top-2 right-2 size-1.5 rounded-full lg:hidden"
                style={{ background: sourceStateTone(source.state).color }}
              />
              <span className="sr-only">{source.stateLabel}</span>
            </button>
          );
        })}
      </div>
      {children}
    </section>
  );
}

function SourceDetail({
  source,
  busy,
  checkingLabel,
  message,
  now,
  onRecheck,
  onInstall,
  onSignIn,
}: {
  source: AgentSourceSnapshot;
  busy: boolean;
  checkingLabel: string;
  message: { ok: boolean; text: string } | null;
  now: number;
  onRecheck: () => void;
  onInstall: () => void;
  onSignIn: (command: string) => void;
}) {
  const step = sourceCardStep(source);
  const modelSelection =
    source.capabilities.modelSelection === 'live-catalog'
      ? 'Project-scoped live catalog'
      : source.capabilities.modelSelection === 'source-owned'
        ? `Choose in ${source.label}`
        : source.capabilities.modelSelection === 'gateway'
          ? 'Gateway-advertised'
          : 'Scenario-defined';
  const effortSelection =
    source.capabilities.effortSelection === 'live-catalog'
      ? 'Project-scoped per-model catalog'
      : source.capabilities.effortSelection === 'configured-value'
        ? 'Observed configured value'
        : source.capabilities.effortSelection === 'source-owned'
          ? `Choose in ${source.label}`
          : source.capabilities.effortSelection === 'gateway'
            ? 'Gateway-advertised'
            : 'Scenario-defined';
  return (
    <SourceCard
      layout="detail"
      identity={{
        adapterId: source.adapterId,
        label: source.label,
        secondary: source.connectionName,
      }}
      state={source.state}
      stateLabel={source.stateLabel}
      summary={source.summary}
      attention={sourceAttention(source)}
      step={step}
      onStep={
        step?.kind === 'install-guide'
          ? onInstall
          : step?.kind === 'sign-in'
            ? () => onSignIn(step.command)
            : undefined
      }
      disclosure={
        agentSourceDeclaration(source.adapterId).disclosure ? (
          <SourceDisclosureText adapterId={source.adapterId} />
        ) : null
      }
      onRecheck={source.actions.recheck ? onRecheck : null}
      busy={busy}
      busyLabel={checkingLabel}
      message={message}
    >
      <section className="mt-9" aria-labelledby="source-identity-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3
            id="source-identity-heading"
            className="font-display text-reading font-semibold text-[var(--settings-text)]"
          >
            Source identity
          </h3>
          <SourceObservationTime
            timestamp={source.observedAt}
            now={now}
            prefix="Checked "
          />
        </div>
        <FactRow label="Identity" fact={source.facts.identity} now={now} />
        <FactRow
          label="Authentication"
          fact={source.facts.authentication}
          now={now}
        />
        <FactRow
          label="Installation"
          fact={source.facts.installation}
          now={now}
        />
        <FactRow
          label="Reachability"
          fact={source.facts.reachability}
          now={now}
        />
        <FactRow
          label="Compatibility"
          fact={source.facts.compatibility}
          now={now}
        />
      </section>

      <section className="mt-8" aria-labelledby="source-model-heading">
        <h3
          id="source-model-heading"
          className="mb-3 font-display text-reading font-semibold text-[var(--settings-text)]"
        >
          Model availability
        </h3>
        <FactRow
          label="Registry observation"
          fact={source.facts.modelDiscovery}
          now={now}
        />
        <CapabilityRow label="Model selection" value={modelSelection} />
        <CapabilityRow label="Reasoning effort" value={effortSelection} />
      </section>

      <section
        className="mt-8 pb-6"
        aria-labelledby="source-capabilities-heading"
      >
        <h3
          id="source-capabilities-heading"
          className="mb-3 font-display text-reading font-semibold text-[var(--settings-text)]"
        >
          Capabilities and assurance
        </h3>
        <CapabilityRow
          label="Terminal launch"
          value={
            source.capabilities.interactiveLaunch
              ? 'Available'
              : 'No interactive terminal launch'
          }
        />
        <CapabilityRow
          label="Exact resume"
          value={source.capabilities.exactResume ? 'Supported' : 'Unavailable'}
        />
        {source.facts.delegation ? (
          <FactRow
            label="Delegation"
            fact={source.facts.delegation}
            now={now}
          />
        ) : (
          <CapabilityRow
            label="Delegation"
            value={source.capabilities.delegationObservation}
          />
        )}
        <CapabilityRow
          label="Security enforcement"
          value={source.capabilities.enforcementOwner}
        />
      </section>
    </SourceCard>
  );
}

function AddSourceView({
  available,
  comingSoon,
  onSelect,
}: {
  available: AgentSourceCatalogEntry[];
  comingSoon: AgentSourceCatalogEntry[];
  onSelect: (adapterId: AgentSourceAdapterId) => void;
}) {
  return (
    <article className="min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] text-[var(--settings-teal)]">
          <Plus aria-hidden size={21} />
        </span>
        <div>
          <p className="font-ui text-chrome-title text-[var(--settings-dim)]">
            Adapter catalog
          </p>
          <h2 className="font-display text-display font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
            Browse Agent Sources
          </h2>
        </div>
      </div>
      <p className="mt-5 max-w-[68ch] font-ui text-chrome-title leading-5 text-[var(--settings-dim)]">
        Exawatt discovers built-in adapters automatically. Select one to inspect
        its live status or open source-owned setup guidance; future adapters
        stay visibly separate.
      </p>

      <section className="mt-8" aria-labelledby="available-sources-heading">
        <h3
          id="available-sources-heading"
          className="mb-3 font-display text-reading font-semibold text-[var(--settings-text)]"
        >
          Available now
        </h3>
        <div className="divide-y divide-[var(--settings-line)] border-y border-[var(--settings-line)]">
          {available.map(entry => (
            <button
              key={entry.adapterId}
              type="button"
              onClick={() => onSelect(entry.adapterId as AgentSourceAdapterId)}
              className="flex min-h-[72px] w-full items-center gap-3 px-1 text-left outline-none transition-colors hover:bg-[var(--settings-hover)] focus-visible:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--settings-teal)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-line)] bg-[var(--settings-shell)] text-[var(--settings-soft)]">
                <AgentSourceMark source={entry.adapterId} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-ui text-sm font-medium text-[var(--settings-soft)]">
                  {entry.label}
                </span>
                <span className="mt-0.5 block font-ui text-chrome-label text-[var(--settings-dim)]">
                  {entry.description}
                </span>
              </span>
              <span className="shrink-0 font-ui text-chrome-meta font-medium text-[var(--settings-teal)]">
                {entry.availability === 'configured'
                  ? 'Configured'
                  : entry.availability === 'not-installed'
                    ? 'Inspect install'
                    : 'Configure'}
              </span>
              <ChevronRight
                aria-hidden
                size={15}
                className="shrink-0 text-[var(--settings-faint)]"
              />
            </button>
          ))}
        </div>
      </section>

      <section className="mt-9" aria-labelledby="future-sources-heading">
        <div className="mb-3 flex items-center gap-2">
          <h3
            id="future-sources-heading"
            className="font-display text-reading font-semibold text-[var(--settings-text)]"
          >
            Future sources
          </h3>
          <InfoTip label="These adapters are part of Exawatt's source-agnostic architecture, but cannot be configured in this build." />
        </div>
        <div className="divide-y divide-[var(--settings-line)] border-y border-[var(--settings-line)]">
          {comingSoon.map(entry => (
            <div
              key={entry.adapterId}
              className="flex min-h-[68px] items-center gap-3 px-1 opacity-70"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-line)] bg-[var(--settings-shell)] text-[var(--settings-faint)]">
                <AgentSourceMark source={entry.adapterId} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-ui text-sm font-medium text-[var(--settings-soft)]">
                  {entry.label}
                </span>
                <span className="mt-0.5 block font-ui text-chrome-label text-[var(--settings-dim)]">
                  {entry.description}
                </span>
              </span>
              <ComingSoonMarker className="shrink-0" />
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

export function AgentSourcesSettings({
  onConnectExistingAgent,
  openConnection = null,
}: {
  /**
   * The ⌘N Connect route. A sibling packet owns that dialog,
   * so Settings takes an opener rather than growing a second connect flow;
   * until one is exported the empty state names the chord instead.
   */
  onConnectExistingAgent?: () => void;
  /**
   * A saved server to open, when something outside asked for one (Manage in
   * Connect). Applied once per request, and only once the server is in the
   * list: selecting an id the registry has not read yet would be undone by
   * the rule that drops a selection whose server is gone.
   */
  openConnection?: { id: string } | null;
} = {}) {
  const router = useRouter();
  const connected = useConnectedSources();
  const [selectedConnectionId, setSelectedConnectionId] = useState<
    string | null
  >(null);
  // The registry paints from this machine's memory first, then live; while
  // the first probe runs with nothing remembered every source reads
  // `Checking`, as a state of its own (BUG-082). Newest-wins is the hook's.
  const registryRead = useAgentSourceRegistry('all');
  // Delegation observation is pushed live from main (ENG-023) on every
  // change, so the latest push per adapter is at least as new as any
  // registry read, whichever lands first. It is layered over the registry
  // the hook paints.
  const [delegationPushes, setDelegationPushes] = useState<
    ReadonlyMap<string, AgentSourceFact | null>
  >(() => new Map());
  useEffect(
    () =>
      window.electron?.agentSources?.onDelegation?.(({ adapterId, fact }) => {
        setDelegationPushes(current => new Map(current).set(adapterId, fact));
      }),
    []
  );
  const registry = useMemo(() => {
    if (delegationPushes.size === 0) return registryRead.registry;
    return {
      ...registryRead.registry,
      sources: registryRead.registry.sources.map(source => {
        if (!delegationPushes.has(source.adapterId)) return source;
        const fact = delegationPushes.get(source.adapterId);
        const facts = { ...source.facts };
        if (fact) facts.delegation = fact;
        else delete facts.delegation;
        return { ...source, facts };
      }),
    };
  }, [delegationPushes, registryRead.registry]);
  const registryStatus = registryRead.status;
  const [selectedId, setSelectedId] = useState(
    () => registryRead.registry.sources[0]?.id ?? ''
  );
  const [adding, setAdding] = useState(false);
  const [actionState, setActionState] = useState<
    'idle' | 'checking' | 'opening-guide'
  >('idle');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [now, setNow] = useState(() => Date.now());
  // One channel for the setup action main performs (the install guide):
  // changing sources, cancelling, or unmounting supersedes it (BUG-119).
  const setupActions = useLatestRequest();
  const busy = actionState !== 'idle' || registryStatus === 'checking';

  const cancelSetupAction = useCallback(() => {
    setupActions.invalidate();
    setActionState('idle');
  }, [setupActions]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  // A source that disappears from the registry takes its detail with it.
  useEffect(() => {
    setSelectedId(current =>
      registryRead.registry.sources.some(source => source.id === current)
        ? current
        : (registryRead.registry.sources[0]?.id ?? '')
    );
  }, [registryRead.registry]);

  // The live read failed: say so once, in the box a Recheck answers in.
  const registryError = registryRead.error;
  useEffect(() => {
    if (!registryError || registryStatus === 'checking') return;
    setMessage({ ok: false, text: registryError.message });
  }, [registryError, registryStatus]);

  const recheckRegistry = registryRead.recheck;
  const refresh = useCallback(async () => {
    setActionState('checking');
    setMessage(null);
    const next = await recheckRegistry(true);
    setActionState('idle');
    if (!next.error) {
      setMessage({ ok: true, text: 'Agent Source status verified.' });
    }
  }, [recheckRegistry]);

  const selected = useMemo(
    () => registry.sources.find(source => source.id === selectedId) ?? null,
    [registry.sources, selectedId]
  );

  const selectedConnection = useMemo(
    () =>
      connected.sources.find(source => source.id === selectedConnectionId) ??
      null,
    [connected.sources, selectedConnectionId]
  );

  // A detached record takes its detail view with it, back to the adapters.
  useEffect(() => {
    if (selectedConnectionId && !selectedConnection) {
      setSelectedConnectionId(null);
    }
  }, [selectedConnection, selectedConnectionId]);

  const openedConnection = useRef<{ id: string } | null>(null);
  useEffect(() => {
    if (!openConnection || openedConnection.current === openConnection) return;
    if (!connected.sources.some(source => source.id === openConnection.id)) {
      return;
    }
    openedConnection.current = openConnection;
    cancelSetupAction();
    setSelectedConnectionId(openConnection.id);
    setAdding(false);
    setMessage(null);
  }, [cancelSetupAction, connected.sources, openConnection]);

  const openInstallGuide = useCallback(async () => {
    if (!selected) return;
    cancelSetupAction();
    const ticket = setupActions.begin();
    setActionState('opening-guide');
    setMessage(null);
    const result = await runAgentSourceAction(
      selected.adapterId,
      'install-guide'
    );
    if (!ticket.current) return;
    setMessage({ ok: result.ok, text: result.message });
    setActionState('idle');
  }, [cancelSetupAction, selected, setupActions]);

  const selectAdapter = useCallback(
    (adapterId: AgentSourceAdapterId) => {
      const source = registry.sources.find(
        candidate => candidate.adapterId === adapterId
      );
      if (!source) return;
      cancelSetupAction();
      setSelectedId(source.id);
      setAdding(false);
      setMessage(null);
    },
    [cancelSetupAction, registry.sources]
  );

  return (
    <TooltipProvider delayDuration={280}>
      <div
        data-agent-source-registry-status={registryStatus}
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]"
      >
        <RegistryRail
          sources={registry.sources}
          selectedId={selectedConnection ? '' : selectedId}
          adding={adding}
          onSelect={id => {
            cancelSetupAction();
            setSelectedConnectionId(null);
            setSelectedId(id);
            setAdding(false);
            setMessage(null);
          }}
          onAdd={() => {
            cancelSetupAction();
            setAdding(true);
            setMessage(null);
          }}
        >
          {connected.available && (
            <ConnectedSourcesRail
              sources={connected.sources}
              observations={connected.observations}
              selectedId={adding ? null : selectedConnectionId}
              onSelect={id => {
                cancelSetupAction();
                setSelectedConnectionId(id);
                setAdding(false);
                setMessage(null);
              }}
              onConnect={onConnectExistingAgent}
            />
          )}
        </RegistryRail>
        <div className="min-w-0 bg-[var(--settings-page)]">
          {adding ? (
            <AddSourceView
              available={registry.available}
              comingSoon={registry.comingSoon}
              onSelect={selectAdapter}
            />
          ) : selectedConnection ? (
            <ConnectedSourceDetail
              source={selectedConnection}
              observation={connected.observations.get(selectedConnection.id)}
              busy={connected.busyId === selectedConnection.id}
              message={connected.message}
              onReconnect={() =>
                void connected.reconnect(selectedConnection.id)
              }
              onRename={name =>
                void connected.rename(selectedConnection.id, name)
              }
              onDetach={() => void connected.detach(selectedConnection.id)}
            />
          ) : selected ? (
            <SourceDetail
              source={selected}
              busy={busy}
              checkingLabel={
                actionState === 'opening-guide' ? 'Opening…' : 'Checking…'
              }
              message={message}
              now={now}
              onRecheck={() => {
                cancelSetupAction();
                void refresh();
              }}
              onInstall={() => void openInstallGuide()}
              onSignIn={command => {
                // The source signs in in a Shell tab the workspace opens
                // (BUG-275); Recheck here once it has.
                cancelSetupAction();
                openSourceShell(command);
                router.push('/workspace');
              }}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
