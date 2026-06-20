import { glow, HUD, TONE_COLOR, withAlpha, type HudTone } from './tokens';

interface RingGaugeProps {
  /** 0..1 */
  value: number;
  label?: string;
  /** big center readout (defaults to percent) */
  readout?: string;
  tone?: HudTone;
  size?: number;
  /** arc sweep in degrees (e.g. 270 leaves a gap at the bottom) */
  sweepDeg?: number;
  ticks?: number;
  /** ambient rotating sweep highlight (gated by reduced motion) */
  ambient?: boolean;
}

/** Radial arc gauge — SVG circle stroke-dasharray + tick scale. */
export function RingGauge({
  value,
  label,
  readout,
  tone = 'cyan',
  size = 120,
  sweepDeg = 270,
  ticks = 24,
  ambient = false,
}: RingGaugeProps) {
  const color = TONE_COLOR[tone];
  const frac = Math.max(0, Math.min(1, value));
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const sweepFrac = sweepDeg / 360;
  const arcLen = circ * sweepFrac;
  const rot = 90 + (360 - sweepDeg) / 2; // center the gap at the bottom
  const pct = readout ?? `${Math.round(frac * 100)}%`;
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ filter: glow(color, 0.7) }}>
        <g transform={`rotate(${rot} ${cx} ${cy})`}>
          {/* track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={withAlpha(color, 0.14)}
            strokeWidth={3}
            strokeDasharray={`${arcLen} ${circ}`}
            strokeLinecap="round"
          />
          {/* value arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={3.5}
            strokeDasharray={`${arcLen * frac} ${circ}`}
            strokeLinecap="round"
          />
          {/* ambient sweep */}
          {ambient && (
            <circle
              className="hud-ring-sweep"
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={withAlpha(color, 0.9)}
              strokeWidth={3.5}
              strokeDasharray={`${arcLen * 0.06} ${circ}`}
              strokeLinecap="round"
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
          )}
        </g>
        {/* ticks */}
        {Array.from({ length: ticks }).map((_, i) => {
          const a = ((rot + (sweepDeg * i) / (ticks - 1)) * Math.PI) / 180;
          const r1 = r + 5;
          const r2 = r + 9;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(a)}
              y1={cy + r1 * Math.sin(a)}
              x2={cx + r2 * Math.cos(a)}
              y2={cy + r2 * Math.sin(a)}
              stroke={withAlpha(color, 0.35)}
              strokeWidth={1}
            />
          );
        })}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          className="font-mono text-lg font-semibold tabular-nums leading-none"
          style={{ color: HUD.text }}
        >
          {pct}
        </span>
        {label && (
          <span className="mt-1 font-ui text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: HUD.textDim }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
