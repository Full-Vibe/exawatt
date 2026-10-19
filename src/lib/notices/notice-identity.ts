import type {
  NoticeDismissals,
  ProductUpdateStatus,
  UpdateReadyNotice,
} from '@exawatt/core/desktop-bridge';

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
export interface NoticeIdentity {
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

export function isDismissed(
  notice: NoticeIdentity | null,
  dismissals: NoticeDismissals
): boolean {
  return notice !== null && dismissals[notice.id] === notice.version;
}
