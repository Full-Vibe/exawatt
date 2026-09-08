'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  selectSpatialBandSelection,
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  type SpatialBoardRect,
  type SpatialBoardProjectPacking,
} from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';
import type { BoardProjectEmphasis } from '@/components/fleet/spatial/operations-board/operations-board-presentation';
import {
  BOARD_STUDY_FIXTURES,
  boardStudyFleet,
  type BoardStudyFixtureId,
} from '@/components/hud/board-study-fixtures';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import type { BuiltInThemeId } from '@/lib/appearance/types';

/**
 * Fleet board study (ENG-004, operator 2026-08-11).
 *
 * The board's open problems are visual — packing, mark legibility at small
 * unit sizes, transition feel, how much the labels are trying to say — and
 * every one of them was previously reproduced by starting a desktop app and
 * navigating to the right state. This renders the REAL board surface over
 * deterministic fixtures, with every knob in the URL, so any state is one link
 * and a screenshot away.
 *
 * It is a standing bench, not a study to retire: its subject is the shipped
 * board, and the thing it provides is the iteration loop rather than a
 * proposed design.
 */

const THEMES = {
  classic: 'exawatt-classic-dark',
  air: 'exawatt-air-light',
  night: 'exawatt-night-dark',
} as const satisfies Record<string, BuiltInThemeId>;

type ThemeKey = keyof typeof THEMES;
type DirectionId = 'lattice' | 'honeycomb' | 'focus';

interface FleetDirection {
  label: string;
  note: string;
  packing: SpatialBoardProjectPacking;
  projectEmphasis: BoardProjectEmphasis;
}

const DIRECTIONS: Record<DirectionId, FleetDirection> = {
  lattice: {
    label: 'Stable lattice',
    note: 'Balanced addresses · selected Project gets a precise outer ring.',
    packing: 'balanced',
    projectEmphasis: 'outline',
  },
  honeycomb: {
    label: 'Close pack',
    note: 'Staggered rows · selected Project lifts without moving its address.',
    packing: 'honeycomb',
    projectEmphasis: 'lift',
  },
  focus: {
    label: 'Focus field',
    note: 'Balanced addresses · selected Project holds contrast while peers recede.',
    packing: 'balanced',
    projectEmphasis: 'focus',
  },
};

interface StudyState {
  fixture: BoardStudyFixtureId;
  altitude: 'fleet' | 'project';
  theme: ThemeKey;
  projection: 'top-down' | 'fixed-angle';
  direction: DirectionId;
  selectedProjectId: string | null;
}

const DEFAULTS: StudyState = {
  fixture: 'voltaic',
  altitude: 'fleet',
  theme: 'classic',
  projection: 'top-down',
  direction: 'lattice',
  selectedProjectId: null,
};

function readState(search: string): StudyState {
  const params = new URLSearchParams(search);
  const fixture = params.get('fixture');
  const altitude = params.get('altitude');
  const theme = params.get('theme');
  const projection = params.get('projection');
  const direction = params.get('direction');
  return {
    fixture: BOARD_STUDY_FIXTURES.some(entry => entry.id === fixture)
      ? (fixture as BoardStudyFixtureId)
      : DEFAULTS.fixture,
    altitude: altitude === 'project' ? 'project' : 'fleet',
    theme: theme && theme in THEMES ? (theme as ThemeKey) : DEFAULTS.theme,
    projection: projection === 'fixed-angle' ? 'fixed-angle' : 'top-down',
    direction:
      direction && direction in DIRECTIONS
        ? (direction as DirectionId)
        : DEFAULTS.direction,
    selectedProjectId: params.get('project'),
  };
}

function href(state: StudyState, patch: Partial<StudyState>): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams({
    fixture: next.fixture,
    altitude: next.altitude,
    theme: next.theme,
    projection: next.projection,
    direction: next.direction,
  });
  if (next.selectedProjectId) params.set('project', next.selectedProjectId);
  return `/hud-gallery/board-study?${params.toString()}`;
}

function BoardStudyBench() {
  // Read reactively, so following a control link re-renders the board in place
  // instead of only rewriting the address bar. Snapshotting the search string
  // once at mount left the altitude control dead, which meant the bench could
  // not exercise a board transition at all -- the one thing it exists for.
  const params = useSearchParams();
  const router = useRouter();
  const state = useMemo(() => readState(params.toString()), [params]);
  const direction = DIRECTIONS[state.direction];

  const fleetState = useMemo(
    () => boardStudyFleet(state.fixture),
    [state.fixture]
  );
  const layout = useMemo(() => {
    const base = selectSpatialBoardLayout(fleetState, {
      projectPacking: direction.packing,
    });
    const selectedProjectId = base.zones.some(
      zone => zone.id === state.selectedProjectId && !zone.isAggregate
    )
      ? state.selectedProjectId
      : (base.zones.find(zone => !zone.isAggregate)?.id ?? null);
    return selectSpatialBoardLayout(fleetState, {
      altitude: state.altitude,
      focusedProjectId: state.altitude === 'project' ? selectedProjectId : null,
      selectedProjectId,
      projectPacking: direction.packing,
    });
  }, [direction.packing, fleetState, state.altitude, state.selectedProjectId]);

  const selectProject = useCallback(
    (projectId: string) => {
      router.replace(href(state, { selectedProjectId: projectId }), {
        scroll: false,
      });
    },
    [router, state]
  );

  const resolvedAppearance = useMemo(() => {
    const themeId = THEMES[state.theme];
    const theme = THEME_REGISTRY[themeId];
    return resolveAppearance(
      THEME_REGISTRY,
      {
        schemaVersion: 1,
        selection: { mode: 'manual', themeId },
        accentSource: 'theme',
        interfaceFont: 'theme',
        interfaceScale: 100,
        contrast: 'system',
        transparency: 'system',
      },
      {
        dark: theme.appearance === 'dark',
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );
  }, [state.theme]);

  // Selection is wired so the bench exercises INTERACTION, not just pixels.
  // The marquee-left-on-screen bug could not be reproduced here until it was.
  const delegationUnits = useMemo(
    () => selectSpatialDelegationUnits(layout),
    [layout]
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const bandSelect = useCallback(
    (band: SpatialBoardRect) => {
      const caught = selectSpatialBandSelection(layout, delegationUnits, band);
      setSelected(new Set(caught.agentIds));
    },
    [delegationUnits, layout]
  );
  const toggleAgent = useCallback((agentId: string) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const active = BOARD_STUDY_FIXTURES.find(
    entry => entry.id === state.fixture
  )!;

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6"
      data-board-study={state.fixture}
      data-board-study-altitude={state.altitude}
      data-board-study-direction={state.direction}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-chrome-micro text-muted-foreground">
            <Link href="/hud-gallery" className="hover:text-foreground">
              HUD Gallery
            </Link>{' '}
            / Fleet board
          </p>
          <h1 className="text-surface-title font-semibold">Fleet directions</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Real board, deterministic fleets. Click a Project to move the
            selection; switch to Project altitude to test Agent hover and press.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border p-3">
          <Control
            label="Direction"
            options={(Object.keys(DIRECTIONS) as DirectionId[]).map(value => ({
              value,
              label: DIRECTIONS[value].label,
              href: href(state, { direction: value }),
            }))}
            current={state.direction}
          />
          <Control
            label="Fixture"
            options={BOARD_STUDY_FIXTURES.map(entry => ({
              value: entry.id,
              label: entry.title,
              href: href(state, { fixture: entry.id }),
            }))}
            current={state.fixture}
          />
          <Control
            label="Altitude"
            options={(['fleet', 'project'] as const).map(value => ({
              value,
              label: value === 'fleet' ? 'Fleet' : 'Project',
              href: href(state, { altitude: value }),
            }))}
            current={state.altitude}
          />
          <Control
            label="Theme"
            options={(Object.keys(THEMES) as ThemeKey[]).map(value => ({
              value,
              label: value,
              href: href(state, { theme: value }),
            }))}
            current={state.theme}
          />
          <Control
            label="Projection"
            options={(['top-down', 'fixed-angle'] as const).map(value => ({
              value,
              label: value === 'top-down' ? 'Top' : 'Angle',
              href: href(state, { projection: value }),
            }))}
            current={state.projection}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-chrome-meta text-muted-foreground">
          <span>{direction.note}</span>
          <span>{active.note}</span>
        </div>

        <div className="h-[76svh] min-h-[520px] overflow-hidden rounded-lg border border-border">
          <OperationsBoardSurface
            layout={layout}
            projection={state.projection}
            onDrillProject={selectProject}
            onSelectAgent={() => undefined}
            onOverview={() => undefined}
            onProjectionChange={() => undefined}
            multiSelection={selected}
            onToggleAgentSelect={toggleAgent}
            onBandSelect={bandSelect}
            preserveDrawingBuffer
            resolvedAppearance={resolvedAppearance}
            presentation={{
              projectEmphasis: direction.projectEmphasis,
              agentCandidate: 'precision',
            }}
          />
        </div>
      </div>
    </main>
  );
}

function Control({
  label,
  options,
  current,
}: {
  label: string;
  options: Array<{ value: string; label: string; href: string }>;
  current: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-chrome-micro text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map(option => (
          <Link
            key={option.value}
            href={option.href}
            data-study-option={option.value}
            aria-current={option.value === current ? 'true' : undefined}
            className={`rounded border px-2 py-1 text-chrome-micro transition-colors ${
              option.value === current
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary'
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function BoardStudyPage() {
  return (
    <Suspense fallback={null}>
      <BoardStudyBench />
    </Suspense>
  );
}
