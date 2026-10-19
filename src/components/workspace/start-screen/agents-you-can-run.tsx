'use client';

/**
 * "Agents you can run" (ENG-046 O2, O5): the engines installed on this Mac,
 * each with its one next step when it is not ready, and one "Add an engine"
 * card that opens the full roster in Settings.
 *
 * Only installed engines get a card (operator, 2026-10-15: "I don't want to
 * force (or imply / guide) users to install all three things if that's not
 * their cup of tea"). With none installed, the Add an engine card is the
 * remediation. Nothing installs on the user's behalf.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LoaderCircle, Plus } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  SourceCard,
  sourceAttention,
  sourceCardStep,
} from '@/components/agent-sources/source-card';
import { runAgentSourceAction } from '../agent-sources';
import { openSourceShell } from '../session-jump';
import { WORKSPACE_HUD as HUD } from '../workspace-theme';
import type {
  AgentSourceAdapterId,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
} from '@exawatt/core';
import { joinNames } from './project-suggestions';

/** A local engine this machine has (any state but not installed). */
export function installedEngines(
  registry: AgentSourceRegistrySnapshot
): AgentSourceSnapshot[] {
  return registry.sources.filter(
    source =>
      source.harness !== null &&
      source.capabilities.interactiveLaunch &&
      source.state !== 'not-installed'
  );
}

function AddEngineCard({
  registry,
  alone,
}: {
  registry: AgentSourceRegistrySnapshot;
  alone: boolean;
}) {
  const more = registry.sources
    .filter(
      source => source.harness !== null && source.state === 'not-installed'
    )
    .map(source => source.label);
  // Alone, the card is the whole remediation: it takes the row and names
  // every engine there is. Beside installed engines it is one more card.
  const names =
    !alone && more.length > 3
      ? `${more.slice(0, 3).join(', ')} and more`
      : joinNames(more, 'and');
  return (
    <Link
      href="/settings"
      data-add-engine={alone ? 'alone' : 'beside'}
      className={`group flex min-h-[74px] min-w-0 items-center gap-3 rounded-lg border p-4 outline-none transition-colors hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none ${alone ? 'col-span-full' : ''}`}
      style={{
        borderColor: alone ? HUD.strokeSoft : HUD.strokeFaint,
        background: alone ? HUD.bg.panelFill : 'transparent',
      }}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
        style={{ borderColor: HUD.strokeSoft, color: HUD.text }}
      >
        <Plus className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate font-ui text-sm font-medium"
          style={{ color: HUD.text }}
        >
          Add an engine
        </span>
        {names && (
          <span
            className={`mt-0.5 block font-ui text-chrome-label ${alone ? '' : 'truncate'}`}
            style={{ color: HUD.textDim }}
          >
            {names}
          </span>
        )}
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0"
        style={{ color: HUD.textDim }}
      />
    </Link>
  );
}

export function AgentsYouCanRun({
  registry,
  checking,
  recheck,
}: {
  registry: AgentSourceRegistrySnapshot;
  /** No observation painted yet (neither remembered nor live). */
  checking: boolean;
  recheck: () => Promise<unknown>;
}) {
  const engines = installedEngines(registry);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Freshness ("Checked 2m ago") ticks with the screen, not with a probe.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);
  const [messages, setMessages] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const act = useCallback(
    async (
      source: AgentSourceSnapshot,
      action: 'install-guide' | 'recheck'
    ) => {
      setBusyId(source.id);
      setMessages(current => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      try {
        if (action === 'recheck') {
          await recheck();
          return;
        }
        const result = await runAgentSourceAction(
          source.adapterId as AgentSourceAdapterId,
          action
        );
        setMessages(current => ({
          ...current,
          [source.id]: {
            ok: result.ok,
            text: result.ok
              ? `${result.message} Recheck when you are done.`
              : result.message,
          },
        }));
      } finally {
        setBusyId(null);
      }
    },
    [recheck]
  );

  return (
    <TooltipProvider delayDuration={280}>
      <section
        aria-labelledby="start-agents-heading"
        data-start-section="agents"
        data-installed-engines={checking ? 'checking' : engines.length}
        className="flex flex-col gap-3"
      >
        <div className="flex min-h-8 items-center">
          <h2
            id="start-agents-heading"
            className="font-display text-base font-semibold"
            style={{ color: HUD.text }}
          >
            Agents you can run
          </h2>
        </div>
        <div className="grid grid-cols-1 items-start gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {checking ? (
            <div
              role="status"
              className="flex min-h-[74px] items-center gap-2 rounded-lg border p-4 font-mono text-chrome-meta"
              style={{ borderColor: HUD.strokeFaint, color: HUD.textDim }}
            >
              <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              Checking engines on this Mac…
            </div>
          ) : (
            <>
              {engines.map(source => {
                const step = sourceCardStep(source);
                return (
                  <SourceCard
                    key={source.id}
                    layout="card"
                    identity={{
                      adapterId: source.adapterId,
                      label: source.label,
                      secondary: source.connectionName,
                      color: source.color,
                    }}
                    state={source.state}
                    stateLabel={source.stateLabel}
                    attention={sourceAttention(source)}
                    step={step}
                    onStep={
                      step?.kind === 'sign-in'
                        ? // The source signs in in a Shell tab here
                          // (BUG-275); the card's Recheck reads it after.
                          () => openSourceShell(step.command)
                        : () => void act(source, 'install-guide')
                    }
                    // A ready engine has nothing to repair; its freshness is
                    // the whole story. Anything else can be asked again.
                    onRecheck={
                      source.state === 'ready' || !source.actions.recheck
                        ? null
                        : () => void act(source, 'recheck')
                    }
                    busy={busyId === source.id}
                    message={messages[source.id] ?? null}
                    checkedAt={source.observedAt}
                    now={now}
                  />
                );
              })}
              <AddEngineCard registry={registry} alone={engines.length === 0} />
            </>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
