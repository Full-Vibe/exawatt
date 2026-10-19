import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChangelogEntryView } from '@/components/site/changelog/changelog-entry';
import { changelogEntries } from '@/lib/changelog/entries';

export const dynamicParams = false;

interface EntryPageProps {
  params: Promise<{ version: string }>;
}

export function generateStaticParams() {
  return changelogEntries().map(entry => ({ version: entry.version }));
}

function entryFor(version: string) {
  return changelogEntries().find(entry => entry.version === version) ?? null;
}

export async function generateMetadata({
  params,
}: EntryPageProps): Promise<Metadata> {
  const { version } = await params;
  const entry = entryFor(version);
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
  const entry = entryFor(version);
  if (!entry) notFound();
  return (
    <main
      className="min-h-screen bg-hud-void font-ui text-white"
      data-public-exhibition-surface="true"
    >
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-14 sm:px-6 md:pt-20">
        <ChangelogEntryView entry={entry} headingLevel={1} />
        <div className="mt-16 border-t border-white/10 pt-6 md:ml-[13.5rem]">
          <Link
            href="/changelog"
            className="text-sm text-white/60 hover:text-white"
          >
            All releases
          </Link>
        </div>
      </div>
    </main>
  );
}
