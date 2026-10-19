type ChangelogSection = 'New' | 'Improvements' | 'Fixes';

export interface ChangelogEntry {
  readonly version: string;
  /** YYYY-MM-DD, the day the release was published. */
  readonly date: string;
  readonly title: string;
  /** A site path to the entry's clip or image, or null while it has none. */
  readonly media: string | null;
  /** Paragraphs on the named feature; `**bold**` is the only markup. */
  readonly summary: string[];
  readonly sections: { heading: ChangelogSection; items: string[] }[];
}

export declare const CHANGELOG_SECTIONS: readonly ChangelogSection[];
export declare function parseChangelogEntry(
  text: string,
  source?: string
): ChangelogEntry;
export declare function readChangelog(directory: string): ChangelogEntry[];
export declare function releasedEntries(
  entries: readonly ChangelogEntry[],
  publishedVersion: string
): ChangelogEntry[];
export declare function requireChangelogEntry(
  directory: string,
  version: string
): ChangelogEntry;
export declare function inlineRuns(
  text: string
): { text: string; strong: boolean }[];
export declare function changelogEntryUrl(
  origin: string,
  version: string
): string;
export declare function releaseNotesMarkdown(
  entry: ChangelogEntry,
  options?: { origin?: string }
): string;
