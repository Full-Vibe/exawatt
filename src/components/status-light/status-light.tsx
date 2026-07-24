import { CircleCheck, CircleDashed, CircleDot, CircleX } from 'lucide-react';
import { STATUS_LIGHT_META, type StatusLightState } from './protocol';

const SIZE = {
  compact: 13,
  standard: 17,
  spacious: 21,
} as const;

export type StatusLightSize = keyof typeof SIZE;

function ActiveMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      className="motion-safe:animate-pulse"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <circle
        cx="8"
        cy="8"
        fill="none"
        r="6.4"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M8 8V1.6a6.4 6.4 0 0 1 0 12.8Z" fill="currentColor" />
    </svg>
  );
}

function StateMark({ state, size }: { state: StatusLightState; size: number }) {
  if (state === 'active') return <ActiveMark size={size} />;
  if (state === 'result') {
    return <CircleCheck aria-hidden="true" size={size} strokeWidth={1.7} />;
  }
  if (state === 'needs-you') {
    return <CircleDot aria-hidden="true" size={size} strokeWidth={1.8} />;
  }
  if (state === 'fault') {
    return <CircleX aria-hidden="true" size={size} strokeWidth={1.8} />;
  }
  return (
    <CircleDashed
      aria-hidden="true"
      className="opacity-60"
      size={size}
      strokeWidth={1.5}
    />
  );
}

/**
 * The review-stage status-light atom. Shape is always redundant with color;
 * only active work moves, and reduced-motion users receive the same half-fill
 * mark without the breath.
 */
export function StatusLight({
  state,
  size = 'standard',
  decorative = false,
  className = '',
}: {
  state: StatusLightState;
  size?: StatusLightSize;
  decorative?: boolean;
  className?: string;
}) {
  const meta = STATUS_LIGHT_META[state];
  const iconSize = SIZE[size];
  const boxSize = iconSize + (size === 'compact' ? 4 : 7);
  const glow =
    state === 'off'
      ? 'none'
      : state === 'active'
        ? `0 0 9px color-mix(in srgb, ${meta.color} 46%, transparent)`
        : `0 0 6px color-mix(in srgb, ${meta.color} 24%, transparent)`;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${meta.label}: ${meta.description}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-[5px] ${className}`}
      data-status-light={state}
      role={decorative ? undefined : 'img'}
      style={{
        width: boxSize,
        height: boxSize,
        color: meta.color,
        background:
          state === 'off'
            ? 'rgba(220, 229, 237, 0.035)'
            : `color-mix(in srgb, ${meta.color} 10%, transparent)`,
        boxShadow: glow,
      }}
    >
      <StateMark size={iconSize} state={state} />
    </span>
  );
}
