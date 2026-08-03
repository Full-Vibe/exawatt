'use client';

import {
  AlertCircle,
  Check,
  ChevronRight,
  ExternalLink,
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ClaudeIcon,
  OpenAIIcon,
  OpenClawIcon,
} from '@/components/workspace/harness-icons';
import {
  fallbackAgentSourceRegistry,
  loadAgentSourceRegistry,
  runAgentSourceAction,
} from '@/components/workspace/agent-sources';
import type {
  AgentHarness,
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceFact,
  AgentSourceSnapshot,
  AgentSourceState,
} from '@/types/electron';

function SourceMark({
  id,
  size = 19,
}: {
  id: AgentSourceAdapterId;
  size?: number;
}) {
  if (id === 'claude') return <ClaudeIcon size={size} />;
  if (id === 'codex') return <OpenAIIcon size={size} />;
  if (id === 'openclaw') return <OpenClawIcon size={size} />;
  return <Sparkles aria-hidden size={size} />;
}

function stateTone(state: AgentSourceState): {
  color: string;
  wash: string;
} {
  if (state === 'ready') {
    return { color: 'var(--settings-teal)', wash: 'var(--settings-teal-wash)' };
  }
  if (state === 'action-required' || state === 'connecting') {
    return {
      color: 'var(--settings-amber)',
      wash: 'var(--settings-amber-wash)',
    };
  }
  if (
    state === 'degraded' ||
    state === 'unavailable' ||
    state === 'incompatible'
  ) {
    return { color: 'var(--settings-red)', wash: 'var(--settings-red-wash)' };
  }
  return { color: 'var(--settings-dim)', wash: 'rgba(142,154,174,0.08)' };
}

function StateGlyph({ state }: { state: AgentSourceState }) {
  const tone = stateTone(state);
  if (state === 'ready') {
    return (
      <span
        className="flex size-5 items-center justify-center rounded-full border"
        style={{ color: tone.color, borderColor: tone.color }}
      >
        <Check aria-hidden size={12} strokeWidth={2.4} />
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <LoaderCircle
        aria-hidden
        size={20}
        className="animate-spin motion-reduce:animate-none"
        style={{ color: tone.color }}
      />
    );
  }
  if (state === 'degraded' || state === 'unavailable') {
    return <WifiOff aria-hidden size={20} style={{ color: tone.color }} />;
  }
  return <AlertCircle aria-hidden size={20} style={{ color: tone.color }} />;
}

function StatePill({ source }: { source: AgentSourceSnapshot }) {
  const tone = stateTone(source.state);
  return (
    <span
      className="inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 font-ui text-[12px] font-medium"
      style={{
        color: tone.color,
        borderColor: `color-mix(in srgb, ${tone.color} 34%, transparent)`,
        background: tone.wash,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: tone.color }}
      />
      {source.stateLabel}
    </span>
  );
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return 'not observed';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--settings-faint)] outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
        >
          <Info aria-hidden size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3 py-2 font-ui text-[12px] leading-[18px] text-[var(--settings-soft)] shadow-xl">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function FactRow({ label, fact }: { label: string; fact: AgentSourceFact }) {
  const observed = new Date(fact.provenance.observedAt);
  const timestamp = fact.provenance.observedAt
    ? observed.toLocaleString()
    : 'No live observation';
  return (
    <div className="grid min-h-[66px] grid-cols-[minmax(112px,0.62fr)_minmax(0,1.38fr)] items-center gap-5 border-t border-[var(--settings-line)] py-3 max-[520px]:grid-cols-1 max-[520px]:gap-1.5">
      <span className="font-ui text-[13px] text-[var(--settings-dim)]">
        {label}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-ui text-[14px] font-medium text-[var(--settings-soft)]">
            {fact.value}
          </span>
          <InfoTip label={fact.detail} />
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="mt-0.5 block w-fit max-w-full truncate font-ui text-[12px] text-[var(--settings-faint)]">
              {fact.provenance.label} ·{' '}
              {relativeTime(fact.provenance.observedAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="border-[var(--settings-line-strong)] bg-[var(--settings-raised)] font-ui text-[12px] text-[var(--settings-soft)]">
            {timestamp}
          </TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}

function CapabilityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-5 border-t border-[var(--settings-line)] py-2.5 max-[520px]:items-start">
      <span className="font-ui text-[13px] text-[var(--settings-dim)]">
        {label}
      </span>
      <span className="max-w-[62%] text-right font-ui text-[13px] font-medium text-[var(--settings-soft)]">
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
}: {
  sources: AgentSourceSnapshot[];
  selectedId: string;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section
      aria-label="Configured Agent Sources"
      className="border-b border-[var(--settings-line)] bg-[var(--settings-panel)] lg:border-r lg:border-b-0"
    >
      <div className="flex min-h-[72px] items-center justify-between border-b border-[var(--settings-line)] px-5">
        <div>
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-[var(--settings-text)]">
            Agent Sources
          </h2>
          <p className="mt-0.5 font-ui text-[12px] text-[var(--settings-dim)]">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Add Agent Source"
          aria-pressed={adding}
          onClick={onAdd}
          className="flex size-10 items-center justify-center rounded-lg border outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
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
              aria-pressed={active}
              className="group flex min-h-[78px] min-w-0 items-center gap-3 rounded-lg border px-3 text-left outline-none transition-[background-color,border-color] duration-150 hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
              style={{
                background: active ? 'rgba(255,255,255,0.052)' : 'transparent',
                borderColor: active
                  ? 'var(--settings-line-strong)'
                  : 'transparent',
              }}
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-line)] bg-[var(--settings-shell)]"
                style={{ color: source.color }}
              >
                <SourceMark id={source.adapterId} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate font-ui text-[14px] font-medium"
                  style={{
                    color: active
                      ? 'var(--settings-text)'
                      : 'var(--settings-soft)',
                  }}
                >
                  {source.label}
                </span>
                <span className="mt-0.5 block truncate font-ui text-[12px] text-[var(--settings-dim)]">
                  {source.connectionName}
                </span>
              </span>
              <span className="hidden shrink-0 lg:block">
                <StateGlyph state={source.state} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SourceDetail({
  source,
  busy,
  message,
  onRecheck,
  onAuthenticate,
}: {
  source: AgentSourceSnapshot;
  busy: boolean;
  message: { ok: boolean; text: string } | null;
  onRecheck: () => void;
  onAuthenticate: () => void;
}) {
  const needsAttention = source.state !== 'ready';
  const tone = stateTone(source.state);
  const modelSelection =
    source.capabilities.modelSelection === 'live-catalog'
      ? 'Live source catalog'
      : source.capabilities.modelSelection === 'source-owned'
        ? `Choose in ${source.label}`
        : source.capabilities.modelSelection === 'gateway'
          ? 'Gateway-advertised'
          : 'Scenario-defined';
  const effortSelection =
    source.capabilities.effortSelection === 'live-catalog'
      ? 'Per-model source catalog'
      : source.capabilities.effortSelection === 'configured-value'
        ? 'Observed configured value'
        : source.capabilities.effortSelection === 'gateway'
          ? 'Gateway-advertised'
          : 'Scenario-defined';
  return (
    <article className="min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--settings-line-strong)] bg-[var(--settings-raised)]"
            style={{ color: source.color }}
          >
            <SourceMark id={source.adapterId} size={22} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-ui text-[13px] text-[var(--settings-dim)]">
              {source.connectionName}
            </p>
            <h2 className="truncate font-display text-[22px] font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
              {source.label}
            </h2>
          </div>
        </div>
        <StatePill source={source} />
      </header>

      <p className="mt-5 max-w-[68ch] font-ui text-[13px] leading-5 text-[var(--settings-dim)]">
        {source.summary}
      </p>

      {needsAttention && (
        <div
          className="mt-6 flex items-start gap-3 border-y py-4"
          style={{ color: tone.color, borderColor: tone.color }}
        >
          {source.state === 'action-required' ? (
            <KeyRound aria-hidden className="mt-0.5 shrink-0" size={18} />
          ) : (
            <AlertCircle aria-hidden className="mt-0.5 shrink-0" size={18} />
          )}
          <div>
            <p className="font-ui text-[14px] font-medium">
              {source.stateLabel}
            </p>
            <p className="mt-1 max-w-xl font-ui text-[13px] leading-5 text-[var(--settings-dim)]">
              {source.facts.authentication.state === 'action-required'
                ? source.facts.authentication.detail
                : source.facts.reachability.detail}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {source.actions.authenticate && source.harness && (
          <button
            type="button"
            disabled={busy}
            onClick={onAuthenticate}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--settings-amber)] px-3.5 font-ui text-[13px] font-medium text-[var(--settings-shell)] outline-none transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-amber)] motion-reduce:transition-none"
          >
            <ExternalLink aria-hidden size={15} />
            Sign in with {source.label}
          </button>
        )}
        {source.actions.recheck && (
          <button
            type="button"
            disabled={busy}
            onClick={onRecheck}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3.5 font-ui text-[13px] font-medium text-[var(--settings-soft)] outline-none transition-[background-color,transform] hover:bg-white/[0.07] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
          >
            <RefreshCw
              aria-hidden
              size={15}
              className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
            />
            {busy ? 'Checking…' : 'Recheck'}
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className="mt-3 max-w-xl font-ui text-[12px] leading-5"
          style={{
            color: message.ok ? 'var(--settings-teal)' : 'var(--settings-red)',
          }}
        >
          {message.text}
        </p>
      )}

      <section className="mt-9" aria-labelledby="source-identity-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3
            id="source-identity-heading"
            className="font-display text-[15px] font-semibold text-[var(--settings-text)]"
          >
            Source identity
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-ui text-[12px] text-[var(--settings-faint)]">
                Checked {relativeTime(source.observedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent className="border-[var(--settings-line-strong)] bg-[var(--settings-raised)] font-ui text-[12px] text-[var(--settings-soft)]">
              {source.observedAt
                ? new Date(source.observedAt).toLocaleString()
                : 'No live observation'}
            </TooltipContent>
          </Tooltip>
        </div>
        <FactRow label="Identity" fact={source.facts.identity} />
        <FactRow label="Authentication" fact={source.facts.authentication} />
        <FactRow label="Installation" fact={source.facts.installation} />
        <FactRow label="Reachability" fact={source.facts.reachability} />
        <FactRow label="Compatibility" fact={source.facts.compatibility} />
      </section>

      <section className="mt-8" aria-labelledby="source-model-heading">
        <h3
          id="source-model-heading"
          className="mb-3 font-display text-[15px] font-semibold text-[var(--settings-text)]"
        >
          Model truth
        </h3>
        <FactRow label="Discovery" fact={source.facts.modelDiscovery} />
        <CapabilityRow label="Model selection" value={modelSelection} />
        <CapabilityRow label="Reasoning effort" value={effortSelection} />
      </section>

      <section
        className="mt-8 pb-6"
        aria-labelledby="source-capabilities-heading"
      >
        <h3
          id="source-capabilities-heading"
          className="mb-3 font-display text-[15px] font-semibold text-[var(--settings-text)]"
        >
          Capabilities and assurance
        </h3>
        <CapabilityRow
          label="Terminal launch"
          value={
            source.capabilities.interactiveLaunch
              ? 'Available'
              : 'Not available in Terminal'
          }
        />
        <CapabilityRow
          label="Exact resume"
          value={source.capabilities.exactResume ? 'Supported' : 'Unavailable'}
        />
        <CapabilityRow
          label="Delegation"
          value={source.capabilities.delegationObservation}
        />
        <CapabilityRow
          label="Security enforcement"
          value={source.capabilities.enforcementOwner}
        />
      </section>
    </article>
  );
}

function CatalogMark({ id }: { id: AgentSourceCatalogEntry['adapterId'] }) {
  if (id === 'claude' || id === 'codex' || id === 'openclaw' || id === 'demo') {
    return <SourceMark id={id} size={20} />;
  }
  return <Sparkles aria-hidden size={20} />;
}

function AddSourceView({
  available,
  comingLater,
  onSelect,
}: {
  available: AgentSourceCatalogEntry[];
  comingLater: AgentSourceCatalogEntry[];
  onSelect: (adapterId: AgentSourceAdapterId) => void;
}) {
  return (
    <article className="min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] text-[var(--settings-teal)]">
          <Plus aria-hidden size={21} />
        </span>
        <div>
          <p className="font-ui text-[13px] text-[var(--settings-dim)]">
            Registry
          </p>
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
            Add Agent Source
          </h2>
        </div>
      </div>
      <p className="mt-5 max-w-[68ch] font-ui text-[13px] leading-5 text-[var(--settings-dim)]">
        Local sources are discovered automatically. Select one to inspect its
        installation or configuration; future adapters stay visibly separate.
      </p>

      <section className="mt-8" aria-labelledby="available-sources-heading">
        <h3
          id="available-sources-heading"
          className="mb-3 font-display text-[15px] font-semibold text-[var(--settings-text)]"
        >
          Available now
        </h3>
        <div className="divide-y divide-[var(--settings-line)] border-y border-[var(--settings-line)]">
          {available.map(entry => (
            <button
              key={entry.adapterId}
              type="button"
              onClick={() => onSelect(entry.adapterId as AgentSourceAdapterId)}
              className="flex min-h-[72px] w-full items-center gap-3 px-1 text-left outline-none transition-colors hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--settings-teal)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-line)] bg-[var(--settings-shell)] text-[var(--settings-soft)]">
                <CatalogMark id={entry.adapterId} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-ui text-[14px] font-medium text-[var(--settings-soft)]">
                  {entry.label}
                </span>
                <span className="mt-0.5 block font-ui text-[12px] text-[var(--settings-dim)]">
                  {entry.description}
                </span>
              </span>
              <span className="shrink-0 font-ui text-[11px] font-medium text-[var(--settings-teal)]">
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
            className="font-display text-[15px] font-semibold text-[var(--settings-text)]"
          >
            Coming later
          </h3>
          <InfoTip label="These adapters are part of Exawatt's source-agnostic architecture, but cannot be configured in this build." />
        </div>
        <div className="divide-y divide-[var(--settings-line)] border-y border-[var(--settings-line)]">
          {comingLater.map(entry => (
            <div
              key={entry.adapterId}
              className="flex min-h-[68px] items-center gap-3 px-1 opacity-70"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--settings-line)] bg-[var(--settings-shell)] text-[var(--settings-faint)]">
                <CatalogMark id={entry.adapterId} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-ui text-[14px] font-medium text-[var(--settings-soft)]">
                  {entry.label}
                </span>
                <span className="mt-0.5 block font-ui text-[12px] text-[var(--settings-dim)]">
                  {entry.description}
                </span>
              </span>
              <span className="shrink-0 rounded-full border border-[var(--settings-line-strong)] px-2 py-1 font-ui text-[10px] uppercase tracking-[0.1em] text-[var(--settings-faint)]">
                Later
              </span>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

export function AgentSourcesSettings() {
  const [registry, setRegistry] = useState(() =>
    fallbackAgentSourceRegistry('all')
  );
  const [selectedId, setSelectedId] = useState(
    () => registry.sources[0]?.id ?? ''
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const mounted = useRef(true);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    };
  }, []);

  const refresh = useCallback(async (force = true) => {
    setBusy(true);
    setMessage(null);
    const next = await loadAgentSourceRegistry('all', force);
    if (!mounted.current) return;
    setRegistry(next);
    setSelectedId(current =>
      next.sources.some(source => source.id === current)
        ? current
        : (next.sources[0]?.id ?? '')
    );
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const selected = useMemo(
    () => registry.sources.find(source => source.id === selectedId) ?? null,
    [registry.sources, selectedId]
  );

  const authenticate = useCallback(async () => {
    if (!selected?.harness) return;
    setBusy(true);
    setMessage(null);
    setRegistry(current => ({
      ...current,
      sources: current.sources.map(source =>
        source.id === selected.id
          ? {
              ...source,
              state: 'connecting',
              stateLabel: 'Connecting',
              summary: `${source.label} sign-in is open. Exawatt will recheck the source-owned session.`,
            }
          : source
      ),
    }));
    const result = await runAgentSourceAction(
      selected.harness as AgentHarness,
      'authenticate'
    );
    if (!mounted.current) return;
    setMessage({ ok: result.ok, text: result.message });
    setBusy(false);
    if (result.ok) {
      refreshTimer.current = window.setTimeout(() => void refresh(), 2_000);
    } else {
      setRegistry(current => ({
        ...current,
        sources: current.sources.map(source =>
          source.id === selected.id ? selected : source
        ),
      }));
    }
  }, [refresh, selected]);

  const selectAdapter = useCallback(
    (adapterId: AgentSourceAdapterId) => {
      const source = registry.sources.find(
        candidate => candidate.adapterId === adapterId
      );
      if (!source) return;
      setSelectedId(source.id);
      setAdding(false);
      setMessage(null);
    },
    [registry.sources]
  );

  return (
    <TooltipProvider delayDuration={280}>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]">
        <RegistryRail
          sources={registry.sources}
          selectedId={selectedId}
          adding={adding}
          onSelect={id => {
            setSelectedId(id);
            setAdding(false);
            setMessage(null);
          }}
          onAdd={() => {
            setAdding(true);
            setMessage(null);
          }}
        />
        <div className="min-w-0 bg-[var(--settings-page)]">
          {adding ? (
            <AddSourceView
              available={registry.available}
              comingLater={registry.comingLater}
              onSelect={selectAdapter}
            />
          ) : selected ? (
            <SourceDetail
              source={selected}
              busy={busy}
              message={message}
              onRecheck={() => void refresh()}
              onAuthenticate={() => void authenticate()}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
