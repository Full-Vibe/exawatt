import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BAND_AFFORDANCE_ATTR } from './download';
import { panelStepId } from './pinned-scroll';

/**
 * The fold's way down (ENG-031 W12, rebuilt W13).
 *
 * The operator asked for it: "put a second CTA next to download like an arrow
 * button to indicate scrollability which scrolls down to the next frame." W12
 * put an outline chevron at the download button's own height, in its row. He
 * rejected the result on sight: "the down arrow looks too much like a dropdown
 * button and combobox. Make it a clearly separate action so people know to
 * scroll."
 *
 * He is right, and the reason is a convention nobody can opt out of. A pill
 * with a label and a same-height outline square carrying a down-chevron
 * immediately beside it is the SPLIT BUTTON, on every platform: the square is
 * the menu half. Nothing about the control's own styling could have overridden
 * that reading, because the reading comes from the pairing.
 *
 * SO IT LEAVES THE ROW. It is a labelled cue centred at the bottom of the
 * fold's own frame, which is where a page has put "there is more below" since
 * long before this one. Three things now say scroll rather than menu: it is
 * nowhere near the download button, it is at the bottom edge of the first
 * screen, and it moves. The label says what is down there, not what the
 * gesture is.
 *
 * WHAT DID NOT CHANGE. It is still an ordinary `<a href>` at the next panel's
 * own snap sentinel, so the browser owns the scroll, the settle position and
 * the affordance are the same number by construction, and the
 * no-scroll-jacking rule is intact. It is still keyboard-reachable, still
 * carries a real accessible name, and is still marked as an affordance so it
 * never spends the band's reading words.
 */
export function SequenceScrollCue({
  targetBandId,
  className,
}: {
  /** The band whose settle point this lands on. */
  targetBandId: string;
  className?: string;
}) {
  return (
    <a
      aria-label="See the fleet"
      className={cn(
        'group pointer-events-auto inline-flex flex-col items-center gap-2',
        'text-[13px] font-medium tracking-wide text-white/65 transition-colors',
        'hover:text-white focus-visible:text-white',
        'focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
        className
      )}
      href={`#${panelStepId(targetBandId)}`}
      data-fold-scroll-cue={targetBandId}
      {...{ [BAND_AFFORDANCE_ATTR]: 'scroll-cue' }}
    >
      <span aria-hidden>See the fleet</span>
      {/* The nudge IS the affordance rather than decoration on it: a static
          chevron says a direction, a chevron that moves says there is
          something below to move to. `motion-safe` so a reader who asked for
          stillness gets the same control without it. */}
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full',
          'border border-white/30 transition-colors group-hover:border-white/60'
        )}
      >
        <ChevronDown
          className="h-5 w-5 motion-safe:animate-[fold-cue-nudge_2.4s_ease-in-out_infinite]"
          strokeWidth={2}
        />
      </span>
    </a>
  );
}
