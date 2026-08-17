import { BAND_COMPONENTS } from './registry';
import { bandRuns, shippedBands } from './manifest';
import { PinnedBoardSequence } from './pinned-board-sequence';

/**
 * The homepage, composed (ENG-031 W1, amended W4).
 *
 * The page is this list and nothing else. Every structural decision lives in
 * `manifest.ts`; every rendering decision lives in one band component. A
 * reserved band declares its slot and contributes no DOM.
 *
 * W4 added the ONE exception, and it is structural rather than a special case:
 * a consecutive run of `pinned-board` bands is not several bands that each
 * mount a board, it is ONE board and several panels. `bandRuns()` collects the
 * run and this renders `PinnedBoardSequence` over it. Nothing renders today,
 * because all three altitude bands are still reserved pending the operator's
 * review at `/hud-gallery/altitude-scroll`; the composition exists so that
 * shipping them stays a status edit rather than a page rewrite.
 */
export function HomeBands() {
  return (
    <main data-home-bands data-public-exhibition-surface="true">
      {bandRuns(shippedBands()).map(run => {
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
