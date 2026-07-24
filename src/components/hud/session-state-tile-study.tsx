'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronRightIcon, ReloadIcon } from '@radix-ui/react-icons';
import { HUD } from '@/components/hud';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import {
  SessionStatusGlyph,
  type SessionAttentionSignal,
  type SessionGlyphState,
} from '@/components/workspace/status-glyphs';
import type { PtyHarness } from '@/types/electron';

type EventKind = 'Asked' | 'Recovered' | 'Decided' | 'Found';
type FixtureMode = 'populated' | 'loading' | 'empty' | 'error';
type Filter = 'all' | 'attention' | 'working';

interface SessionStateFixture {
  id: string;
  project: string;
  projectColor: string;
  title: string;
  harness: Exclude<PtyHarness, 'shell'>;
  glyphState: SessionGlyphState;
  attention?: SessionAttentionSignal;
  stateLabel: string;
  activity: string;
  eventKind: EventKind;
  event: string;
  planStep: string | null;
  planIndex: number | null;
  planTotal: number | null;
  age: string;
}

const SESSION_FIXTURES: SessionStateFixture[] = [
  {
    id: 'auth-redirect',
    project: 'cortex-ehr',
    projectColor: '#54c9ba',
    title: 'Fix auth redirect loop',
    harness: 'codex',
    glyphState: 'done',
    attention: { kind: 'roadmap-blocked', since: 0 },
    stateLabel: 'Needs you',
    activity: 'Waiting on the ownership boundary for return-path state',
    eventKind: 'Asked',
    event: 'Compared callback and middleware ownership',
    planStep: 'Decide ownership',
    planIndex: 3,
    planTotal: 5,
    age: '2m',
  },
  {
    id: 'mmhc-baa',
    project: 'cortex-ehr',
    projectColor: '#54c9ba',
    title: 'Complete MMHC conversion, secure BAA',
    harness: 'claude',
    glyphState: 'working',
    stateLabel: 'Working',
    activity: 'Preparing the scoped agreement execution checklist',
    eventKind: 'Recovered',
    event: 'Restored the exact prior Session and context',
    planStep: 'Secure agreement',
    planIndex: 2,
    planTotal: 4,
    age: '42s',
  },
  {
    id: 'raf-lens',
    project: 'Lens',
    projectColor: '#c8a55c',
    title: 'Plan RAF feature for Lens',
    harness: 'codex',
    glyphState: 'done',
    stateLabel: 'Result ready',
    activity: 'A design tradeoff is ready for review',
    eventKind: 'Decided',
    event: 'Narrowed scheduling to two viable boundaries',
    planStep: 'Shape proposal',
    planIndex: 3,
    planTotal: 4,
    age: '8m',
  },
  {
    id: 'patty-thread',
    project: 'Workmusic',
    projectColor: '#7fa98f',
    title: 'Find the recent conversation with Patty',
    harness: 'claude',
    glyphState: 'quiet',
    stateLabel: 'Stopped',
    activity: 'Durable state is saved; no process is running',
    eventKind: 'Found',
    event: 'Located two conversations matching the context',
    planStep: null,
    planIndex: null,
    planTotal: null,
    age: '1d',
  },
];

const EVENT_COLOR: Record<EventKind, string> = {
  Asked: HUD.amber,
  Recovered: HUD.cyan2,
  Decided: HUD.green,
  Found: HUD.textMono,
};

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

function PlanSpine({ tile }: { tile: SessionStateFixture }) {
  if (!tile.planStep || !tile.planIndex || !tile.planTotal) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-[11px]" style={{ color: HUD.textDim }}>
          No plan reported
        </span>
        <span
          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em]"
          style={{ color: 'rgba(138,160,190,0.55)' }}
        >
          Source truth
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[11px]" style={{ color: HUD.text }}>
          {tile.planStep}
        </span>
        <span
          className="shrink-0 font-mono text-[10px] tabular-nums"
          style={{ color: HUD.textMono }}
        >
          {tile.planIndex}/{tile.planTotal}
        </span>
      </div>
      <div aria-hidden="true" className="mt-1.5 flex gap-1">
        {Array.from({ length: tile.planTotal }, (_, index) => {
          const step = index + 1;
          const complete = step < tile.planIndex!;
          const current = step === tile.planIndex;
          return (
            <span
              key={step}
              className="h-px flex-1"
              style={{
                background: complete
                  ? HUD.green
                  : current
                    ? HUD.cyan
                    : 'rgba(138,160,190,0.22)',
              }}
            />
          );
        })}
      </div>
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
      aria-label={`Open ${tile.title} in Terminal`}
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
      className="group/tile relative flex h-[238px] w-[300px] max-w-full flex-col overflow-hidden rounded border p-3 text-left outline-none transition-[background-color,border-color,transform] duration-150 active:scale-[0.985] focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
      style={{
        color: HUD.text,
        borderColor: selected ? tile.projectColor : `${tile.projectColor}4d`,
        background: selected ? 'rgba(16,26,36,0.96)' : 'rgba(7,12,20,0.94)',
        boxShadow: selected ? `inset 0 0 0 1px ${tile.projectColor}1f` : 'none',
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-3 left-0 w-[3px] rounded-r-full"
        style={{ background: tile.projectColor }}
      />

      <span className="flex min-w-0 items-center gap-1.5 pl-1">
        <span style={{ color: tile.projectColor }}>
          <HarnessGlyph harness={tile.harness} size={11} />
        </span>
        <span
          className="truncate font-mono text-[9px] uppercase tracking-[0.12em]"
          style={{ color: HUD.textDim }}
        >
          {tile.harness === 'claude' ? 'Claude Code' : 'Codex'}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className="font-mono text-[9px] uppercase tracking-[0.08em]"
            style={{ color: HUD.textDim }}
          >
            {tile.stateLabel}
          </span>
          <SessionStatusGlyph
            state={tile.glyphState}
            attention={tile.attention}
          />
        </span>
      </span>

      <span className="mt-2 line-clamp-2 min-h-10 pl-1 font-display text-sm font-semibold leading-5">
        {tile.title}
      </span>

      <span className="mt-3 min-w-0 pl-1">
        <span
          className="block font-mono text-[8px] uppercase tracking-[0.16em]"
          style={{ color: HUD.textDim }}
        >
          Now
        </span>
        <span className="mt-1 line-clamp-2 block min-h-8 text-[11px] leading-4">
          {tile.activity}
        </span>
      </span>

      <span
        className="mt-2 flex min-w-0 items-start gap-1.5 border-t pl-1 pt-2 text-[10px] leading-4"
        style={{ borderColor: HUD.divider }}
      >
        <span
          className="shrink-0 font-mono uppercase tracking-[0.08em]"
          style={{ color: EVENT_COLOR[tile.eventKind] }}
        >
          {tile.eventKind}
        </span>
        <span aria-hidden="true" className="text-white/20">
          ·
        </span>
        <span className="line-clamp-2" style={{ color: HUD.textDim }}>
          {tile.event}
        </span>
      </span>

      <span
        className="mt-auto border-t pl-1 pt-2"
        style={{ borderColor: HUD.divider }}
      >
        <span className="flex items-center justify-between gap-3">
          <span
            className="font-mono text-[8px] uppercase tracking-[0.16em]"
            style={{ color: HUD.textDim }}
          >
            Next
          </span>
          <span
            className="font-mono text-[9px] tabular-nums"
            style={{ color: HUD.textDim }}
          >
            {tile.age}
          </span>
        </span>
        <span className="mt-1 block">
          <PlanSpine tile={tile} />
        </span>
      </span>

      <ChevronRightIcon
        aria-hidden="true"
        className="absolute bottom-3 right-2.5 translate-x-1 text-white/0 transition-[color,transform] group-hover/tile:translate-x-0 group-hover/tile:text-white/50 group-focus-visible/tile:translate-x-0 group-focus-visible/tile:text-white/50 motion-reduce:transition-none"
      />
    </button>
  );
}

function LoadingTile() {
  return (
    <div
      aria-hidden="true"
      className="flex h-[238px] w-[300px] max-w-full animate-pulse flex-col rounded border border-white/10 p-3 motion-reduce:animate-none"
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="max-w-[72ch] text-xs leading-relaxed"
          style={{ color: HUD.textDim }}
        >
          The five operator questions now live inside the existing Session tile
          geometry. Status is the production Session glyph; activating a tile
          zooms to Terminal and never opens inline detail.
        </p>
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
                <section key={project} aria-label={`${project} Sessions`}>
                  <div
                    className="mb-2 flex items-center gap-2 border-b pb-2"
                    style={{ borderColor: `${projectColor}33` }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-[3px] rounded-full"
                      style={{ background: projectColor }}
                    />
                    <h4 className="font-display text-xs font-semibold">
                      {project}
                    </h4>
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.1em]"
                      style={{ color: HUD.textDim }}
                    >
                      {projectTiles.length}{' '}
                      {projectTiles.length === 1 ? 'Session' : 'Sessions'}
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
                              `Terminal · ${tile.project} / ${tile.title}`
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
            arrows or j/k move · Enter opens Terminal · no inline expansion
          </p>
          <p
            aria-live="polite"
            className="truncate font-mono text-[9px]"
            style={{ color: lastOpened ? HUD.cyan2 : HUD.textDim }}
          >
            {lastOpened ?? 'Navigation target appears here'}
          </p>
        </div>
      </div>
    </div>
  );
}
