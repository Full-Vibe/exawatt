'use client';

/**
 * The Usage surface (ENG-008) — the production composite. Route `/usage`.
 * The canonical concept behind it is still Consumption (`concepts.md`); the
 * wattage brand lives inside the page — FLUX channel, headroom — never in
 * the nav label.
 *
 * One page structured as the operator's five questions, in order
 * (2026-08-03 show-and-tell review; transcript in
 * `docs/research/partner-conversations/`):
 *
 *   1. Headroom — how much is left? (the glance zone: one display numeral,
 *      the reset, the pace verdict as words; every other window subordinate)
 *   2. Burn  — how fast am I going?
 *   3. Pace  — am I on pace?
 *   4. Heat  — am I overheating?
 *   5. Spend — how much am I spending? (modelled, labelled modelled)
 *
 * Below the answers sits the drill-down floor — attribution pivot, session
 * grid, drill panel ("where is it going?") — and one quiet diagnostics row.
 * Text renders through the six-role treatment budget in `chrome.tsx`.
 * Grew out of the two operator-picked ENG-008 directions (Console top,
 * Ops-board floor); the explored directions (`/hud-gallery/consumption-redesign`)
 * retired 2026-08-03 once the composite shipped — the design record lives in
 * git history, the review screenshots, and the E8 milestone log.
 *
 * Per-tenant source (ENG-027 W2, live since E5): the Demo tenant reads the
 * Voltaic corpus; Personal reads THIS machine's live local corpus through
 * the E5 bridge, falling back to the bannered demo week only where no
 * bridge exists (the hosted web app). Every corpus flows through the same
 * view-model and rollups; they never merge. Nothing in this renderer reads
 * a file, spawns a process, or makes a network call — main owns the scan.
 */
import { useMemo, useState } from 'react';
import { displayUsage, rawTotal } from '@/components/consumption/model';
import { useTenantConsumption } from '@/components/consumption/use-tenant-consumption';
import { CONSUMPTION_SURFACE_NAME } from '@/components/consumption/surface-name';
import { CONSUMPTION_CHROME as CHROME } from '@/components/consumption/flux';
import { SurfaceReadinessMarker } from '@/components/readiness';
import {
  allPaces,
  diagnostics,
  gridRows,
  pivotRows,
  silentSources,
  spendView,
  type PivotKey,
  type PivotRow,
} from './derive';
import { Caption, DemoBanner, LiveScanNotice } from './chrome';
import { Verdict } from './verdict';
import { Burn, Heat, Pace, Spend } from './answers';
import { Attribution, type UnitMode } from './attribution';
import { SessionsGrid } from './sessions-grid';
import { DrillPanel } from './drill-panel';
import { Diagnostics } from './diagnostics';
import { duration, exact } from '@/components/consumption/flux';

type DrillSelection =
  | { kind: 'pivot'; id: string }
  | { kind: 'session'; id: string }
  | null;

export function UsageClient() {
  // ONE tenant-aware seam, shared with the ambient chrome meter — the title
  // bar and this page render the same corpus at the same pinned instant.
  const { view: demo, voltaic: inDemoTenant, live, scan } = useTenantConsumption();

  const raw = rawTotal(
    displayUsage(demo.workspace.totals, demo.workspace.sources)
  );
  const paces = useMemo(() => allPaces(demo), [demo]);
  const silent = useMemo(() => silentSources(demo), [demo]);
  const rows = useMemo(() => gridRows(demo), [demo]);
  const diags = useMemo(() => diagnostics(demo), [demo]);
  const spend = useMemo(() => spendView(demo, rows), [demo, rows]);

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
          {/* The provenance line must stay TRUE (ENG-038): with vendor plan
              windows on screen, "no provider API" would be a lie — the Claude
              rows came from the operator's own account read. Without them the
              spine's original claim holds verbatim. */}
          <Caption className="ml-auto">
            {demo.planWindows.some(w => w.origin === 'provider-account')
              ? 'read locally from Claude Code and Codex logs · plan windows from your Claude account'
              : 'read locally from Claude Code and Codex logs · no provider API · nothing leaves this machine'}
          </Caption>
        </header>

        {/* THE FLIP (E5): live data drops the demo banner; the live read's
            only chrome is the one-line scan caption while a first or
            partial read is in flight. */}
        {live ? (
          <LiveScanNotice scan={scan} />
        ) : (
          <DemoBanner demo={demo} raw={raw} voltaic={inDemoTenant} />
        )}

        {/* the five answers, in the order the questions are asked */}
        <Verdict paces={paces} silent={silent} />
        <Burn demo={demo} paces={paces} />
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <Pace paces={paces} />
          <Heat paces={paces} />
          <Spend spend={spend} windowLabel={demo.windowLabel} />
        </div>

        {/* the drill-down floor — where is it going? */}
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
          className="border-t pt-3"
          style={{ borderColor: CHROME.border }}
        >
          <Caption>
            {exact(demo.samples.length)} usage records ·{' '}
            {demo.workspace.sessionCount + demo.overhead.sessionCount} provider
            sessions · rolled up with{' '}
            <span className="font-mono">@exawatt/core</span>
            {/* data freshness — the live read states when it last ran */}
            {live && scan?.lastScanAtMs != null
              ? demo.nowMs - scan.lastScanAtMs < 60_000
                ? ' · read just now'
                : ` · read ${duration(demo.nowMs - scan.lastScanAtMs)} ago`
              : ''}
          </Caption>
        </footer>
      </div>
    </main>
  );
}
