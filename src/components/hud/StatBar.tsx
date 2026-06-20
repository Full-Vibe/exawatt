import { glow, HUD, TONE_COLOR, withAlpha, type HudTone } from './tokens';
import { Label } from './Label';

interface StatBarProps {
  label?: string;
  /** 0..1 if no max; otherwise raw value out of max */
  value: number;
  max?: number;
  segments?: number;
  tone?: HudTone;
  /** formatted value shown on the right (defaults to percent) */
  readout?: string;
  showChevron?: boolean;
  className?: string;
}

/** Segmented horizontal stat bar — discrete cells + label + value + chevron cap. */
export function StatBar({
  label,
  value,
  max,
  segments = 12,
  tone = 'cyan',
  readout,
  showChevron = true,
  className,
}: StatBarProps) {
  const frac = Math.max(0, Math.min(1, max ? value / max : value));
  const filled = Math.round(frac * segments);
  const color = TONE_COLOR[tone];
  const pct = readout ?? `${Math.round(frac * 100)}%`;
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      {(label || pct) && (
        <div className="flex items-baseline justify-between">
          {label ? <Label>{label}</Label> : <span />}
          <span
            className="font-mono text-[11px] font-medium tabular-nums"
            style={{ color: HUD.textMono }}
          >
            {pct}
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <div className="flex h-2 flex-1 gap-[2px]">
          {Array.from({ length: segments }).map((_, i) => {
            const on = i < filled;
            return (
              <span
                key={i}
                className="h-full flex-1"
                style={{
                  background: on ? color : withAlpha(color, 0.12),
                  boxShadow: on ? `0 0 6px ${withAlpha(color, 0.7)}` : undefined,
                }}
              />
            );
          })}
        </div>
        {showChevron && (
          <span
            aria-hidden
            className="text-[10px] leading-none"
            style={{ color, filter: glow(color, 0.6) }}
          >
            ▸
          </span>
        )}
      </div>
    </div>
  );
}
