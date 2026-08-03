'use client';

import { useMemo, useRef, useState } from 'react';
import { ReloadIcon } from '@radix-ui/react-icons';
import { HUD } from '@/components/hud';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import {
  delegationCopy,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from '@/components/workspace/status-glyphs';
import type { PtyHarness, SessionDelegation } from '@/types/electron';

type FixtureMode = 'populated' | 'loading' | 'empty' | 'error';
type Filter = 'all' | 'attention' | 'working';

interface SessionStateFixture {
  id: string;
  project: string;
  projectColor: string;
  goal: string;
  harness: Exclude<PtyHarness, 'shell'>;
  glyphState: SessionGlyphState;
  attention?: SessionAttentionSignal;
  /** harness-reported delegation (ENG-023 D3a) — drives dots and the rail */
  delegation?: SessionDelegation;
  activity: string;
  meaningfulChange: string;
  planStep: string | null;
  planIndex: number | null;
  planTotal: number | null;
  initiative?: { id: string; name: string; goal: string };
}

/** Fixture clock: child elapsed labels need plausible, stable start times. */
const STUDY_NOW = Date.now();
const minutesAgo = (minutes: number) => STUDY_NOW - minutes * 60_000;

const SESSION_FIXTURES: SessionStateFixture[] = [
  {
    id: 'auth-redirect',
    project: 'cortex-ehr',
    projectColor: '#54c9ba',
    goal: 'Fix auth redirect loop',
    harness: 'codex',
    glyphState: 'done',
    attention: { kind: 'roadmap-blocked', since: 0 },
    activity: 'Waiting on the ownership boundary for return-path state',
    meaningfulChange: 'Compared callback and middleware ownership',
    planStep: 'Decide ownership',
    planIndex: 3,
    planTotal: 5,
    initiative: {
      id: 'init-demo-polish',
      name: 'Investor demo polish',
      goal: 'Make the product legible in one live walkthrough.',
    },
  },
  {
    id: 'mmhc-baa',
    project: 'cortex-ehr',
    projectColor: '#54c9ba',
    goal: 'Complete MMHC conversion and secure BAA',
    harness: 'claude',
    glyphState: 'working',
    // The delegating parent (ENG-023 D3a): its own turn is over, the team is
    // not — dots beside the light, per-child rail in Now.
    delegation: {
      ownTurn: 'available',
      blockedOn: null,
      children: [
        {
          id: 'child-a',
          agentType: 'Explore',
          description: 'Map conversion checklist coverage',
          startedAt: minutesAgo(4),
        },
        {
          id: 'child-b',
          agentType: 'general-purpose',
          description: 'Draft the BAA execution summary',
          startedAt: minutesAgo(3),
        },
        {
          id: 'child-c',
          agentType: 'Explore',
          description: 'Trace signature-flow blockers',
          startedAt: minutesAgo(1),
        },
      ],
    },
    activity: 'Coordinating delegated review of the agreement',
    meaningfulChange: 'Restored the exact prior Session and context',
    planStep: 'Secure agreement',
    planIndex: 2,
    planTotal: 4,
  },
  {
    id: 'raf-fanout',
    project: 'Lens',
    projectColor: '#c8a55c',
    goal: 'Audit the RAF scheduler across surfaces',
    harness: 'claude',
    glyphState: 'working',
    // The fan-out shape: more children than rows, so the rail summarizes and
    // the exact census stays in the presence-dot tooltip. One child has no
    // spawn label — absent renders as absent, never invented.
    delegation: {
      ownTurn: 'generating',
      blockedOn: null,
      children: [
        {
          id: 'fan-1',
          agentType: 'Explore',
          description: 'Sweep RAF call sites in the renderer',
          startedAt: minutesAgo(7),
        },
        {
          id: 'fan-2',
          agentType: 'code-reviewer',
          description: null,
          startedAt: minutesAgo(6),
        },
        {
          id: 'fan-3',
          agentType: 'Explore',
          description: 'Compare scheduler drift across displays',
          startedAt: minutesAgo(5),
        },
        {
          id: 'fan-4',
          agentType: 'general-purpose',
          description: 'Reproduce the dropped-frame trace',
          startedAt: minutesAgo(2),
        },
        {
          id: 'fan-5',
          agentType: 'Explore',
          description: 'Collect frame budgets per surface',
          startedAt: minutesAgo(1),
        },
      ],
    },
    activity: 'Fanning out the audit across five delegated agents',
    meaningfulChange: 'Found two competing schedulers in the workspace',
    planStep: 'Audit surfaces',
    planIndex: 1,
    planTotal: 3,
  },
  {
    id: 'raf-lens',
    project: 'Lens',
    projectColor: '#c8a55c',
    goal: 'Shape the RAF feature proposal for Lens',
    harness: 'codex',
    glyphState: 'done',
    activity: 'A design tradeoff is ready for review',
    meaningfulChange: 'Narrowed scheduling to two viable boundaries',
    planStep: 'Shape proposal',
    planIndex: 3,
    planTotal: 4,
  },
  {
    id: 'patty-thread',
    project: 'Workmusic',
    projectColor: '#7fa98f',
    goal: 'Find the recent conversation with Patty',
    harness: 'claude',
    glyphState: 'quiet',
    activity: 'Durable state is saved; no process is running',
    meaningfulChange: 'Located two conversations matching the context',
    planStep: null,
    planIndex: null,
    planTotal: null,
  },
];

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1" aria-label={label} role="group">
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="rounded-[2px] border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] outline-none transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
            style={{
              color: active ? HUD.text : HUD.textDim,
              borderColor: active ? HUD.strokeSoft : 'transparent',
              background: active ? HUD.fillHi : 'transparent',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SessionTile({
  tile,
  selected,
  tileRef,
  onFocus,
  onOpen,
  onMove,
}: {
  tile: SessionStateFixture;
  selected: boolean;
  tileRef: (node: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onOpen: () => void;
  onMove: (delta: number) => void;
}) {
  return (
    <button
      ref={tileRef}
      type="button"
      // Mirrors production: the subtree is presentational, so the delegation
      // census lives in the accessible name or nowhere (ENG-023 D3a).
      aria-label={`Open ${tile.goal} at the Agent altitude${(() => {
        const census = delegationCopy(tile.delegation);
        return census ? `, ${census}` : '';
      })()}`}
      data-session-state-tile
      data-selected={selected || undefined}
      onClick={onOpen}
      onFocus={onFocus}
      onMouseEnter={onFocus}
      onKeyDown={event => {
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        if (
          event.key === 'ArrowRight' ||
          event.key === 'ArrowDown' ||
          (plain && event.key === 'j')
        ) {
          event.preventDefault();
          onMove(1);
        } else if (
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowUp' ||
          (plain && event.key === 'k')
        ) {
          event.preventDefault();
          onMove(-1);
        }
      }}
      className="relative flex h-[272px] w-[300px] max-w-full flex-col overflow-hidden rounded border p-3 text-left outline-none transition-[background-color,border-color,transform] duration-150 active:scale-[0.985] focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
      style={{
        color: HUD.text,
        borderColor: selected ? tile.projectColor : `${tile.projectColor}4d`,
        background: selected ? 'rgba(16,26,36,0.96)' : 'rgba(7,12,20,0.94)',
        boxShadow: selected ? `inset 0 0 0 1px ${tile.projectColor}1f` : 'none',
      }}
    >
      <SessionOverviewCardContent
        title={tile.goal}
        titleIsContext
        color={tile.projectColor}
        harness={tile.harness}
        glyphState={tile.glyphState}
        attention={tile.attention}
        delegation={tile.delegation}
        initiative={tile.initiative}
        current={tile.activity}
        meaningfulChange={tile.meaningfulChange}
        next={tile.planStep ?? 'No plan reported'}
        nextProgress={
          tile.planIndex && tile.planTotal
            ? `Step ${tile.planIndex} of ${tile.planTotal}`
            : null
        }
      />
    </button>
  );
}

function LoadingTile() {
  return (
    <div
      aria-hidden="true"
      className="flex h-[272px] w-[300px] max-w-full animate-pulse flex-col rounded border border-white/10 p-3 motion-reduce:animate-none"
      style={{ background: 'rgba(7,12,20,0.94)' }}
    >
      <div className="h-3 w-28 rounded-sm bg-white/10" />
      <div className="mt-3 h-4 w-4/5 rounded-sm bg-white/10" />
      <div className="mt-2 h-4 w-2/3 rounded-sm bg-white/10" />
      <div className="mt-6 h-3 w-20 rounded-sm bg-white/10" />
      <div className="mt-2 h-3 w-11/12 rounded-sm bg-white/10" />
      <div className="mt-2 h-3 w-3/4 rounded-sm bg-white/10" />
      <div className="mt-auto h-7 border-t border-white/10 pt-2">
        <div className="h-2.5 w-2/3 rounded-sm bg-white/10" />
      </div>
    </div>
  );
}

export function SessionStateTileStudy() {
  const [mode, setMode] = useState<FixtureMode>('populated');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState(SESSION_FIXTURES[0].id);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleTiles = useMemo(
    () =>
      SESSION_FIXTURES.filter(tile => {
        if (filter === 'attention') return Boolean(tile.attention);
        if (filter === 'working') return tile.glyphState === 'working';
        return true;
      }),
    [filter]
  );

  const projects = useMemo(
    () => Array.from(new Set(visibleTiles.map(tile => tile.project))),
    [visibleTiles]
  );

  const focusTile = (index: number) => {
    const bounded = Math.max(0, Math.min(visibleTiles.length - 1, index));
    tileRefs.current[bounded]?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <SegmentedControl
          label="Fixture state"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'populated', label: 'Live' },
            { value: 'loading', label: 'Loading' },
            { value: 'empty', label: 'Empty' },
            { value: 'error', label: 'Error' },
          ]}
        />
      </div>

      <div
        className="overflow-hidden rounded-[2px] border bg-[#070b12]"
        style={{ borderColor: HUD.strokeSoft }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-4"
          style={{ borderColor: HUD.divider, background: HUD.surfaceInputSoft }}
        >
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h3 className="font-display text-sm font-semibold tracking-tight">
              Projects &amp; Sessions
            </h3>
            <span
              className="font-mono text-[10px] tabular-nums"
              style={{ color: HUD.textDim }}
            >
              {mode === 'populated'
                ? `${visibleTiles.length} open`
                : 'state specimen'}
            </span>
          </div>
          <SegmentedControl
            label="Filter Sessions"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'attention', label: 'Needs you' },
              { value: 'working', label: 'Working' },
            ]}
          />
        </div>

        {mode === 'loading' && (
          <div
            aria-label="Loading Session tiles"
            className="flex flex-wrap gap-3 p-4"
          >
            <LoadingTile />
            <LoadingTile />
          </div>
        )}

        {mode === 'empty' && (
          <div className="flex min-h-64 flex-col items-start justify-center px-5 py-12 sm:px-8">
            <span className="mb-4 size-6 rounded-full border border-white/20" />
            <p className="font-display text-sm font-medium">No open Sessions</p>
            <p
              className="mt-1 max-w-sm text-xs leading-relaxed"
              style={{ color: HUD.textDim }}
            >
              Open a Project or start an Agent. Session tiles appear when there
              is work to compare.
            </p>
          </div>
        )}

        {mode === 'error' && (
          <div className="flex min-h-64 flex-col items-start justify-center px-5 py-12 sm:px-8">
            <span
              className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em]"
              style={{ color: HUD.amber }}
            >
              Source unavailable
            </span>
            <p className="font-display text-sm font-medium">
              Session state could not refresh
            </p>
            <p
              className="mt-1 max-w-md text-xs leading-relaxed"
              style={{ color: HUD.textDim }}
            >
              Exawatt will not reuse stale activity as current truth. Existing
              durable Session identity remains intact.
            </p>
            <button
              type="button"
              onClick={() => setMode('populated')}
              className="mt-4 inline-flex items-center gap-1.5 rounded-[2px] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] outline-none transition-transform active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
              style={{
                color: HUD.text,
                borderColor: HUD.strokeSoft,
                background: HUD.fill,
              }}
            >
              <ReloadIcon />
              Retry
            </button>
          </div>
        )}

        {mode === 'populated' && (
          <div className="flex flex-col gap-5 p-3 sm:p-4">
            {projects.map(project => {
              const projectTiles = visibleTiles.filter(
                tile => tile.project === project
              );
              const projectColor = projectTiles[0]?.projectColor ?? HUD.idle;
              return (
                <section key={project} aria-label={`${project} Agents`}>
                  <div
                    className="mb-2 flex items-center gap-2 border-b pb-2"
                    style={{ borderColor: `${projectColor}33` }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-[3px] rounded-full"
                      style={{ background: projectColor }}
                    />
                    <h4 className="font-display text-sm font-semibold">
                      {project}
                    </h4>
                    <span
                      className="font-mono text-chrome-meta uppercase tracking-[0.1em]"
                      style={{ color: HUD.textDim }}
                    >
                      {projectTiles.length}{' '}
                      {projectTiles.length === 1 ? 'Agent' : 'Agents'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {projectTiles.map(tile => {
                      const index = visibleTiles.findIndex(
                        item => item.id === tile.id
                      );
                      return (
                        <SessionTile
                          key={tile.id}
                          tile={tile}
                          selected={selectedId === tile.id}
                          tileRef={node => {
                            tileRefs.current[index] = node;
                          }}
                          onFocus={() => setSelectedId(tile.id)}
                          onMove={delta => focusTile(index + delta)}
                          onOpen={() => {
                            setSelectedId(tile.id);
                            setLastOpened(
                              `Agent · ${tile.project} / ${tile.goal}`
                            );
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div
          className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2 sm:px-4"
          style={{ borderColor: HUD.divider, background: HUD.surfaceInputSoft }}
        >
          <p
            className="font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: HUD.textDim }}
          >
            arrows or j/k move · Enter opens Terminal
          </p>
          {lastOpened && (
            <p
              aria-live="polite"
              className="truncate font-mono text-[9px]"
              style={{ color: HUD.cyan2 }}
            >
              {lastOpened}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
