import Link from 'next/link';
import { inlineRuns } from '@/lib/changelog/changelog.mjs';
import {
  formatChangelogDate,
  type ChangelogEntry,
} from '@/lib/changelog/entries';
import { InlineText } from '@/components/site/docs/inline-text';

function Inline({ text }: { text: string }) {
  return <InlineText runs={inlineRuns(text)} />;
}

/**
 * The entry's one visual (Linear's form: one named feature, one short clip or
 * image). THE SLOT: an entry gains it by naming `media:` in its front matter,
 * a site path under `public/`. A clip plays silent and looped, the way the
 * marketing canon describes it. With no media the slot renders nothing,
 * because a placeholder in front of a visitor says nothing they can use.
 */
function EntryMedia({ entry }: { entry: ChangelogEntry }) {
  if (!entry.media) return null;
  const clip = /\.(mp4|webm|mov)$/iu.test(entry.media);
  return (
    <figure
      className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
      data-changelog-media
    >
      {clip ? (
        <video
          src={entry.media}
          autoPlay
          muted
          loop
          playsInline
          className="block h-auto w-full"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a static file the entry names; its size is the file's own
        <img
          src={entry.media}
          alt={entry.title}
          className="block h-auto w-full"
        />
      )}
    </figure>
  );
}

/**
 * One release: date and version beside the entry on a wide screen, above it
 * on a phone. `headingLevel` is 1 on the entry's own page and 2 in the list.
 */
export function ChangelogEntryView({
  entry,
  headingLevel,
}: {
  entry: ChangelogEntry;
  headingLevel: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const href = `/changelog/${entry.version}`;
  return (
    <article
      id={entry.version}
      className="grid scroll-mt-20 gap-3 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10"
      data-changelog-entry={entry.version}
    >
      <div className="flex items-baseline gap-3 text-sm text-white/55 md:sticky md:top-20 md:flex-col md:gap-1 md:self-start">
        <time dateTime={entry.date}>{formatChangelogDate(entry.date)}</time>
        <span className="tabular-nums text-white/45">{entry.version}</span>
      </div>
      <div className="min-w-0">
        <Heading className="text-[1.75rem] font-semibold leading-tight tracking-tight text-white text-balance md:text-[2rem]">
          {headingLevel === 1 ? (
            entry.title
          ) : (
            <Link href={href} className="hover:text-white/85">
              {entry.title}
            </Link>
          )}
        </Heading>
        <div className="mt-4 space-y-3 text-[1.0625rem] leading-relaxed text-white/80">
          {entry.summary.map((paragraph, index) => (
            <p key={index}>
              <Inline text={paragraph} />
            </p>
          ))}
        </div>
        <EntryMedia entry={entry} />
        {entry.sections.map(section => (
          <section key={section.heading} className="mt-8">
            <h3 className="text-sm font-semibold text-white/90">
              {section.heading}
            </h3>
            <ul className="mt-3 space-y-2.5 text-[0.9375rem] leading-relaxed text-white/70">
              {section.items.map((item, index) => (
                <li key={index} className="relative pl-4">
                  <span
                    aria-hidden
                    className="absolute left-0 top-[0.7em] h-1 w-1 rounded-full bg-white/35"
                  />
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
