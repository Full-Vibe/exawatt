'use client';

import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  selectSpatialBandSelection,
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';
import {
  BOARD_STUDY_FIXTURES,
  boardStudyFleet,
  type BoardStudyFixtureId,
} from '@/components/hud/board-study-fixtures';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import { spatialThemeFromResolvedAppearance } from '@/components/fleet/spatial/spatial-theme';
import type { OperationsBoardHandle } from '@/components/fleet/spatial/operations-board/operations-board-camera-rig';
import type {
  OperationsBoardTilesProps,
  BoardTileMaterial,
} from '@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas';
import { boardStudySourceMarks } from '@/components/hud/board-study-fixtures';
import { resolvedAppearanceCssVariables } from '@/lib/appearance/dom-adapter';
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

const TilesCanvas = lazy(() =>
  import('@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas').then(
    module => ({ default: module.OperationsBoardTilesCanvas })
  )
);
const MATERIALS = ['gummy', 'matte', 'glazed', 'acrylic', 'anodized'] as const;

const THEMES = {
  classic: 'exawatt-classic-dark',
  air: 'exawatt-air-light',
  night: 'exawatt-night-dark',
} as const satisfies Record<string, BuiltInThemeId>;

type ThemeKey = keyof typeof THEMES;
interface StudyState {
  fixture: BoardStudyFixtureId;
  view: 'v1' | 'v2';
  material: BoardTileMaterial | 'compare';
  greybox: boolean;
  altitude: 'fleet' | 'project';
  theme: ThemeKey;
  projection: 'top-down' | 'fixed-angle';
  selectedProjectId: string | null;
}

const DEFAULTS: StudyState = {
  fixture: 'voltaic',
  view: 'v1',
  material: 'compare',
  greybox: false,
  altitude: 'fleet',
  theme: 'classic',
  projection: 'top-down',
  selectedProjectId: null,
};

function readState(search: string): StudyState {
  const params = new URLSearchParams(search);
  const fixture = params.get('fixture');
  const altitude = params.get('altitude');
  const theme = params.get('theme');
  const projection = params.get('projection');
  const material = params.get('material');
  return {
    view: params.get('view') === 'v2' ? 'v2' : 'v1',
    material: MATERIALS.includes(material as BoardTileMaterial)
      ? (material as BoardTileMaterial)
      : 'compare',
    greybox: params.get('greybox') === 'true',
    fixture: BOARD_STUDY_FIXTURES.some(entry => entry.id === fixture)
      ? (fixture as BoardStudyFixtureId)
      : DEFAULTS.fixture,
    altitude: altitude === 'project' ? 'project' : 'fleet',
    theme: theme && theme in THEMES ? (theme as ThemeKey) : DEFAULTS.theme,
    projection: projection === 'fixed-angle' ? 'fixed-angle' : 'top-down',
    selectedProjectId: params.get('project'),
  };
}

function href(state: StudyState, patch: Partial<StudyState>): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams({
    fixture: next.fixture,
    view: next.view,
    material: next.material,
    greybox: String(next.greybox),
    altitude: next.altitude,
    theme: next.theme,
    projection: next.projection,
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

  const fleetState = useMemo(
    () => boardStudyFleet(state.fixture),
    [state.fixture]
  );
  const layout = useMemo(() => {
    const base = selectSpatialBoardLayout(fleetState);
    const selectedProjectId = base.zones.some(
      zone => zone.id === state.selectedProjectId && !zone.isAggregate
    )
      ? state.selectedProjectId
      : (base.zones.find(zone => !zone.isAggregate)?.id ?? null);
    return selectSpatialBoardLayout(fleetState, {
      altitude: state.altitude,
      focusedProjectId: state.altitude === 'project' ? selectedProjectId : null,
      selectedProjectId,
    });
  }, [fleetState, state.altitude, state.selectedProjectId]);

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

  const sourceMarks = useMemo(
    () => boardStudySourceMarks(state.fixture),
    [state.fixture]
  );
  const theme = useMemo(
    () => spatialThemeFromResolvedAppearance(resolvedAppearance),
    [resolvedAppearance]
  );
  const active = BOARD_STUDY_FIXTURES.find(
    entry => entry.id === state.fixture
  )!;

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6"
      style={resolvedAppearanceCssVariables(resolvedAppearance)}
      data-exa-theme={resolvedAppearance.themeId}
      data-exa-appearance={resolvedAppearance.appearance}
      data-exa-font={resolvedAppearance.interfaceFont}
      data-exa-typography={resolvedAppearance.theme.typography.profile}
      data-board-study={state.fixture}
      data-board-study-view={state.view}
      data-board-study-altitude={state.altitude}
    >
      <div className="mx-auto flex max-w-[1920px] flex-col gap-4">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-chrome-micro text-muted-foreground">
            <Link href="/hud-gallery" className="hover:text-foreground">
              HUD Gallery
            </Link>{' '}
            / Fleet board
          </p>
          <h1 className="text-surface-title font-semibold">Fleet board</h1>
          <p className="text-chrome-meta text-muted-foreground">
            {state.view === 'v2' ? 'v2 · Look review' : 'v1'} · Representative
            data
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border p-3">
          <Control
            label="View"
            options={(['v1', 'v2'] as const).map(value => ({
              value,
              label: value,
              href: href(state, { view: value }),
            }))}
            current={state.view}
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
          {state.view === 'v1' && (
            <Control
              label="Projection"
              options={(['top-down', 'fixed-angle'] as const).map(value => ({
                value,
                label: value === 'top-down' ? 'Top' : 'Angle',
                href: href(state, { projection: value }),
              }))}
              current={state.projection}
            />
          )}
          {state.view === 'v2' && (
            <>
              <Control
                label="Material"
                options={(['compare', ...MATERIALS] as const).map(value => ({
                  value,
                  label:
                    value === 'compare'
                      ? 'Side by side'
                      : value[0].toUpperCase() + value.slice(1),
                  href: href(state, { material: value }),
                }))}
                current={state.material}
              />
              <Control
                label="Render"
                options={[
                  {
                    value: 'look',
                    label: 'Materials',
                    href: href(state, { greybox: false }),
                  },
                  {
                    value: 'greybox',
                    label: 'Greybox',
                    href: href(state, { greybox: true }),
                  },
                ]}
                current={state.greybox ? 'greybox' : 'look'}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-chrome-meta text-muted-foreground">
          <span>{active.note}</span>
        </div>

        {state.view === 'v2' ? (
          <div
            className={
              state.material === 'compare'
                ? 'grid gap-4 lg:grid-cols-3 2xl:grid-cols-5'
                : 'grid gap-4'
            }
          >
            {(state.material === 'compare' ? MATERIALS : [state.material]).map(
              material => (
                <section
                  key={material}
                  className="min-w-0"
                  data-tile-specimen={material}
                >
                  <h2 className="mb-2 text-chrome-title font-semibold">
                    {material[0].toUpperCase() + material.slice(1)}
                  </h2>
                  <div className="relative isolate h-[68svh] min-h-[480px] overflow-hidden rounded-lg border border-border">
                    <BoardTileSpecimen
                      layout={layout}
                      projection="fixed-angle"
                      theme={theme}
                      material={material}
                      greybox={state.greybox}
                      sourceMarks={sourceMarks}
                      onDrillProject={selectProject}
                      onSelectAgent={toggleAgent}
                      onBackground={() => setSelected(new Set())}
                      multiSelection={selected}
                      onToggleAgentSelect={toggleAgent}
                      onBandSelect={bandSelect}
                      preserveDrawingBuffer
                    />
                  </div>
                </section>
              )
            )}
          </div>
        ) : (
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
            />
          </div>
        )}
      </div>
    </main>
  );
}

function BoardTileSpecimen(
  props: Omit<OperationsBoardTilesProps, 'controllerRef'>
) {
  const controller = useRef<OperationsBoardHandle | null>(null);
  const band = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-chrome-meta text-muted-foreground">
            Loading v2…
          </div>
        }
      >
        <TilesCanvas
          {...props}
          controllerRef={controller}
          bandOverlayRef={band}
        />
      </Suspense>
      <div
        ref={band}
        aria-hidden="true"
        className="pointer-events-none absolute z-10 border border-dashed"
        style={{
          display: 'none',
          borderColor: props.theme.selection,
          background: props.theme.selectionWash,
        }}
      />
    </>
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
