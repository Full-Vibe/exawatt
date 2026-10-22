import type { Metadata } from 'next';
import { ChangelogEntryView } from '@/components/site/changelog/changelog-entry';
import { SiteDocPage } from '@/components/site/docs/site-doc-page';
import { publishedChangelogEntries } from '@/lib/changelog/published';

export const dynamic = 'force-static';
// Must equal CHANGELOG_REVALIDATE_SECONDS; Next reads this export statically.
export const revalidate = 300;

const DESCRIPTION = 'New in Exawatt, release by release.';

export const metadata: Metadata = {
  title: 'Changelog',
  description: DESCRIPTION,
  alternates: {
    canonical: '/changelog',
    types: { 'application/atom+xml': '/changelog/feed.xml' },
  },
  openGraph: {
    title: 'Exawatt Changelog',
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Exawatt Changelog',
    description: DESCRIPTION,
  },
};

/**
 * Every published release, newest first (ENG-031 W25). Each entry is written
 * once in `docs/product/changelog/<version>.md`; the GitHub Release body
 * renders from the same file. An entry above the published version is a draft
 * and is not shown.
 */
export default async function ChangelogPage() {
  const entries = await publishedChangelogEntries();
  return (
    <SiteDocPage>
      <header className="flex items-end justify-between gap-4 border-b border-white/10 pb-8 md:pl-[13.5rem]">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Changelog
        </h1>
        <a
          href="/changelog/feed.xml"
          className="pb-1 text-sm text-white/55 hover:text-white"
        >
          RSS
        </a>
      </header>
      <div className="divide-y divide-white/10">
        {entries.map(entry => (
          <div key={entry.version} className="py-12 md:py-16">
            <ChangelogEntryView entry={entry} headingLevel={2} />
          </div>
        ))}
      </div>
    </SiteDocPage>
  );
}
