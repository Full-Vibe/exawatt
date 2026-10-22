import type {
  NoticeDismissals,
  PreviousVersion,
  ProductUpdateStatus,
  UpdateReadyNotice,
} from '@exawatt/core/desktop-bridge';
import {
  compareVersions,
  isReleaseVersion,
  isUnreleasedVersion,
} from '@/lib/changelog/versions.mjs';

/**
 * What a notice is about, as an id and a version. Main keeps one record of
 * the version the operator dismissed per id (`notice-dismissals.ts`); a
 * notice shows again only when its version changes (BUG-285).
 *
 * The version is the fact the operator would have to act on differently.
 * "New local build installed. Restart when convenient." is about the build
 * he is RUNNING being superseded: a third install under the same running
 * build asks nothing new of him, so it does not bring the notice back,
 * while restarting onto a new build and being superseded again does.
 */
interface NoticeIdentity {
  id: string;
  version: string;
}

export function localBuildNotice(
  installed: UpdateReadyNotice | null
): NoticeIdentity | null {
  if (!installed || installed.installedSha === installed.currentSha) {
    return null;
  }
  return { id: 'local-build-installed', version: installed.currentSha };
}

/**
 * One id per kind of update news, so dismissing the download's progress
 * does not hide its failure. Every `product-update:` id is forgotten when the
 * operator chooses Check for Updates.
 */
export function productUpdateNotice(
  status: ProductUpdateStatus | null
): NoticeIdentity | null {
  if (!status || status.phase === 'idle') return null;
  const version = status.availableVersion ?? status.currentVersion;
  if (status.phase === 'error') {
    return {
      id: 'product-update:failed',
      version: `${version}:${status.error ?? ''}`,
    };
  }
  if (status.phase === 'downloaded') {
    return { id: 'product-update:ready', version };
  }
  return { id: 'product-update:progress', version };
}

/**
 * "What's new in <version>" (ENG-031 W28): once, after the app starts on a
 * newer version than the one this installation ran before, and only when
 * that version's changelog page is live.
 *
 * The page is live when the update feed publishes this version or a later
 * one: the site applies the same rule to the same feed
 * (`isUnreleasedVersion`, decision 0009). Only the feed's own answer counts,
 * so a build with no update channel (a dogfood or community build, a dev
 * run) never shows it, and neither does a launch whose check has not
 * answered. A first install has nothing to compare with and shows nothing.
 */
export function whatsNewNotice(
  previous: PreviousVersion | null,
  status: ProductUpdateStatus | null
): NoticeIdentity | null {
  if (!previous || previous.kind === 'none' || !status) return null;
  const { currentVersion, availableVersion } = status;
  if (!isReleaseVersion(currentVersion) || !isReleaseVersion(availableVersion))
    return null;
  if (previous.kind === 'recorded') {
    if (!isReleaseVersion(previous.version)) return null;
    if (compareVersions(currentVersion, previous.version) <= 0) return null;
  }
  if (isUnreleasedVersion(currentVersion, availableVersion)) return null;
  return { id: 'whats-new', version: currentVersion };
}

export function isDismissed(
  notice: NoticeIdentity | null,
  dismissals: NoticeDismissals
): boolean {
  return notice !== null && dismissals[notice.id] === notice.version;
}
