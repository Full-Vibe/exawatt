import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocBlocks } from '@/components/site/docs/doc-blocks';
import { SiteDocPage } from '@/components/site/docs/site-doc-page';
import { guidePath, publishedGuides } from '@/lib/guides/guides';

// Only published guides have a page. Publication is a build-time fact, so any
// other slug is refused before render and answers a real 404.
export const dynamicParams = false;

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return publishedGuides().map(guide => ({ slug: guide.slug }));
}

function guideFor(slug: string) {
  return publishedGuides().find(guide => guide.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: GuidePageProps): Promise<Metadata> {
  const guide = guideFor((await params).slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: guidePath(guide.slug) },
    openGraph: {
      title: guide.title,
      description: guide.description,
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title: guide.title,
      description: guide.description,
    },
  };
}

/** One guide, rendered from its Markdown file (ENG-031 W26). */
export default async function GuidePage({ params }: GuidePageProps) {
  const guide = guideFor((await params).slug);
  if (!guide) notFound();
  return (
    <SiteDocPage>
      <article className="mx-auto max-w-2xl" data-guide={guide.slug}>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-white text-balance md:text-[2.5rem]">
          {guide.title}
        </h1>
        <div className="mt-6">
          <DocBlocks blocks={guide.blocks} />
        </div>
        <div className="mt-16 border-t border-white/10 pt-6">
          <Link
            href="/guides"
            className="text-sm text-white/60 hover:text-white"
          >
            All guides
          </Link>
        </div>
      </article>
    </SiteDocPage>
  );
}
