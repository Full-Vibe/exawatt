'use client';

/**
 * Ambient consumption meter — the title-bar mount (ENG-008 meter options).
 *
 * The iStat three-rung ladder in one control:
 *   1. the glyph, always on, ≤20px tall, monochrome until a window runs hot;
 *   2. hover (or keyboard focus) raises the windows/reset/pace popover;
 *   3. click goes to /usage — the meter IS that surface's first-class
 *      entry in the chrome, per the ⌘K-is-backstop rule.
 *
 * `CHROME_METER_FORM` picks which of the four candidate forms renders; the
 * placement is deliberately form-agnostic so the operator's pick is a
 * one-word change. `AMBIENT_CHROME_METER_ENABLED` is the whole flag.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { duration, percent } from '../flux';
import { windowOwnerLabel } from '../model';
import { useTenantConsumption } from '../use-tenant-consumption';
import {
  paceSentence,
  readMeter,
  type MeterSnapshot,
} from './meter-model';
import { METER_FORM, type MeterFormId } from './meter-forms';
import { METER_POPOVER_WIDTH, MeterPopover } from './meter-popover';

/** The one boolean between the meter and the title bar. */
export const AMBIENT_CHROME_METER_ENABLED = true;

/** The operator's pick renders here. Candidates: 'arc' | 'bar' | 'ring' | 'swap'. */
export const CHROME_METER_FORM: MeterFormId = 'bar';

export function meterAriaLabel(snapshot: MeterSnapshot): string {
  const r = snapshot.reading;
  // A 71px glyph cannot show the fleet's unknowns, but its label can — and
  // must, or the one number it shows reads as the whole picture (ENG-038).
  const partial = snapshot.unknownSources
    ? ' Some sources cannot be read, so this is a partial reading.'
    : '';
  if (!r) {
    return `Usage: no source reports plan limits.${partial} Opens the usage surface.`;
  }
  const owner = windowOwnerLabel(r.source, r.window);
  const head =
    r.state === 'exhausted'
      ? `${owner} ${r.window.label.toLowerCase()} spent, resets in ${duration(r.msToReset)}`
      : `${owner} ${r.window.label.toLowerCase()} at ${percent(r.usedPercent)}, ${paceSentence(r)}, resets in ${duration(r.msToReset)}`;
  return `Usage: ${head}.${partial} Opens the usage surface.`;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 160;

/**
 * The reusable control: any form, any snapshot, hover popover, click-through.
 * The gallery's chrome mocks mount this exact component so the wired
 * placement cannot drift from what was reviewed.
 *
 * The popover renders through a portal on `document.body`: the site header
 * carries a backdrop-filter material, and an overflowing absolutely-positioned
 * descendant of a backdrop root composites wrong (verified against the
 * translucent-panel bug — forcing opacity does not fix it; leaving the
 * backdrop root does). Navigating away (click-through) closes it.
 */
export function AmbientMeterControl({
  snapshot,
  form,
  align = 'right',
  href = '/usage',
}: {
  snapshot: MeterSnapshot;
  form: MeterFormId;
  align?: 'left' | 'right';
  href?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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

  // Anchor the portal to the control's viewport rect while open.
  useEffect(() => {
    if (!open) return;
    const el = anchor.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      // The popover has a fixed width (`w-[296px]`), so right-alignment is
      // arithmetic — a transform here would fight the enter animation's.
      setPos({
        top: r.bottom + 6,
        left: align === 'right' ? r.right - METER_POPOVER_WIDTH : r.left,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, align]);

  return (
    <span
      ref={anchor}
      className="relative inline-flex"
      data-consumption-chrome-meter={form}
      onMouseEnter={() => schedule(true, HOVER_OPEN_MS)}
      onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
    >
      <Link
        href={href}
        aria-label={meterAriaLabel(snapshot)}
        onClick={() => schedule(false, 0)}
        onFocus={() => schedule(true, 0)}
        onBlur={() => schedule(false, 0)}
        onKeyDown={e => {
          if (e.key === 'Escape') schedule(false, 0);
        }}
        className="inline-flex h-7 items-center rounded-[3px] px-2 outline-none transition-[background-color] duration-150 hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--exa-foundation-focus)] motion-reduce:transition-none"
      >
        <Form reading={snapshot.reading} />
      </Link>
      {open &&
        pos &&
        createPortal(
          <div
            data-meter-popover-root
            className="fixed z-50 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={() => schedule(true, 0)}
            onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
          >
            <MeterPopover snapshot={snapshot} />
          </div>,
          document.body
        )}
    </span>
  );
}

/**
 * The wired title-bar instance: the active tenant's corpus at that corpus's
 * pinned instant, through the one tenant-aware seam `/usage` reads — the
 * glyph and the page are structurally the same numbers.
 */
export function AmbientChromeMeter() {
  const { view } = useTenantConsumption();
  const snapshot = readMeter(view.sources, view.nowMs);
  return <AmbientMeterControl snapshot={snapshot} form={CHROME_METER_FORM} />;
}
