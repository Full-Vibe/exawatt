/**
 * The download affordance, stated once (ENG-031 W3).
 *
 * A real button everywhere it appears: Warp demoting its download to an
 * underlined text link is the recorded anti-pattern. The machine it needs
 * (Apple silicon: `electron-builder.yml` builds arm64 only) is stated on the
 * download page, not under the button (operator 2026-10-14).
 */

export const DOWNLOAD_HREF = '/download';

/** Names the OS at the button. Two CTAs maximum, and this is the primary. */
export const DOWNLOAD_LABEL = 'Download for Mac';
