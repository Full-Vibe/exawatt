import type { ReactNode } from 'react';
import { HUD, TONE_COLOR, type HudTone } from './tokens';

/** ALL-CAPS, tracked, condensed UI label (the FUI labeling atom). */
export function Label({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: HudTone;
  className?: string;
}) {
  return (
    <span
      className={`font-ui text-[11px] font-semibold uppercase tracking-[0.16em] ${className ?? ''}`}
      style={{ color: tone ? TONE_COLOR[tone] : HUD.textDim }}
    >
      {children}
    </span>
  );
}

/** A labeled telemetry readout: ALL-CAPS label + mono tabular value (+ unit). */
export function Readout({
  label,
  value,
  unit,
  tone,
  align = 'left',
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: HudTone;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const items =
    align === 'right'
      ? 'items-end'
      : align === 'center'
        ? 'items-center'
        : 'items-start';
  return (
    <div className={`flex flex-col gap-0.5 ${items} ${className ?? ''}`}>
      <Label>{label}</Label>
      <span
        className="font-mono text-base font-medium tabular-nums leading-none"
        style={{ color: tone ? TONE_COLOR[tone] : HUD.textMono }}
      >
        {value}
        {unit ? <span className="ml-0.5 text-[0.7em] opacity-70">{unit}</span> : null}
      </span>
    </div>
  );
}
