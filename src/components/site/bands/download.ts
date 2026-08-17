/**
 * The download affordance, stated once (ENG-031 W3).
 *
 * MEASURED RULE: "the download states its requirement AT the button" (Dia:
 * "Currently available on Apple macOS 14+ with M1 chips or later"). Warp
 * demoting its download to an underlined text link is the recorded
 * anti-pattern, so this is a real button everywhere it appears.
 *
 * The requirement is PINNED FROM THE CODE, not from memory, because
 * `marketing.md` requires every shipped claim to be verified against the
 * repository on the day it ships:
 *
 * - `electron-builder.yml` builds `dmg` and `zip` for `arch: [arm64]` only,
 *   and the update feed is `.../desktop-updates/macos/arm64`. There is no
 *   Intel artifact to hand anyone, so "Apple silicon" is a fact, not a
 *   preference.
 * - Electron 43.1.0 ships `LSMinimumSystemVersion 12.0`
 *   (`node_modules/electron/dist/Electron.app/Contents/Info.plist`), so the
 *   real floor is macOS 12 Monterey.
 *
 * Re-verify both when the Electron major or the build matrix moves.
 *
 * NOT STATED YET: the brief's fold row wants "a mono line carrying brew and
 * the macOS requirement". There is no Homebrew tap or cask in this repository,
 * so the brew half is deliberately unwritten rather than promised. Add it here
 * when a formula exists; the line has room.
 */

export const DOWNLOAD_HREF = '/download';

/** Names the OS at the button. Two CTAs maximum, and this is the primary. */
export const DOWNLOAD_LABEL = 'Download for Mac';

/** Sits directly under the button, in mono, at every size. */
export const DOWNLOAD_REQUIREMENT = 'macOS 12 or later. Apple silicon.';

/**
 * Marks a subtree as a conversion affordance rather than reading copy.
 *
 * The measured word ceilings (under 26 above the fold, 10 or fewer at the
 * close) are ceilings on READING COPY. The reference cohort was counted that
 * way: Linear measures 19 with two buttons on screen, and the closing
 * constraint is stated as "10 words or fewer, AND repeats the fold's buttons",
 * so the buttons are additive by the constraint's own wording. Marking the
 * affordance keeps that exclusion explicit and testable instead of implicit.
 */
export const BAND_AFFORDANCE_ATTR = 'data-band-affordance';
