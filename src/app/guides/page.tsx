import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteDocPage } from '@/components/site/docs/site-doc-page';
import { guidePath, publishedGuides } from '@/lib/guides/guides';

export const dynamic = 'force-static';

const DESCRIPTION =
  'Step-by-step guides to running Claude Code, Codex and Gemini in Exawatt.';

export const metadata: Metadata = {
  title: 'Guides',
  description: DESCRIPTION,
  alternates: { canonical: '/guides' },
  openGraph: { title: 'Exawatt Guides', description: DESCRIPTION },
  twitter: {
    card: 'summary',
    title: 'Exawatt Guides',
    description: DESCRIPTION,
  },
};

/**
 * Every published guide, in order (ENG-031 W26). Each is written once in
 * `docs/product/guides/<slug>.md`; `published: true` in its front matter is
 * what puts it here.
 */
export default function GuidesPage() {
  const guides = publishedGuides();
  return (
    <SiteDocPage>
      <div className="mx-auto max-w-2xl">
        <h1 className="border-b border-white/10 pb-8 text-4xl font-semibold tracking-tight md:text-5xl">
          Guides
        </h1>
        <ul className="divide-y divide-white/10">
          {guides.map(guide => (
            <li key={guide.slug} data-guide={guide.slug}>
              <Link href={guidePath(guide.slug)} className="group block py-8">
                <h2 className="text-[1.375rem] font-semibold leading-snug tracking-tight text-white text-balance group-hover:text-white/85">
                  {guide.title}
                </h2>
                <p className="mt-2 text-[1.0625rem] leading-relaxed text-white/65">
                  {guide.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </SiteDocPage>
  );
}
