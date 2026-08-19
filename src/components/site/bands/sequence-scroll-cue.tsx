import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BAND_AFFORDANCE_ATTR } from './download';
import { panelStepId } from './pinned-scroll';

/**
 * The fold's second control: the way down (ENG-031 W12).
 *
 * The operator: "Put a second CTA next to download like an arrow button to
 * indicate scrollability which scrolls down to the next frame."
 *
 * WHY IT IS AN ORDINARY LINK AND NOT A CLICK HANDLER. The sequence's whole
 * mechanism rule is that the browser owns the scroll: no wheel handler, no
 * `preventDefault`, no `scrollTo`, no scroll library. A button that called
 * `window.scrollTo` would be the first exception to that rule and would also
 * have to reproduce the snap geometry in JavaScript. An `<a href="#step-...">`
 * needs neither. It targets the panel's own snap sentinel, which is the exact
 * position a scroll settle parks at, so the affordance and the browser's own
 * rest position are the same number by construction rather than by tuning.
 * Smoothness and its reduced-motion opt-out are `scroll-behavior` in
 * `globals.css`, which is the platform's answer to both.
 *
 * WHY IT IS QUIET. The measured ceiling for a fold is two controls with ONE
 * primary, and `Download for Mac` is the primary. This is an outline: no fill,
 * no shadow, muted ink, and it takes the button's height so the pair reads as
 * one row rather than as two offers. It is a real anchor, so it is
 * keyboard-reachable and carries a real name; "See the fleet" says what is
 * down there, where "Scroll down" would only describe the gesture.
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
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md',
        'border border-white/25 text-white/70 transition-colors',
        'hover:border-white/50 hover:text-white',
        'focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
        className
      )}
      href={`#${panelStepId(targetBandId)}`}
      data-fold-scroll-cue={targetBandId}
      {...{ [BAND_AFFORDANCE_ATTR]: 'scroll-cue' }}
    >
      {/* The nudge IS the affordance rather than decoration on it: a static
          chevron says a direction, and a chevron that moves says there is
          something below to move to. Three pixels, two and a half seconds, and
          `motion-safe` so a reader who asked for stillness gets the same
          control without it. */}
      <ChevronDown
        aria-hidden
        className="h-5 w-5 motion-safe:animate-[fold-cue-nudge_2.4s_ease-in-out_infinite]"
        strokeWidth={2}
      />
    </a>
  );
}
