import type { CSSProperties, ReactNode } from 'react';
import {
  chamferPolygon,
  glow,
  HUD,
  TONE_COLOR,
  FRAME,
  withAlpha,
  type Corner,
  type HudTone,
} from './tokens';

interface HudFrameProps {
  /** which corners are chamfered (45deg cut). Default top-right + bottom-left. */
  chamfer?: ReadonlyArray<Corner>;
  tone?: HudTone;
  /** neon edge glow */
  glow?: boolean;
  /** glow/edge intensity multiplier (e.g. selected/hero) */
  intensity?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Chamfered translucent panel with a luminous border — the chrome substrate.
 * Technique: the FILL is a clip-path'd div (clip-path doesn't carry borders), so
 * the glowing edge is a separate clip-path'd layer underneath whose alpha shape
 * the drop-shadow glow follows. Everything else nests inside.
 */
export function HudFrame({
  chamfer = ['tr', 'bl'],
  tone = 'cyan',
  glow: doGlow = true,
  intensity = 1,
  className,
  style,
  children,
}: HudFrameProps) {
  const color = TONE_COLOR[tone];
  const clip = chamferPolygon(chamfer);
  const innerClip = chamferPolygon(chamfer, FRAME.chamfer - FRAME.border);
  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      {/* glowing edge layer */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          clipPath: clip,
          background: color,
          opacity: 0.9 * intensity,
          filter: doGlow ? glow(color, intensity) : undefined,
        }}
      />
      {/* fill layer, inset to reveal the edge as a ring */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: FRAME.border,
          clipPath: innerClip,
          background: `linear-gradient(160deg, ${withAlpha(color, 0.06)}, ${HUD.bg.panelFill} 38%)`,
          backdropFilter: 'blur(6px)',
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
