'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type {
  ActivityFeedItem,
  FleetAgentView,
  SpatialBoardDelegatedChild,
  SpatialScopeActivity,
} from '@exawatt/ui-model';
import { AnnouncedChip } from '@/components/readiness';
import { Button } from '@/components/ui/button';
import {
  STATUS_LIGHT_META,
  StatusLight,
  statusLightStateForAgentStatus,
} from '@/components/status-light';
import type { SpatialCalloutTheme } from './spatial-theme';
import { agentGoalDisplay } from './spatial-agent-copy';

/**
 * One selection command panel (ENG-004 V3.3 S4/F6, decision `0024`).
 *
 * It replaces the always-present inspector rail and the global activity feed:
 * the board's chrome is now the header status strip, the bottom-right tool
 * cluster, and this panel — which exists only while something is selected. The
 * feed became "what has this unit been doing" rather than fleet-wide
 * state-transition exhaust, per the 2026-08-02 UX pass.
 */

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function elapsedSince(startedAt: number | null, now: number): string | null {
  if (startedAt === null || !Number.isFinite(startedAt)) return null;
  const minutes = Math.floor((now - startedAt) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return 'under 1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function PanelSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-3">
      <h3 className="flex items-baseline gap-1.5 text-chrome-label font-semibold text-muted-foreground">
        {title}
        {count !== undefined && (
          <span className="font-mono tabular-nums">{count}</span>
        )}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ScopeCount({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: string;
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, opacity: count > 0 ? 1 : 0.35 }}
      />
      <span className="font-mono tabular-nums text-foreground">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** Multi-selection: the working set, its D40 buckets, and the one announced
 *  command verb. Selection is real; fan-out is not built (V3.2's boundary). */
function MultiSelectionCommand({
  agents,
  activity,
  statusColors,
  onClear,
  onInspect,
}: {
  agents: FleetAgentView[];
  activity: SpatialScopeActivity | null;
  statusColors: { active: string; blocked: string; idle: string };
  onClear: () => void;
  onInspect: (agentId: string) => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-chrome-label text-muted-foreground">Selection</p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-foreground">
            {agents.length} {agents.length === 1 ? 'Agent' : 'Agents'}
          </h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>

      {activity && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-chrome-meta">
          <ScopeCount
            count={activity.working}
            label="working"
            color={statusColors.active}
          />
          <ScopeCount
            count={activity.blocked}
            label="blocked"
            color={statusColors.blocked}
          />
          <ScopeCount
            count={activity.idle}
            label="idle"
            color={statusColors.idle}
          />
        </div>
      )}

      <AnnouncedChip
        coming={`direct all ${agents.length} selected Agents at once`}
        className="mt-3 self-start"
      >
        Direct {agents.length} {agents.length === 1 ? 'Agent' : 'Agents'}
      </AnnouncedChip>

      <PanelSection title="Selected" count={agents.length}>
        <ul className="space-y-1">
          {agents.map(agent => {
            const light = statusLightStateForAgentStatus(agent.status);
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  data-selection-member={agent.id}
                  onClick={() => onInspect(agent.id)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusLight decorative size="compact" state={light} />
                  <span className="min-w-0 flex-1 truncate text-chrome-meta text-foreground">
                    {agentGoalDisplay(agent.goal).summary}
                  </span>
                  <span className="shrink-0 truncate text-chrome-micro text-muted-foreground">
                    {agent.project}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PanelSection>
    </>
  );
}

export function SpatialSelectionPanel({
  agent,
  selectedAgents,
  scopeActivity,
  activity,
  delegation,
  statusColors,
  needsOperatorCallout,
  faultCallout,
  isDemo,
  opening,
  handoffError,
  now,
  onOpenSession,
  onClearSelection,
  onInspectAgent,
}: {
  /** The single URL-addressed Agent, when one is inspected. */
  agent: FleetAgentView | null;
  /** The ephemeral working set, when a band/shift selection exists. */
  selectedAgents: FleetAgentView[];
  scopeActivity: SpatialScopeActivity | null;
  /** Meaningful Events for the inspected Agent — never fleet-wide exhaust. */
  activity: ActivityFeedItem[];
  /** Live delegated children the source reports for the inspected Agent. */
  delegation: { count: number; children: SpatialBoardDelegatedChild[] } | null;
  statusColors: { active: string; blocked: string; idle: string };
  needsOperatorCallout: SpatialCalloutTheme;
  faultCallout: SpatialCalloutTheme;
  isDemo: boolean;
  opening: boolean;
  handoffError: string | null;
  /** Injected so elapsed copy stays deterministic under test. */
  now: number;
  onOpenSession: () => void;
  onClearSelection: () => void;
  onInspectAgent: (agentId: string) => void;
}) {
  const multi = selectedAgents.length > 0;
  const goal = agent ? agentGoalDisplay(agent.goal) : null;
  const light = agent ? statusLightStateForAgentStatus(agent.status) : null;
  const shownChildren = delegation?.children ?? [];
  const hiddenChildren = delegation
    ? Math.max(0, delegation.count - shownChildren.length)
    : 0;

  return (
    <aside
      data-spatial-selection-panel={multi ? 'multi' : 'agent'}
      data-selection-count={multi ? selectedAgents.length : agent ? 1 : 0}
      aria-label="Selection"
      className="exa-material-overlay relative z-10 flex flex-col gap-3 overflow-y-auto border-t border-border p-4 pb-24 xl:min-h-0 xl:border-l xl:border-t-0 xl:pb-4"
    >
      {multi ? (
        <MultiSelectionCommand
          agents={selectedAgents}
          activity={scopeActivity}
          statusColors={statusColors}
          onClear={onClearSelection}
          onInspect={onInspectAgent}
        />
      ) : agent ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-chrome-label text-muted-foreground">Agent</p>
              <h2 className="mt-1 break-words text-xl font-semibold leading-tight text-foreground">
                {agent.name}
              </h2>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 py-1 font-mono text-chrome-meta text-foreground">
              {light && (
                <StatusLight decorative size="compact" state={light} />
              )}
              {agent.sessionState === 'stopped'
                ? 'Stopped'
                : light
                  ? STATUS_LIGHT_META[light].label
                  : agent.status}
            </span>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm leading-6 text-foreground">{goal?.summary}</p>
            {goal?.context && (
              <p
                className="break-words font-mono text-chrome-meta leading-5 text-muted-foreground"
                title={goal.contextTitle ?? undefined}
              >
                {goal.context}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 divide-x divide-border border-y border-border py-3 text-sm">
            {/* Spend renders only when the source reports it; a source with
                usage but no dollars shows tokens instead (absent, never zero —
                the local and demo transports report no cost by design). */}
            {agent.cost > 0 ? (
              <div className="px-3 first:pl-0">
                <p className="text-chrome-meta text-muted-foreground">Cost</p>
                <p className="mt-1 font-mono text-foreground">
                  {formatCurrency(agent.cost)}
                </p>
              </div>
            ) : agent.rawTokens !== undefined ? (
              <div className="px-3 first:pl-0">
                <p className="text-chrome-meta text-muted-foreground">Tokens</p>
                <p className="mt-1 font-mono text-foreground">
                  {formatTokens(agent.rawTokens)}
                </p>
              </div>
            ) : (
              <div className="px-3 first:pl-0" />
            )}
            <div className="px-3">
              <p className="text-chrome-meta text-muted-foreground">Turns</p>
              <p className="mt-1 font-mono text-foreground">
                {agent.turnCount}
              </p>
            </div>
          </dl>

          {agent.needsOperator && (
            <div
              className="rounded-md border p-3 text-sm"
              style={{
                borderColor: needsOperatorCallout.border,
                background: needsOperatorCallout.background,
                color: needsOperatorCallout.text,
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle
                  className="h-4 w-4"
                  style={{ color: needsOperatorCallout.signal }}
                />
                {agent.blockerTitle ?? 'Needs operator'}
              </div>
              {agent.blockerDescription && (
                <p
                  className="mt-2 line-clamp-3"
                  style={{ color: needsOperatorCallout.detail }}
                >
                  {agent.blockerDescription}
                </p>
              )}
            </div>
          )}

          {/* Delegation is presence-gated (ENG-023): a source that reports no
              children renders no section at all, never an empty "0 delegated". */}
          {delegation && delegation.count > 0 && (
            <PanelSection title="Delegated" count={delegation.count}>
              <ul className="space-y-1.5">
                {shownChildren.map(child => {
                  const elapsed = elapsedSince(child.startedAt, now);
                  return (
                    <li
                      key={child.id}
                      data-delegated-child={child.id}
                      className="flex items-baseline gap-2"
                    >
                      <span className="shrink-0 font-mono text-chrome-micro text-muted-foreground">
                        {child.agentType ?? 'Agent'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-chrome-meta text-foreground">
                        {child.description ?? 'No description reported'}
                      </span>
                      {elapsed && (
                        <span className="shrink-0 font-mono text-chrome-micro tabular-nums text-muted-foreground">
                          {elapsed}
                        </span>
                      )}
                    </li>
                  );
                })}
                {hiddenChildren > 0 && (
                  <li className="text-chrome-meta text-muted-foreground">
                    {hiddenChildren} more
                  </li>
                )}
              </ul>
            </PanelSection>
          )}

          {activity.length > 0 && (
            <PanelSection title="Recent">
              <ul className="space-y-2">
                {activity.map(item => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border bg-background/50 p-2.5 text-sm leading-5 text-foreground"
                  >
                    {item.content}
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

          {handoffError && (
            <p
              role="alert"
              className="border p-3 text-sm leading-5"
              style={{
                borderColor: faultCallout.border,
                background: faultCallout.background,
                color: faultCallout.text,
              }}
            >
              {handoffError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-open-agent-session={agent.id}
              disabled={opening}
              onClick={onOpenSession}
            >
              {opening
                ? 'Opening…'
                : agent.sessionState === 'stopped'
                  ? 'Open stopped session'
                  : 'Open session'}
            </Button>
            {agent.needsOperator && !isDemo && (
              <Button asChild variant="destructive">
                <Link href={`/fleet/${encodeURIComponent(agent.id)}`}>
                  Clear
                </Link>
              </Button>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}
