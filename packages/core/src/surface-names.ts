/**
 * Surface display names that more than one process renders.
 *
 * Renamed "Consumption" → "Usage" 2026-08-03 (operator decision, confirmed
 * by the naming research: the surface follows the category's dominant label).
 * The route moved to `/usage` with NO redirect — the operator chose a hard
 * cut, so `/consumption` 404s and every reference must point at `/usage`.
 * Internal ids deliberately keep their historical spelling — the surface id
 * `consumption`, `src/components/consumption/`, the `go-consumption`
 * shortcut id — per the navigation manifest's ids-are-addresses rule. The
 * wattage brand lives inside the page (FLUX channel, headroom vocabulary),
 * never in the nav label.
 *
 * Consumers: the page h1, the `/usage` segment metadata (browser tab and
 * Electron window title), the navigation manifest entry, the ⌘K shortcut
 * labels, the architecture manifest's surface node, and the Electron Go-menu
 * row. That last one used to be a documented mirror, because the main process
 * compiles with `rootDir: electron/` and cannot reach renderer `src/`; the
 * shared package is reachable from both, so the mirror is gone.
 */
export const CONSUMPTION_SURFACE_NAME = 'Usage';
