export declare class ChangelogError extends Error {
  constructor(source: string, message: string);
}
export declare function isReleaseVersion(value: unknown): value is string;
export declare function compareVersions(left: string, right: string): number;
export declare function isUnreleasedVersion(
  version: string,
  publishedVersion: string
): boolean;
export declare function changelogEntryUrl(
  origin: string,
  version: string
): string;
