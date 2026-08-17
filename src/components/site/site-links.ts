/**
 * The public site's own links, in one typed list (ENG-031 W6).
 *
 * W6's rule for the nav is short: Docs, Changelog, GitHub, and
 * `Download for Mac` as the only button, with Architecture dropped out of the
 * nav and into the footer. No site in the 16-site reference corpus carries a
 * project artifact like `/architecture` in its primary navigation.
 *
 * TWO DESTINATIONS ARE DELIBERATELY ABSENT AND SAY SO.
 *
 * - **Docs.** There is no public documentation surface in this repository. The
 *   guides and the reference live under `docs/product/` and are not routed. A
 *   nav item that 404s in front of a stranger is not aspiration, it is a
 *   broken page, and the copy rule that permits the future tense is explicitly
 *   about SENTENCES, not about links. It lands the day the surface does.
 * - **Brew.** Same rule, already recorded in `download.ts`: no tap, no cask,
 *   no line.
 *
 * **GitHub is present and its repository is private until ENG-030 flips it.**
 * That is a knowing bet rather than an oversight: the two-license split in the
 * footer is meaningless without somewhere to read the licenses, the repository
 * goes public at the same launch moment this page is built for, and the URL is
 * already canonical in `package.json` and in `contracts/`. If the launch order
 * changes, this is the one link on the page that has to move with it.
 */

/** The repository, from `package.json`'s own `repository.url`. */
export const GITHUB_URL = 'https://github.com/Full-Vibe/exawatt';

export interface SiteNavLink {
  label: string;
  href: string;
  /** External links open in a new tab and carry the usual rel. */
  external?: boolean;
}

/**
 * The nav, beside the one download button.
 *
 * `Changelog` is an in-page anchor rather than a route, because the dated list
 * IS on this page: `proof` renders eleven landed milestones on the day each
 * one landed. Pointing a nav item at a real dated list beats pointing it at a
 * page that has to be written first.
 */
export const SITE_NAV_LINKS: SiteNavLink[] = [
  { label: 'Changelog', href: '#proof' },
  { label: 'GitHub', href: GITHUB_URL, external: true },
];

export interface SiteFooterColumn {
  heading: string;
  links: SiteNavLink[];
  /** One plain sentence under the column, or none. */
  note?: string;
}

/**
 * The footer, including the open-source column W6 owns.
 *
 * The two-license split is stated ONCE, in a person's voice, and it is stated
 * here rather than in the headline because the research is explicit that open
 * source belongs in a band and a footer column: four competitors already claim
 * it above the fold, so it differentiates nothing there.
 *
 * The wording is read off `LICENSING.md`, which is the canonical boundary:
 * everything except the listed compatibility paths is AGPL-3.0-or-later, and
 * `contracts/**`, `schemas/**` and the roadmap convention are Apache-2.0.
 */
export const SITE_FOOTER_COLUMNS: SiteFooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Download for Mac', href: '/download' },
      { label: 'Leaderboard', href: '/leaderboard' },
      { label: 'Architecture', href: '/architecture' },
    ],
  },
  {
    heading: 'Open source',
    links: [
      { label: 'Repository', href: GITHUB_URL, external: true },
      {
        label: 'Licensing',
        href: `${GITHUB_URL}/blob/master/LICENSING.md`,
        external: true,
      },
    ],
    note: 'The app is AGPL-3.0. The compatibility spec that lets any harness become Exawatt ready is Apache-2.0, so anyone can build against it, including people who compete with us.',
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
];
