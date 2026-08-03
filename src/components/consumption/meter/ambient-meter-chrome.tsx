'use client';

/**
 * Ambient consumption meter — the title-bar mount (ENG-008 meter options).
 *
 * The iStat three-rung ladder in one control:
 *   1. the glyph, always on, ≤20px tall, monochrome until a window runs hot;
 *   2. hover (or keyboard focus) raises the windows/reset/pace popover;
 *   3. click goes to /consumption — the meter IS that surface's first-class
 *      entry in the chrome, per the ⌘K-is-backstop rule.
 *
 * `CHROME_METER_FORM` picks which of the four candidate forms renders; the
 * placement is deliberately form-agnostic so the operator's pick is a
 * one-word change. `AMBIENT_CHROME_METER_ENABLED` is the whole flag.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { duration, percent } from '../flux';
import { DEMO_NOW_MS, demoConsumption } from '../demo-source';
import {
  paceSentence,
  readMeter,
  type MeterSnapshot,
} from './meter-model';
import { METER_FORM, type MeterFormId } from './meter-forms';
import { MeterPopover } from './meter-popover';

/** The one boolean between the meter and the title bar. */
export const AMBIENT_CHROME_METER_ENABLED = true;

/** The operator's pick renders here. Candidates: 'arc' | 'bar' | 'ring' | 'swap'. */
export const CHROME_METER_FORM: MeterFormId = 'bar';

export function meterAriaLabel(snapshot: MeterSnapshot): string {
  const r = snapshot.reading;
  if (!r) {
    return 'Consumption: no source reports plan limits. Opens the consumption surface.';
  }
  const head =
    r.state === 'exhausted'
      ? `${r.source.label} ${r.window.label.toLowerCase()} spent, resets in ${duration(r.msToReset)}`
      : `${r.source.label} ${r.window.label.toLowerCase()} at ${percent(r.usedPercent)}, ${paceSentence(r)}, resets in ${duration(r.msToReset)}`;
  return `Consumption: ${head}. Opens the consumption surface.`;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 160;

/**
 * The reusable control: any form, any snapshot, hover popover, click-through.
 * The gallery's chrome mocks mount this exact component so the wired
 * placement cannot drift from what was reviewed.
 */
export function AmbientMeterControl({
  snapshot,
  form,
  align = 'right',
  href = '/consumption',
}: {
  snapshot: MeterSnapshot;
  form: MeterFormId;
  align?: 'left' | 'right';
  href?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Form = METER_FORM[form];

  const schedule = useCallback((next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <span
      className="relative inline-flex"
      data-consumption-chrome-meter={form}
      onMouseEnter={() => schedule(true, HOVER_OPEN_MS)}
      onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
    >
      <Link
        href={href}
        aria-label={meterAriaLabel(snapshot)}
        onFocus={() => schedule(true, 0)}
        onBlur={() => schedule(false, 0)}
        onKeyDown={e => {
          if (e.key === 'Escape') schedule(false, 0);
        }}
        className="inline-flex h-7 items-center rounded-[3px] px-2 outline-none transition-[background-color] duration-150 hover:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-300 motion-reduce:transition-none"
      >
        <Form reading={snapshot.reading} />
      </Link>
      {open && <MeterPopover snapshot={snapshot} align={align} />}
    </span>
  );
}

/**
 * The wired title-bar instance: the real demo corpus's plan windows at the
 * corpus's pinned instant — the same data and clock `/consumption` renders,
 * so the glyph and the page can never disagree.
 */
export function AmbientChromeMeter() {
  const snapshot = readMeter(demoConsumption().sources, DEMO_NOW_MS);
  return <AmbientMeterControl snapshot={snapshot} form={CHROME_METER_FORM} />;
}
