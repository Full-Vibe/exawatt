'use client';

/**
 * Usage, Analytics tab (ENG-008 E15). Route `/usage/analytics`.
 *
 * Where the tokens went, by Project or by Agent, with the drill panel that
 * holds the page's only (modelled) dollars. Everything else the old composite
 * page carried (heat, the burn chart, the sessions grid, diagnostics) retired
 * with E15: the operator asked for the breakdown and nothing more.
 */
import { useMemo, useState } from 'react';
import { useTenantConsumption } from '@/components/consumption/use-tenant-consumption';
import { gridRows, pivotAbsenceNote, pivotRows, type PivotKey } from '../derive';
import { Attribution, type UnitMode } from '../attribution';
import { DrillPanel } from '../drill-panel';
import { UsageShell } from '../usage-shell';

export function AnalyticsClient() {
  const tenant = useTenantConsumption();
  const { view } = tenant;
  const rows = useMemo(() => gridRows(view), [view]);
  const [pivot, setPivot] = useState<PivotKey>('project');
  const [mode, setMode] = useState<UnitMode>('normalized');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pivots = useMemo(() => pivotRows(view, pivot, rows), [view, pivot, rows]);
  // The drill panel is never empty: the top row is the default door.
  const drill = pivots.find(r => r.id === selectedId) ?? pivots[0] ?? null;

  return (
    <UsageShell tab="analytics" tenant={tenant} width="wide">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Attribution
          rows={pivots}
          note={pivotAbsenceNote(pivot, pivots)}
          pivot={pivot}
          onPivot={k => {
            setPivot(k);
            setSelectedId(null);
          }}
          mode={mode}
          onMode={setMode}
          selectedId={drill?.id ?? null}
          onSelect={id => setSelectedId(prev => (prev === id ? null : id))}
        />
        <div className="min-w-0 xl:sticky xl:top-4">
          <DrillPanel row={drill} />
        </div>
      </div>
    </UsageShell>
  );
}
