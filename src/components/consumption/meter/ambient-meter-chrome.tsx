'use client';

/**
 * Ambient consumption meter, the title-bar mount (ENG-008 E6, E15).
 *
 * The iStat three-rung ladder in one control:
 *   1. the bar glyph, always on, ≤20px tall, showing the live window that
 *      bites first, monochrome until it runs hot;
 *   2. hover (or keyboard focus) raises the account cards at glance size;
 *   3. click goes to /usage, the same cards at reading size. The meter IS
 *      that surface's first-class entry in the chrome (⌘K is a backstop).
 */

import Link from 'next/link';
import { planResetPhrase } from '@exawatt/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usageOverview, type UsageOverview } from '../accounts';
import { useTenantConsumption } from '../use-tenant-consumption';
import { BarMeter } from './meter-forms';
import { METER_POPOVER_WIDTH, MeterPopover } from './meter-popover';

/** The one boolean between the meter and the title bar. */
export const AMBIENT_CHROME_METER_ENABLED = true;

/**
 * The glyph's accessible sentence. A 34px bar cannot show the other accounts,
 * but its label can, and must, or the one number it shows reads as the whole
 * picture (ENG-038).
 */
export function meterAriaLabel(overview: UsageOverview): string {
  const unknown = overview.accounts.some(a =>
    ['stale', 'unreadable', 'off'].includes(a.health)
  );
  const partial = unknown ? ' Some accounts cannot be read right now.' : '';
  const binding = overview.binding;
  if (!binding) {
    return `Usage: no account reports plan limits.${partial} Opens Usage.`;
  }
  const account = overview.accounts.find(a => a.key === binding.accountKey);
  const m = binding.meter;
  return `Usage: ${account?.name ?? ''} ${m.label.toLowerCase()} at ${Math.round(m.usedPercent)}%, resets ${planResetPhrase(m.resetsAtMs, overview.nowMs)}.${partial} Opens Usage.`;
}

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 160;

/**
 * The reusable control: the bar glyph, hover popover, click-through. The
 * scenario workbench mounts this exact component so the wired placement
 * cannot drift from what was reviewed.
 *
 * The popover renders through a portal on `document.body`: the site header
 * carries a backdrop-filter material, and an overflowing absolutely-positioned
 * descendant of a backdrop root composites wrong (verified against the
 * translucent-panel bug — forcing opacity does not fix it; leaving the
 * backdrop root does). Navigating away (click-through) closes it.
 */
export function AmbientMeterControl({
  overview,
  align = 'right',
  href = '/usage',
}: {
  overview: UsageOverview;
  align?: 'left' | 'right';
  href?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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
      data-consumption-chrome-meter="bar"
      onMouseEnter={() => schedule(true, HOVER_OPEN_MS)}
      onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
    >
      <Link
        href={href}
        aria-label={meterAriaLabel(overview)}
        onClick={() => schedule(false, 0)}
        onFocus={() => schedule(true, 0)}
        onBlur={() => schedule(false, 0)}
        onKeyDown={e => {
          if (e.key === 'Escape') schedule(false, 0);
        }}
        className="inline-flex h-7 items-center rounded-[3px] px-2 outline-none transition-[background-color] duration-150 hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--exa-foundation-focus)] motion-reduce:transition-none"
      >
        <BarMeter reading={overview.binding?.meter.reading ?? null} />
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
            <MeterPopover overview={overview} />
          </div>,
          document.body
        )}
    </span>
  );
}

/**
 * The wired title-bar instance: the active tenant's corpus at that corpus's
 * pinned instant, through the one tenant-aware seam `/usage` reads, projected
 * by the same `usageOverview`. The glyph and the page are the same numbers.
 */
export function AmbientChromeMeter() {
  const { view } = useTenantConsumption();
  const overview = useMemo(() => usageOverview(view), [view]);
  return <AmbientMeterControl overview={overview} />;
}
