'use client';

/**
 * The floor's last row — ratio diagnostics ("what should I change?") as one
 * quiet strip of tiles. Readings live in tooltips, not prose. The ENG-014
 * allocation affordance survives beside it at chip scale, honestly unbuilt.
 */
import { FLUX_CSS as FLUX } from '@/components/consumption/flux';
import { AnnouncedChip } from '@/components/readiness';
import type { Diagnostic } from './derive';
import { Card, Data, MicroLabel } from './chrome';

export function Diagnostics({ diags }: { diags: Diagnostic[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {diags.map(d => (
          <Card key={d.key} label={d.label} className="flex flex-col gap-1.5 p-3">
            <MicroLabel>{d.label}</MicroLabel>
            <Data
              bright={d.state !== 'not-recorded'}
              color={d.state === 'not-recorded' ? FLUX.unknown : undefined}
            >
              <span title={d.hint}>{d.value}</span>
            </Data>
            {d.share !== undefined ? (
              <span
                aria-hidden
                className="inline-block h-1 w-full rounded-[1px]"
                style={{ background: FLUX.track }}
              >
                <span
                  className="block h-full rounded-[1px]"
                  style={{
                    width: `${Math.min(100, d.share * 100)}%`,
                    background: d.state === 'watch' ? FLUX.warm : FLUX.calm,
                  }}
                />
              </span>
            ) : (
              <span aria-hidden className="inline-block h-1 w-full" />
            )}
          </Card>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <AnnouncedChip coming="allocate wattage to goals, with ceilings the fleet respects">
          Allocation
        </AnnouncedChip>
      </div>
    </div>
  );
}
