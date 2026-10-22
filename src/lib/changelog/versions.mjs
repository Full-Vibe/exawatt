/**
 * The release-version rules of the changelog (ENG-031 W25), with no Node
 * built-ins, so the desktop renderer's bundle applies the same publication
 * rule as the site (ENG-031 W28: the app's "What's new" line opens an entry
 * only when the site serves it). `changelog.mjs` is the Node-side module and
 * builds on these.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

export class ChangelogError extends Error {
  constructor(source, message) {
    super(`[changelog] ${source}: ${message}`);
    this.name = 'ChangelogError';
  }
}

/** A release version is exactly X.Y.Z. */
export function isReleaseVersion(value) {
  return typeof value === 'string' && VERSION.test(value);
}

/** Negative, zero or positive as `left` is below, at or above `right`. */
export function compareVersions(left, right) {
  for (const [label, value] of [
    ['version', left],
    ['compared version', right],
  ]) {
    if (!isReleaseVersion(value)) {
      throw new ChangelogError(label, `"${value}" is not a version`);
    }
  }
  const a = VERSION.exec(left).slice(1).map(Number);
  const b = VERSION.exec(right).slice(1).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Whether `version` is above the published one: a draft for a release that
 * has not shipped. The one rule every changelog surface, the proxy and the
 * app apply, so nothing announces a version users cannot install.
 */
export function isUnreleasedVersion(version, publishedVersion) {
  for (const [label, value] of [
    ['version', version],
    ['published version', publishedVersion],
  ]) {
    if (!isReleaseVersion(value)) {
      throw new ChangelogError(label, `"${value}" is not a version`);
    }
  }
  return compareVersions(version, publishedVersion) > 0;
}

/** The entry's page on a site origin, e.g. https://www.exawatt.ai. */
export function changelogEntryUrl(origin, version) {
  return `${origin.replace(/\/$/u, '')}/changelog/${version}`;
}
