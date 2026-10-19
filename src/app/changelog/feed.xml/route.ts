import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';
import { publishedChangelogEntries } from '@/lib/changelog/published';
import { changelogEntryUrl, inlineRuns } from '@/lib/changelog/changelog.mjs';

export const dynamic = 'force-static';
// Must equal CHANGELOG_REVALIDATE_SECONDS; Next reads this export statically.
export const revalidate = 300;

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineHtml(text: string): string {
  return inlineRuns(text)
    .map(run =>
      run.strong ? `<strong>${escape(run.text)}</strong>` : escape(run.text)
    )
    .join('');
}

/** The changelog as an Atom feed (ENG-031 W25), one entry per published
 *  release. */
export async function GET() {
  const entries = await publishedChangelogEntries();
  const site = `${EXAWATT_HOSTED_ORIGIN}/changelog`;
  const updated = entries[0]
    ? `${entries[0].date}T00:00:00Z`
    : new Date(0).toISOString();
  const items = entries.map(entry => {
    const url = changelogEntryUrl(EXAWATT_HOSTED_ORIGIN, entry.version);
    const html = [
      ...entry.summary.map(paragraph => `<p>${inlineHtml(paragraph)}</p>`),
      ...entry.sections.map(
        section =>
          `<h3>${escape(section.heading)}</h3><ul>${section.items
            .map(item => `<li>${inlineHtml(item)}</li>`)
            .join('')}</ul>`
      ),
    ].join('');
    return [
      '  <entry>',
      `    <id>${url}</id>`,
      `    <title>${escape(`${entry.title} (${entry.version})`)}</title>`,
      `    <link rel="alternate" type="text/html" href="${url}"/>`,
      `    <updated>${entry.date}T00:00:00Z</updated>`,
      `    <published>${entry.date}T00:00:00Z</published>`,
      `    <summary>${escape(entry.summary[0])}</summary>`,
      `    <content type="html">${escape(html)}</content>`,
      '  </entry>',
    ].join('\n');
  });
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${site}</id>`,
    '  <title>Exawatt Changelog</title>',
    '  <subtitle>New in Exawatt, release by release.</subtitle>',
    `  <link rel="alternate" type="text/html" href="${site}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${site}/feed.xml"/>`,
    `  <updated>${updated}</updated>`,
    '  <author><name>Exawatt</name></author>',
    ...items,
    '</feed>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}
