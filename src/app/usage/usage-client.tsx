'use client';

/**
 * The Usage surface (ENG-008) — the production composite. Route `/usage`
 * (renamed from Consumption 2026-08-03; the old route is gone, no redirect).
 * The canonical concept behind it is still Consumption (`concepts.md`); the
 * wattage brand lives inside the page — FLUX channel, headroom — never in
 * the nav label.
 *
 * One page, top to bottom answering: am I OK? → where is it going? → what
 * should I change?
 *
 *   1. demo-data assurance banner
 *   2. plan-window cards — headroom, reset, pace vs even pace, projection;
 *      a source with no plan record rendered absent, never 0%
 *   3. headroom-over-time for the tightest window
 *   4. attribution pivot — bars are doors into the drill panel (the page's
 *      only dollars, labelled modelled)
 *   5. the session grid — every operator session a row, rows are doors too
 *   6. ratio diagnostics as one quiet row, with the ENG-014 allocation
 *      affordance at chip scale
 *
 * Composite of the two operator-picked ENG-008 directions (Console top,
 * Ops-board floor); the explored directions stay frozen in
 * `/hud-gallery/consumption-redesign` as the design record. Supersedes the
 * E4 four-act narrative.
 *
 * Per-tenant source (ENG-027 W2): the Demo tenant reads the Voltaic corpus;
 * Personal keeps the demo week until the E5 live local parse. Both corpora
 * flow through the same view-model and rollups; they never merge. Nothing
 * here reads a file, spawns a process, or makes a network call.
 */
import { useMemo, useState } from 'react';
import { displayUsage, rawTotal } from '@/components/consumption/model';
import { useTenantConsumption } from '@/components/consumption/use-tenant-consumption';
import { CONSUMPTION_SURFACE_NAME } from '@/components/consumption/surface-name';
import {
  CONSUMPTION_CHROME as CHROME,
  exact,
} from '@/components/consumption/flux';
import { SurfaceReadinessMarker } from '@/components/readiness';
import {
  allPaces,
  diagnostics,
  gridRows,
  pivotRows,
  silentSources,
  type PivotKey,
  type PivotRow,
} from './derive';
import { DemoBanner } from './chrome';
import { PlanWindows } from './windows';
import { Attribution, type UnitMode } from './attribution';
import { SessionsGrid } from './sessions-grid';
import { DrillPanel } from './drill-panel';
import { Diagnostics } from './diagnostics';

type DrillSelection =
  | { kind: 'pivot'; id: string }
  | { kind: 'session'; id: string }
  | null;

export function UsageClient() {
  // ONE tenant-aware seam, shared with the ambient chrome meter — the title
  // bar and this page render the same corpus at the same pinned instant.
  const { view: demo, voltaic: inDemoTenant } = useTenantConsumption();

  const raw = rawTotal(
    displayUsage(demo.workspace.totals, demo.workspace.sources)
  );
  const paces = useMemo(() => allPaces(demo), [demo]);
  const silent = useMemo(() => silentSources(demo), [demo]);
  const rows = useMemo(() => gridRows(demo), [demo]);
  const diags = useMemo(() => diagnostics(demo), [demo]);

  const [pivot, setPivot] = useState<PivotKey>('project');
  const [mode, setMode] = useState<UnitMode>('normalized');
  const [selection, setSelection] = useState<DrillSelection>(null);
  const [gridExpanded, setGridExpanded] = useState(false);

  const pivots = useMemo(
    () => pivotRows(demo, pivot, rows),
    [demo, pivot, rows]
  );
  const sessionPivots = useMemo(
    () => (pivot === 'session' ? pivots : pivotRows(demo, 'session', rows)),
    [demo, pivot, pivots, rows]
  );

  // The drill panel is never empty: the top pivot row is the default door.
  const drill: PivotRow | null = useMemo(() => {
    if (selection?.kind === 'session') {
      return (
        sessionPivots.find(r => r.id === selection.id) ?? pivots[0] ?? null
      );
    }
    if (selection?.kind === 'pivot') {
      return pivots.find(r => r.id === selection.id) ?? pivots[0] ?? null;
    }
    return pivots[0] ?? null;
  }, [selection, pivots, sessionPivots]);

  return (
    <main
      data-consumption-surface
      className="min-h-svh font-ui"
      style={{ background: CHROME.canvas, color: CHROME.text }}
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-6 pb-16 pt-8 sm:px-8">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1
            className="text-surface-title font-semibold tracking-tight"
            style={{ color: CHROME.text }}
          >
            {CONSUMPTION_SURFACE_NAME}
          </h1>
          {/* ENG-026 N0: the surface's one readiness marker, manifest-driven —
              E5's flip to `live` removes it with no change here. No owner
              tag: roadmap IDs are provenance and live in docs, not chrome. */}
          <SurfaceReadinessMarker surfaceId="consumption" />
          <span
            className="ml-auto text-chrome-meta"
            style={{ color: CHROME.textDim }}
          >
            read locally from Claude Code and Codex logs · no provider API ·
            nothing leaves this machine
          </span>
        </header>

        <DemoBanner demo={demo} raw={raw} voltaic={inDemoTenant} />

        <PlanWindows demo={demo} paces={paces} silent={silent} />

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Attribution
              rows={pivots}
              pivot={pivot}
              onPivot={k => {
                setPivot(k);
                setSelection(null);
              }}
              mode={mode}
              onMode={setMode}
              selectedId={
                selection?.kind === 'pivot'
                  ? selection.id
                  : selection === null
                    ? (pivots[0]?.id ?? null)
                    : null
              }
              onSelect={id =>
                setSelection(prev =>
                  prev?.kind === 'pivot' && prev.id === id
                    ? null
                    : { kind: 'pivot', id }
                )
              }
            />
            <SessionsGrid
              rows={rows}
              nowMs={demo.nowMs}
              selectedId={selection?.kind === 'session' ? selection.id : null}
              onSelect={id =>
                setSelection(prev =>
                  prev?.kind === 'session' && prev.id === id
                    ? null
                    : { kind: 'session', id }
                )
              }
              expanded={gridExpanded}
              onToggleExpanded={() => setGridExpanded(v => !v)}
            />
          </div>
          <div className="min-w-0 xl:sticky xl:top-4">
            <DrillPanel row={drill} />
          </div>
        </div>

        <Diagnostics diags={diags} />

        <footer
          className="border-t pt-3 text-chrome-meta"
          style={{ borderColor: CHROME.border, color: CHROME.textDim }}
        >
          {exact(demo.samples.length)} usage records ·{' '}
          {demo.workspace.sessionCount + demo.overhead.sessionCount} provider
          sessions · rolled up with{' '}
          <span className="font-mono">@exawatt/core</span>
        </footer>
      </div>
    </main>
  );
}
