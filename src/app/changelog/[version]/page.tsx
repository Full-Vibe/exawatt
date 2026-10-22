import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangelogEntryView } from '@/components/site/changelog/changelog-entry';
import { SiteDocPage } from '@/components/site/docs/site-doc-page';
import { changelogEntries } from '@/lib/changelog/entries';
import { publishedChangelogEntries } from '@/lib/changelog/published';

// Every entry is prerendered, drafts included, and nothing else is served.
// A draft's prerender calls notFound() at build, so it is cached as a real
// 404 and becomes the entry on the first revalidation after the feed
// publishes its version. Rendering it on demand instead would stream under
// the root loading boundary and answer 200 with the not-found page.
export const dynamicParams = false;
// Must equal CHANGELOG_REVALIDATE_SECONDS; Next reads this export statically.
export const revalidate = 300;

interface EntryPageProps {
  params: Promise<{ version: string }>;
}

export function generateStaticParams() {
  return changelogEntries().map(entry => ({ version: entry.version }));
}

async function entryFor(version: string) {
  return (
    (await publishedChangelogEntries()).find(
      entry => entry.version === version
    ) ?? null
  );
}

export async function generateMetadata({
  params,
}: EntryPageProps): Promise<Metadata> {
  const { version } = await params;
  const entry = await entryFor(version);
  if (!entry) return {};
  const title = `${entry.title} · Exawatt ${entry.version}`;
  const description = entry.summary[0];
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: `/changelog/${entry.version}`,
      types: { 'application/atom+xml': '/changelog/feed.xml' },
    },
    openGraph: { title, description, type: 'article' },
    twitter: { card: 'summary', title, description },
  };
}

/** One release on its own page: what `/download` and the app link to. */
export default async function ChangelogEntryPage({ params }: EntryPageProps) {
  const { version } = await params;
  const entry = await entryFor(version);
  if (!entry) notFound();
  return (
    <SiteDocPage>
      <ChangelogEntryView entry={entry} headingLevel={1} />
      <div className="mt-16 border-t border-white/10 pt-6 md:ml-[13.5rem]">
        <Link
          href="/changelog"
          className="text-sm text-white/60 hover:text-white"
        >
          All releases
        </Link>
      </div>
    </SiteDocPage>
  );
}
