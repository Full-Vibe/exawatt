'use client';

import {
  reportFolderFailure,
  requestDirectory,
} from '@/lib/native-dialog/native-dialog';
import { rebindProjectPath } from './registry';

/**
 * The folder a known Project opens from on this machine, or null when there
 * is none to open (ENG-015 S5 P5, ENG-016).
 *
 * A synced Project's recorded folder may be absent here: it was made on
 * another machine, or it moved. Then this is the one Locate, for the
 * chooser and ⌘K alike: the operator picks the folder, it resolves to its
 * Project root exactly as Browse resolves one, and the registry is rebound
 * to that root, so the next open needs no Locate. A pick that resolves to no
 * Project says why in the folder request's own failure notice.
 */
export async function projectFolderOnThisMachine(project: {
  /** The registry row to rebind, when the Project has one. */
  registryId: string | null;
  name: string;
  rootPath: string;
}): Promise<string | null> {
  const exists = await window.electron?.dialog?.pathExists(project.rootPath);
  if (exists !== false) return project.rootPath;

  const pick = await requestDirectory(`Locate ${project.name}`);
  if (pick.status !== 'picked') return null;
  try {
    const resolved = await window.electron?.projects?.resolve(pick.path);
    if (!resolved) return null;
    if (!resolved.ok) {
      reportFolderFailure(resolved.error);
      return null;
    }
    if (project.registryId) {
      // The open still goes ahead; the next one asks again.
      await rebindProjectPath(project.registryId, resolved.projectDir).catch(
        () => {}
      );
    }
    return resolved.projectDir;
  } catch (cause) {
    reportFolderFailure(
      cause instanceof Error
        ? cause.message
        : 'The selected Project could not be opened.'
    );
    return null;
  }
}
