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
 * The footer's Repository and Licensing links and the homepage's "View on
 * GitHub" are meaningless without somewhere to read the code and its
 * licenses, the repository goes public at the same launch moment this page is
 * built for, and the URL is already canonical in `package.json` and in
 * `contracts/`.
 *
 * THE INTERIM 404 IS AN ACCEPTED OPERATOR DECISION, 2026-08-19, not an open
 * risk: "Keep github pointing to the right spot. That'll launch imminently and
 * I get zero traffic today." So the link keeps its real destination and gets
 * no badge, no tooltip, no disabled state and no fallback, and this is not
 * raised again.
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
 * `Changelog` is the site's own `/changelog` (ENG-031 W25, BUG-130). It was an
 * in-page anchor until W10 removed the dated list, then GitHub's Releases
 * page, which opened empty before the first public Release and then showed
 * one-line notes. The entries are written once per release in
 * `docs/product/changelog/` and the Release body is rendered from the same
 * file.
 */
export const SITE_NAV_LINKS: SiteNavLink[] = [
  { label: 'Changelog', href: '/changelog' },
  // LEADERBOARD IS BACK IN THE NAV (operator, 2026-08-19: "Also keep
  // leaderboard"). It is a live public surface, it is in `proxy.ts`'s
  // signed-out allowlist, and it was in the shipped homepage's nav, so losing
  // it to the promotion would be a surface going quietly dark rather than a
  // decision anyone made. It sits between the two external links because the
  // one Exawatt page in this row should not be the last thing before the
  // button. Architecture stays OUT and stays in the footer, per W6.
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'GitHub', href: GITHUB_URL, external: true },
];

/**
 * What the phone's menu lists (ENG-031 W12).
 *
 * The menu has always been the nav links plus the footer's `Product` column,
 * because a phone visitor must be able to reach everything the wide layout
 * shows. Now that `Leaderboard` is in BOTH, the merge has to de-duplicate or
 * the menu prints it twice. Derived here rather than in the header, so the
 * rule lives beside the two lists it reconciles.
 */
export function siteMenuLinks(): SiteNavLink[] {
  const product =
    SITE_FOOTER_COLUMNS.find(column => column.heading === 'Product')?.links ??
    [];
  const seen = new Set(SITE_NAV_LINKS.map(link => link.href));
  return [...SITE_NAV_LINKS, ...product.filter(link => !seen.has(link.href))];
}

export interface SiteFooterColumn {
  heading: string;
  links: SiteNavLink[];
}

/**
 * The footer, including the open-source column W6 owns.
 *
 * Open source belongs in a footer column rather than the headline (the
 * research: four competitors already claim it above the fold, so it
 * differentiates nothing there). The column is two links, the repository and
 * `LICENSING.md`, the canonical licence boundary. The sentence that spelled
 * the AGPL-3.0 and Apache-2.0 split out under them is gone (operator
 * 2026-10-14: "useless copy... doesn't need to be on the home page"):
 * `Licensing` takes a reader who wants the split to the whole of it.
 */
export const SITE_FOOTER_COLUMNS: SiteFooterColumn[] = [
  {
    // NO DOWNLOAD ROW (ENG-031 W6b). `Download for Mac` rendered four times on
    // one page: the sticky nav, the fold, the close, and here. Persistent
    // conversion lives in the header by measured rule, and the two ends of the
    // page are the two moments the constraint allows, so the footer copy of it
    // was the one that was only there because a footer usually has one.
    heading: 'Product',
    links: [
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
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
];
