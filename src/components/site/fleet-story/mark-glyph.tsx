/**
 * A harness mark as a flat glyph (ENG-031 W15g), for the study's panels. The
 * same registry and the same tones as the 3D mark on the tile
 * (`visuals/crust-marks.ts`), so the panel names an agent's harness in
 * exactly the figure its tile wears: the icon, never the name (operator
 * 2026-10-12). Parts are drawn in the vendor's own order.
 */

import { STORY_MARK_PATHS } from './concept-marks';
import { sourceAdapterId } from './fleet-model';
import { markIdFor, markToneHex } from './mark-tones';

export function MarkGlyph({
  source,
  size = 14,
  className,
}: {
  /** The harness as the fleet names it ("Claude Code"). */
  source: string;
  size?: number;
  className?: string;
}) {
  const id = markIdFor(sourceAdapterId(source));
  if (!id) return null;
  const mark = STORY_MARK_PATHS[id];
  return (
    <svg
      data-slot="harness-glyph"
      viewBox={`0 0 ${mark.viewBox} ${mark.viewBox}`}
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      <g
        transform={
          mark.translate
            ? `translate(${mark.translate[0]} ${mark.translate[1]})`
            : undefined
        }
      >
        {mark.parts.map((part, index) => {
          const paint = markToneHex(id, part.tone) ?? 'currentColor';
          return part.stroke ? (
            <path
              key={index}
              d={part.d}
              fill="none"
              stroke={paint}
              strokeWidth={part.stroke}
              strokeLinecap="round"
            />
          ) : (
            <path
              key={index}
              d={part.d}
              fill={paint}
              fillRule={mark.fillRule}
            />
          );
        })}
      </g>
    </svg>
  );
}
