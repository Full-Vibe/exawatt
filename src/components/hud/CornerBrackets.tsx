import type { CSSProperties } from 'react';
import { TONE_COLOR, type Corner, type HudTone } from './tokens';

interface CornerBracketsProps {
  corners?: ReadonlyArray<Corner>;
  tone?: HudTone;
  /** drives the draw-on animation (e.g. on select/focus) */
  active?: boolean;
  /** bracket leg length in px */
  legLength?: number;
  className?: string;
  /** DOM-safe generated color override; `tone` remains the legacy fallback. */
  color?: string;
}

const POS: Record<Corner, CSSProperties> = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  br: { bottom: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
};

function bracketPath(corner: Corner, L: number, size: number): string {
  const o = 2;
  switch (corner) {
    case 'tl':
      return `M ${o + L} ${o} L ${o} ${o} L ${o} ${o + L}`;
    case 'tr':
      return `M ${size - o - L} ${o} L ${size - o} ${o} L ${size - o} ${o + L}`;
    case 'br':
      return `M ${size - o} ${size - o - L} L ${size - o} ${size - o} L ${size - o - L} ${size - o}`;
    case 'bl':
      return `M ${o} ${size - o - L} L ${o} ${size - o} L ${o + L} ${size - o}`;
  }
}

function bracketGlow(color: string, intensity: number): string {
  const alpha = Math.round(Math.min(1, 0.45 * intensity) * 10_000) / 100;
  return `drop-shadow(0 0 ${1.5 * intensity}px ${color}) drop-shadow(0 0 ${9 * intensity}px color-mix(in srgb, ${color} ${alpha}%, transparent))`;
}

/**
 * L-shaped focus brackets at panel corners — fixed-size SVGs pinned to each
 * corner. When `active`, the legs draw on (hud-bracket-draw keyframe; gated by
 * prefers-reduced-motion in globals.css).
 */
export function CornerBrackets({
  corners = ['tl', 'tr', 'br', 'bl'],
  tone = 'cyan',
  active = false,
  legLength = 14,
  className,
  color: colorOverride,
}: CornerBracketsProps) {
  const color = colorOverride ?? TONE_COLOR[tone];
  const size = legLength + 4;
  const order: Corner[] = ['tl', 'tr', 'br', 'bl'];
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
    >
      {order
        .filter(c => corners.includes(c))
        .map(corner => (
          <svg
            key={corner}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="absolute"
            style={{
              ...POS[corner],
              filter: bracketGlow(color, active ? 1.1 : 0.7),
            }}
          >
            <path
              d={bracketPath(corner, legLength, size)}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              style={
                active
                  ? {
                      strokeDasharray: legLength * 2,
                      strokeDashoffset: legLength * 2,
                      animation: 'hud-bracket-draw 420ms ease forwards',
                    }
                  : undefined
              }
            />
          </svg>
        ))}
    </div>
  );
}
