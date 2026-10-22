'use client';

import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import {
  BOARD_STUDY_FIXTURES,
  boardStudyFleet,
  boardStudySourceMarks,
  type BoardStudyFixtureId,
} from '@/components/hud/board-study-fixtures';
import type { QualityCamera } from './scene';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import { resolvedAppearanceCssVariables } from '@/lib/appearance/dom-adapter';
import { spatialThemeFromResolvedAppearance } from '@/components/fleet/spatial/spatial-theme';
import type { OperationsBoardHandle } from '@/components/fleet/spatial/operations-board/operations-board-camera-rig';
import {
  FLEET_MATERIALS,
  type FleetMaterial,
} from '@exawatt/core/desktop-bridge';

const Candidate = lazy(() =>
  import('./scene').then(module => ({ default: module.QualityCanvas }))
);
const Current = lazy(() =>
  import('@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas').then(
    module => ({ default: module.OperationsBoardTilesCanvas })
  )
);
const THEMES = {
  night: 'exawatt-night-dark',
  air: 'exawatt-air-light',
  classic: 'exawatt-classic-dark',
} as const;

export function QualityStudy() {
  const params = useSearchParams();
  const fixtureParam = params.get('fixture');
  const fixture = (
    BOARD_STUDY_FIXTURES.some(item => item.id === fixtureParam)
      ? fixtureParam
      : 'scale-10'
  ) as BoardStudyFixtureId;
  const [material, setMaterial] = useState<FleetMaterial>('gummy');
  const [themeId, setThemeId] = useState<keyof typeof THEMES>('night');
  const [cameraPreset, setCameraPreset] =
    useState<QualityCamera>('perspective');
  const [recenterToken, setRecenterToken] = useState(0);
  const [current, setCurrent] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [project, setProject] = useState<string | null>(null);
  const controller = useRef<OperationsBoardHandle | null>(null);
  const fleet = useMemo(() => boardStudyFleet(fixture), [fixture]);
  const marks = useMemo(() => boardStudySourceMarks(fixture), [fixture]);
  const layout = useMemo(
    () =>
      selectSpatialBoardLayout(fleet, {
        altitude: project ? 'project' : 'fleet',
        focusedProjectId: project,
      }),
    [fleet, project]
  );
  const appearance = useMemo(
    () =>
      resolveAppearance(
        THEME_REGISTRY,
        {
          schemaVersion: 1,
          selection: { mode: 'manual', themeId: THEMES[themeId] },
          accentSource: 'theme',
          interfaceFont: 'theme',
          interfaceScale: 100,
          contrast: 'system',
          transparency: 'system',
        },
        {
          dark: themeId !== 'air',
          highContrast: false,
          forcedColors: false,
          invertedColors: false,
          reducedTransparency: false,
        }
      ),
    [themeId]
  );
  const theme = useMemo(
    () => spatialThemeFromResolvedAppearance(appearance),
    [appearance]
  );
  const toggle = (id: string) =>
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const Canvas = current ? Current : Candidate;
  return (
    <main
      className="min-h-screen bg-background p-6 font-ui text-foreground"
      style={resolvedAppearanceCssVariables(appearance)}
      data-exa-theme={appearance.themeId}
      data-exa-appearance={appearance.appearance}
      data-exa-typography={appearance.theme.typography.profile}
    >
      <div className="mx-auto flex max-w-[1920px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Link
              className="text-chrome-label text-muted-foreground hover:text-foreground"
              href="/hud-gallery/board-study"
            >
              HUD Gallery / Fleet board
            </Link>
            <h1 className="text-surface-title font-semibold">
              Fleet v2 · Material and territory review
            </h1>
            <p className="text-sm text-muted-foreground">
              The homepage’s materials, on the working board. v1 remains the
              default.
            </p>
          </div>
          <div
            className="flex gap-1 rounded-lg border border-border p-1"
            aria-label="Comparison"
          >
            {[false, true].map(value => (
              <button
                key={String(value)}
                aria-pressed={current === value}
                onClick={() => setCurrent(value)}
                className={`rounded-md px-3 py-2 text-chrome-label transition-colors focus-visible:ring-2 focus-visible:ring-ring ${current === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {value ? 'Current v2' : 'Candidate'}
              </button>
            ))}
          </div>
        </header>
        <div className="flex flex-wrap items-center gap-4 border-y border-border py-3 text-chrome-label">
          <label className="flex items-center gap-2 text-muted-foreground">
            Material{' '}
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
              aria-label="Material"
              value={material}
              onChange={event =>
                setMaterial(event.target.value as FleetMaterial)
              }
            >
              {FLEET_MATERIALS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            Theme{' '}
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
              aria-label="Theme"
              value={themeId}
              onChange={event =>
                setThemeId(event.target.value as keyof typeof THEMES)
              }
            >
              {Object.keys(THEMES).map(id => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            Camera
            <select
              aria-label="Camera"
              disabled={current}
              value={cameraPreset}
              onChange={event =>
                setCameraPreset(event.target.value as QualityCamera)
              }
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground disabled:opacity-40"
            >
              <option value="perspective">High perspective</option>
              <option value="low">Low perspective</option>
              <option value="overhead">Overhead</option>
            </select>
          </label>
          <nav className="flex flex-wrap gap-1" aria-label="Fixture">
            {BOARD_STUDY_FIXTURES.filter(item =>
              [
                'scale-10',
                'scale-100',
                'scale-1000',
                'fanout',
                'stopped',
              ].includes(item.id)
            ).map(item => (
              <Link
                key={item.id}
                href={`?fixture=${item.id}`}
                onClick={() => {
                  setProject(null);
                  setSelected(new Set());
                }}
                aria-current={item.id === fixture ? 'page' : undefined}
                className={`rounded-md px-3 py-2 ${item.id === fixture ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {item.title}
              </Link>
            ))}
          </nav>
        </div>
        <section
          className="relative isolate h-[72svh] min-h-[480px] overflow-hidden rounded-lg border border-border"
          aria-label="Fleet composition review"
          data-quality-candidate={!current}
        >
          <div className="absolute left-4 top-4 z-40 flex items-center gap-3 text-chrome-label">
            <button
              className="rounded-md border border-border bg-background px-3 py-2 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setProject(null);
                controller.current?.recenter();
                setRecenterToken(value => value + 1);
              }}
            >
              Fleet
            </button>
            <span className="text-muted-foreground">
              {layout.stats.sourceAgentCount} Agents ·{' '}
              {layout.stats.sourceProjectCount}{' '}
              {layout.stats.sourceProjectCount === 1 ? 'Project' : 'Projects'}
            </span>
          </div>
          <Suspense
            fallback={
              <div className="grid h-full place-items-center text-muted-foreground">
                Loading board…
              </div>
            }
          >
            <Canvas
              layout={layout}
              cameraPreset={cameraPreset}
              recenterToken={recenterToken}
              theme={theme}
              projection="fixed-angle"
              controllerRef={controller}
              onDrillProject={setProject}
              onSelectAgent={toggle}
              onToggleAgentSelect={toggle}
              onBackground={() => setSelected(new Set())}
              multiSelection={selected}
              material={material}
              sourceMarks={marks}
              preserveDrawingBuffer
            />
          </Suspense>
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex justify-between gap-4 text-chrome-meta text-muted-foreground">
            <span>
              Drag to orbit · Scroll to zoom · Right-drag to pan · Click to
              select
            </span>
            <span>
              {selected.size
                ? `${selected.size} selected`
                : 'Representative data'}
            </span>
          </div>
        </section>
        <p className="text-chrome-label text-muted-foreground">
          Review candidate. Shared hex addresses, perspective cameras and
          color-led status. Agent identity and source state are preserved.
        </p>
      </div>
    </main>
  );
}
