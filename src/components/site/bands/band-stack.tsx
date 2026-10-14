import { BAND_COMPONENTS } from './registry';
import {
  arrangementBands,
  bandRuns,
  type HomepageArrangement,
} from './manifest';
import { PinnedBoardSequence } from './pinned-board-sequence';

/**
 * The homepage, composed (ENG-031 W1, amended W4 and W8).
 *
 * The page is this list and nothing else. Every structural decision lives in
 * `manifest.ts`; every rendering decision lives in one band component. A
 * reserved band declares its slot and contributes no DOM.
 *
 * W4 added the ONE exception, and it is structural rather than a special case:
 * a consecutive run of `pinned-board` bands is not several bands that each
 * mount a board, it is ONE board and several panels. `bandRuns()` collects the
 * run and this renders `PinnedBoardSequence` over it. After W8 that run is
 * eight panels long and starts at section two, so most of the page is one
 * graphic being re-read through a different lens.
 *
 * TWO ARRANGEMENTS, ONE COMPONENT (W8). `/old` renders `proposed`, the arc
 * `/` carried until the fleet story took the homepage (W15m); `shipped` is
 * the fold alone. Both walk the same manifest.
 *
 * W6b: the fold JOINS that run whenever a run follows it, which is what makes
 * the page's own "one continuous board" claim literally true. The shipped
 * fold stays its own band, because nothing follows it there.
 */
export function HomeBands({
  arrangement,
}: {
  arrangement: HomepageArrangement;
}) {
  return (
    <main
      data-home-bands
      data-home-arrangement={arrangement}
      data-public-exhibition-surface="true"
    >
      {bandRuns(arrangementBands(arrangement)).map(run => {
        if (run.kind === 'pinned-board') {
          return (
            <PinnedBoardSequence
              bands={run.bands}
              key={`pinned:${run.bands[0]?.id}`}
            />
          );
        }
        const Band = BAND_COMPONENTS[run.band.id];
        return Band ? <Band band={run.band} key={run.band.id} /> : null;
      })}
    </main>
  );
}
