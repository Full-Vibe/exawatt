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
import { ComingSoonMarker } from '@/components/readiness';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ClaudeIcon,
  OpenAIIcon,
  OpenCodeIcon,
  OpenClawIcon,
} from '@/components/workspace/harness-icons';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import {
  fallbackAgentSourceRegistry,
  loadAgentSourceRegistry,
  runAgentSourceAction,
} from '@/components/workspace/agent-sources';
import type {
  AgentSourceAdapterId,
  AgentSourceCatalogEntry,
  AgentSourceFact,
  AgentSourceRegistryLoadStatus,
  AgentSourceSnapshot,
  AgentSourceState,
} from '@/types/electron';

export const SOURCE_AUTH_RECHECK_DELAYS_MS = [
  1_200, 2_500, 4_000, 6_000,
] as const;

function SourceMark({
  id,
  size = 19,
}: {
  id: AgentSourceAdapterId;
  size?: number;
}) {
  if (id === 'claude') return <ClaudeIcon size={size} />;
  if (id === 'codex') return <OpenAIIcon size={size} />;
  if (id === 'opencode') return <OpenCodeIcon size={size} />;
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
  return {
    color: 'var(--settings-dim)',
    wash: 'color-mix(in srgb, var(--settings-dim) 8%, transparent)',
  };
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
      className="inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 font-ui text-chrome-label font-medium"
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

function relativeTime(timestamp: number, now: number): string {
  if (!timestamp) return 'not observed';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function ObservationTime({
  timestamp,
  now,
  prefix = '',
}: {
  timestamp: number;
  now: number;
  prefix?: string;
}) {
  const exact = timestamp
    ? new Date(timestamp).toLocaleString()
    : 'No live observation';
  const iso = timestamp ? new Date(timestamp).toISOString() : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${prefix}${exact}`}
          className="inline-flex min-h-7 max-w-full items-center gap-1 rounded px-1 font-ui text-chrome-label text-[var(--settings-faint)] outline-none hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
        >
          {prefix ? <span>{prefix.trim()}</span> : null}
          <time dateTime={iso}>{relativeTime(timestamp, now)}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent className="border-[var(--settings-line-strong)] bg-[var(--settings-raised)] font-ui text-chrome-label text-[var(--settings-soft)]">
        {exact}
      </TooltipContent>
    </Tooltip>
  );
}

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
    <div className="grid min-h-[66px] grid-cols-[minmax(112px,0.62fr)_minmax(0,1.38fr)] items-center gap-5 border-t border-[var(--settings-line)] py-3 max-[520px]:grid-cols-1 max-[520px]:gap-1.5">
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
              <ObservationTime
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
}: {
  sources: AgentSourceSnapshot[];
  selectedId: string;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <section
      aria-label="Agent Source registry"
      className="border-b border-[var(--settings-line)] bg-[var(--settings-panel)] lg:border-r lg:border-b-0"
    >
      <div className="flex min-h-[72px] items-center justify-between border-b border-[var(--settings-line)] px-5">
        <div>
          <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-[var(--settings-text)]">
            Agent Sources
          </h2>
          <p className="mt-0.5 font-ui text-chrome-label text-[var(--settings-dim)]">
            {sources.length} {sources.length === 1 ? 'adapter' : 'adapters'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Browse Agent Sources"
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
              aria-pressed={active}
              className="group relative flex min-h-[78px] min-w-0 items-center gap-3 rounded-lg border px-3 text-left outline-none transition-[background-color,border-color] duration-150 hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
              style={{
                background: active ? 'var(--settings-selected)' : 'transparent',
                borderColor: active
                  ? 'var(--settings-line-strong)'
                  : 'transparent',
              }}
            >
              <SourceIdentityMark
                className="size-9 rounded-lg"
                color={source.color}
              >
                <SourceMark id={source.adapterId} />
              </SourceIdentityMark>
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
                <StateGlyph state={source.state} />
              </span>
              <span
                aria-hidden
                className="absolute top-2 right-2 size-1.5 rounded-full lg:hidden"
                style={{ background: stateTone(source.state).color }}
              />
              <span className="sr-only">{source.stateLabel}</span>
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
  checkingLabel,
  message,
  now,
  onRecheck,
  onAuthenticate,
  onInstall,
}: {
  source: AgentSourceSnapshot;
  busy: boolean;
  checkingLabel: string;
  message: { ok: boolean; text: string } | null;
  now: number;
  onRecheck: () => void;
  onAuthenticate: () => void;
  onInstall: () => void;
}) {
  const needsAttention = source.state !== 'ready';
  const tone = stateTone(source.state);
  const attentionFact =
    source.state === 'not-installed'
      ? source.facts.installation
      : source.facts.authentication.state === 'action-required'
        ? source.facts.authentication
        : source.facts.reachability;
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
    <article className="min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <SourceIdentityMark
            className="size-11 rounded-lg"
            color={source.color}
          >
            <SourceMark id={source.adapterId} size={22} />
          </SourceIdentityMark>
          <div className="min-w-0">
            <p className="truncate font-ui text-chrome-title text-[var(--settings-dim)]">
              {source.connectionName}
            </p>
            <h2 className="truncate font-display text-display font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
              {source.label}
            </h2>
          </div>
        </div>
        <StatePill source={source} />
      </header>

      <p className="mt-5 max-w-[68ch] font-ui text-chrome-title leading-5 text-[var(--settings-dim)]">
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
            <p className="font-ui text-sm font-medium">{source.stateLabel}</p>
            <p className="mt-1 max-w-xl font-ui text-chrome-title leading-5 text-[var(--settings-dim)]">
              {attentionFact.detail}
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
            className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--settings-amber)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-shell)] outline-none transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-amber)] motion-reduce:transition-none"
          >
            <ExternalLink aria-hidden size={15} />
            Sign in with {source.label}
          </button>
        )}
        {source.actions.installGuide && source.state === 'not-installed' && (
          <button
            type="button"
            disabled={busy}
            onClick={onInstall}
            className="flex min-h-10 items-center gap-2 rounded-lg bg-[var(--settings-amber)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-shell)] outline-none transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-amber)] motion-reduce:transition-none"
          >
            <ExternalLink aria-hidden size={15} />
            Open installation guide
          </button>
        )}
        {source.actions.recheck && (
          <button
            type="button"
            disabled={busy}
            onClick={onRecheck}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-soft)] outline-none transition-[background-color,transform] hover:bg-[var(--settings-hover-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none"
          >
            <RefreshCw
              aria-hidden
              size={15}
              className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
            />
            {busy ? checkingLabel : 'Recheck'}
          </button>
        )}
      </div>

      {message && (
        <p
          role="status"
          className="mt-3 max-w-xl font-ui text-chrome-label leading-5"
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
            className="font-display text-reading font-semibold text-[var(--settings-text)]"
          >
            Source identity
          </h3>
          <ObservationTime
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
  if (
    id === 'claude' ||
    id === 'codex' ||
    id === 'opencode' ||
    id === 'openclaw' ||
    id === 'demo'
  ) {
    return <SourceMark id={id} size={20} />;
  }
  return <Sparkles aria-hidden size={20} />;
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
                <CatalogMark id={entry.adapterId} />
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
                <CatalogMark id={entry.adapterId} />
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

export function AgentSourcesSettings() {
  const [registry, setRegistry] = useState(() =>
    fallbackAgentSourceRegistry('all')
  );
  const [registryStatus, setRegistryStatus] = useState<
    AgentSourceRegistryLoadStatus | 'loading'
  >('loading');
  const [selectedId, setSelectedId] = useState(
    () => registry.sources[0]?.id ?? ''
  );
  const [adding, setAdding] = useState(false);
  const [actionState, setActionState] = useState<
    'idle' | 'checking' | 'opening-auth' | 'reconciling' | 'opening-guide'
  >('idle');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const latestRegistry = useRef(registry);
  const latestRegistryStatus = useRef<
    AgentSourceRegistryLoadStatus | 'loading'
  >('loading');
  const reconciliationGeneration = useRef(0);
  const reconciliationWait = useRef<{
    timer: number;
    finish: () => void;
  } | null>(null);
  const busy = actionState !== 'idle';

  const cancelReconciliation = useCallback(() => {
    reconciliationGeneration.current += 1;
    reconciliationWait.current?.finish();
    reconciliationWait.current = null;
    setActionState('idle');
  }, []);

  useEffect(() => {
    mounted.current = true;
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const wakeOnFocus = () => reconciliationWait.current?.finish();
    window.addEventListener('focus', wakeOnFocus);
    return () => {
      mounted.current = false;
      window.clearInterval(clock);
      window.removeEventListener('focus', wakeOnFocus);
      reconciliationGeneration.current += 1;
      reconciliationWait.current?.finish();
    };
  }, []);

  const applyRegistry = useCallback(
    (next: Awaited<ReturnType<typeof loadAgentSourceRegistry>>) => {
      latestRegistry.current = next.snapshot;
      latestRegistryStatus.current = next.status;
      setRegistry(next.snapshot);
      setRegistryStatus(next.status);
      setSelectedId(current =>
        next.snapshot.sources.some(source => source.id === current)
          ? current
          : (next.snapshot.sources[0]?.id ?? '')
      );
    },
    []
  );

  const refresh = useCallback(
    async (force = true, announce = true) => {
      setActionState('checking');
      if (announce) setMessage(null);
      const next = await loadAgentSourceRegistry(
        'all',
        force,
        latestRegistryStatus.current === 'live' ||
          latestRegistryStatus.current === 'stale'
          ? latestRegistry.current
          : undefined
      );
      if (!mounted.current) return;
      applyRegistry(next);
      setActionState('idle');
      if (next.error) {
        setMessage({ ok: false, text: next.error.message });
      } else if (announce) {
        setMessage({ ok: true, text: 'Agent Source status verified.' });
      }
    },
    [applyRegistry]
  );

  useEffect(() => {
    void refresh(false, false);
  }, [refresh]);

  const selected = useMemo(
    () => registry.sources.find(source => source.id === selectedId) ?? null,
    [registry.sources, selectedId]
  );

  const waitForReconciliation = useCallback((delay: number) => {
    return new Promise<void>(resolve => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        if (reconciliationWait.current?.finish === finish) {
          reconciliationWait.current = null;
        }
        resolve();
      };
      const timer = window.setTimeout(finish, delay);
      reconciliationWait.current = { timer, finish };
    });
  }, []);

  const reconcileAuthentication = useCallback(
    async (sourceId: string, generation: number) => {
      setActionState('reconciling');
      for (const delay of SOURCE_AUTH_RECHECK_DELAYS_MS) {
        await waitForReconciliation(delay);
        if (
          !mounted.current ||
          reconciliationGeneration.current !== generation
        ) {
          return;
        }
        const next = await loadAgentSourceRegistry(
          'all',
          true,
          latestRegistry.current
        );
        if (
          !mounted.current ||
          reconciliationGeneration.current !== generation
        ) {
          return;
        }
        applyRegistry(next);
        const source = next.snapshot.sources.find(
          candidate => candidate.id === sourceId
        );
        if (next.status === 'live' && source?.launchable) {
          setMessage({
            ok: true,
            text: `${source.label} is signed in and ready to launch.`,
          });
          setActionState('idle');
          return;
        }
      }
      if (mounted.current && reconciliationGeneration.current === generation) {
        setMessage({
          ok: false,
          text: 'Sign-in is still open. Finish there, then use Recheck.',
        });
        setActionState('idle');
      }
    },
    [applyRegistry, waitForReconciliation]
  );

  const authenticate = useCallback(async () => {
    if (!selected?.harness) return;
    cancelReconciliation();
    const generation = reconciliationGeneration.current;
    setActionState('opening-auth');
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
      selected.adapterId,
      'authenticate'
    );
    if (!mounted.current) return;
    setMessage({
      ok: result.ok,
      text: result.ok
        ? `${result.message} Waiting for source-owned sign-in…`
        : result.message,
    });
    if (result.ok) {
      void reconcileAuthentication(selected.id, generation);
    } else {
      setRegistry(current => ({
        ...current,
        sources: current.sources.map(source =>
          source.id === selected.id ? selected : source
        ),
      }));
      setActionState('idle');
    }
  }, [cancelReconciliation, reconcileAuthentication, selected]);

  const openInstallGuide = useCallback(async () => {
    if (!selected) return;
    cancelReconciliation();
    setActionState('opening-guide');
    setMessage(null);
    const result = await runAgentSourceAction(
      selected.adapterId,
      'install-guide'
    );
    if (!mounted.current) return;
    setMessage({ ok: result.ok, text: result.message });
    setActionState('idle');
  }, [cancelReconciliation, selected]);

  const selectAdapter = useCallback(
    (adapterId: AgentSourceAdapterId) => {
      const source = registry.sources.find(
        candidate => candidate.adapterId === adapterId
      );
      if (!source) return;
      cancelReconciliation();
      setSelectedId(source.id);
      setAdding(false);
      setMessage(null);
    },
    [cancelReconciliation, registry.sources]
  );

  return (
    <TooltipProvider delayDuration={280}>
      <div
        data-agent-source-registry-status={registryStatus}
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)]"
      >
        <RegistryRail
          sources={registry.sources}
          selectedId={selectedId}
          adding={adding}
          onSelect={id => {
            cancelReconciliation();
            setSelectedId(id);
            setAdding(false);
            setMessage(null);
          }}
          onAdd={() => {
            cancelReconciliation();
            setAdding(true);
            setMessage(null);
          }}
        />
        <div className="min-w-0 bg-[var(--settings-page)]">
          {adding ? (
            <AddSourceView
              available={registry.available}
              comingSoon={registry.comingSoon}
              onSelect={selectAdapter}
            />
          ) : selected ? (
            <SourceDetail
              source={selected}
              busy={busy}
              checkingLabel={
                actionState === 'reconciling'
                  ? 'Waiting for sign-in…'
                  : actionState === 'opening-guide'
                    ? 'Opening…'
                    : 'Checking…'
              }
              message={message}
              now={now}
              onRecheck={() => {
                cancelReconciliation();
                void refresh();
              }}
              onAuthenticate={() => void authenticate()}
              onInstall={() => void openInstallGuide()}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
