import { BAND_COMPONENTS } from './registry';
import { shippedBands } from './manifest';

/**
 * The homepage, composed (ENG-031 W1).
 *
 * The page is this list and nothing else. Every structural decision lives in
 * `manifest.ts`; every rendering decision lives in one band component. A
 * reserved band declares its slot and contributes no DOM.
 */
export function HomeBands() {
  return (
    <main data-home-bands data-public-exhibition-surface="true">
      {shippedBands().map(band => {
        const Band = BAND_COMPONENTS[band.id];
        return Band ? <Band band={band} key={band.id} /> : null;
      })}
    </main>
  );
}
