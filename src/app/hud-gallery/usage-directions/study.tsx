'use client';

/**
 * The study shell: direction × state, deep-linked, plus the ambient row.
 *
 * The state switcher is deliberately above the fold and always visible: the
 * point of this rig is that a reviewer can flip one source to broken and
 * watch whether the headline gets more reassuring.
 */
import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CONSUMPTION_CHROME as CHROME,
  consumptionAlpha as withAlpha,
} from '@/components/consumption/flux';
import { Body, Caption, MicroLabel } from '@/app/usage/chrome';
import { AmbientRow } from './ambient';
import { RosterDirection } from './direction-roster';
import { LedgerDirection } from './direction-ledger';
import { InstrumentDirection } from './direction-instrument';
import { STATES, buildRoster, type StateId } from './model';
import { CAPTURE } from './snapshot';

const DIRECTIONS = [
  { id: 'roster', label: 'A · Roster', note: 'the source roster is the page' },
  {
    id: 'ledger',
    label: 'B · Ledger',
    note: 'one reconciling table, residuals drawn',
  },
  {
    id: 'instrument',
    label: 'C · Instrument',
    note: 'one verdict, one scale, the rest by drill',
  },
] as const;

type DirectionId = (typeof DIRECTIONS)[number]['id'];

export function UsageDirectionsStudy() {
  const router = useRouter();
  const params = useSearchParams();
  const direction = (params.get('d') as DirectionId) ?? 'roster';
  const stateId = (params.get('s') as StateId) ?? 'dual-signal';
  const active = DIRECTIONS.some(d => d.id === direction)
    ? direction
    : 'roster';
  const activeState = STATES.some(s => s.id === stateId)
    ? stateId
    : 'dual-signal';

  const view = useMemo(() => buildRoster(activeState), [activeState]);

  const set = useCallback(
    (next: { d?: DirectionId; s?: StateId }) => {
      const q = new URLSearchParams(params.toString());
      if (next.d) q.set('d', next.d);
      if (next.s) q.set('s', next.s);
      router.replace(`?${q.toString()}`, { scroll: false });
    },
    [params, router]
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {/* controls */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {DIRECTIONS.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => set({ d: d.id })}
              aria-pressed={d.id === active}
              className="flex flex-col items-start rounded border px-3 py-1.5 text-left"
              style={{
                borderColor:
                  d.id === active ? CHROME.borderStrong : CHROME.border,
                background:
                  d.id === active
                    ? withAlpha(CHROME.text, 0.08)
                    : 'transparent',
              }}
            >
              <Body color={d.id === active ? CHROME.text : CHROME.textDim}>
                {d.label}
              </Body>
              <Caption>{d.note}</Caption>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATES.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => set({ s: s.id })}
              aria-pressed={s.id === activeState}
              data-e12-state={s.id}
              className="rounded px-2 py-1 text-chrome-label"
              style={{
                color: s.id === activeState ? CHROME.text : CHROME.textDim,
                background:
                  s.id === activeState
                    ? withAlpha(CHROME.text, 0.1)
                    : 'transparent',
                boxShadow:
                  s.id === activeState
                    ? `inset 0 0 0 1px ${CHROME.border}`
                    : 'none',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Body color={CHROME.textDim}>{view.state.question}</Body>
          <Caption>
            {view.state.origin === 'authored' ? 'Authored — ' : 'Measured — '}
            {view.state.originNote}
          </Caption>
        </div>
      </div>

      {/* the direction */}
      <div data-e12-direction={active}>
        {active === 'roster' && <RosterDirection view={view} />}
        {active === 'ledger' && <LedgerDirection view={view} />}
        {active === 'instrument' && <InstrumentDirection view={view} />}
      </div>

      {/* the ambient projections — all three, same state, always visible */}
      <section
        className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
        style={{ borderColor: CHROME.border, background: CHROME.surface }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MicroLabel>Ambient projection</MicroLabel>
          <Caption>
            each is the same rows in the same order with columns dropped
          </Caption>
        </div>
        <AmbientRow view={view} />
      </section>

      <footer className="flex flex-wrap items-baseline gap-x-3">
        <Caption>
          Captured {new Date(CAPTURE.capturedAtMs).toLocaleString('en-US')} from
          this machine · {CAPTURE.corpus.samples.toLocaleString('en-US')} local
          records · {CAPTURE.corpus.providerSessions} provider sessions
        </Caption>
      </footer>
    </div>
  );
}
