import path from 'path';

/**
 * Resolve a repo-derived (UNTRUSTED) path against a project root, refusing
 * anything that would escape it (ENG-017 security review). Pure and
 * synchronous over already-real paths so it is unit-testable without a
 * filesystem; the IPC handler resolves symlinks with realpath first, then
 * calls this on the real paths.
 *
 * Returns the resolved absolute path, or null if it escapes / is disallowed.
 */
export function resolveContainedPath(
  realRoot: string,
  realTarget: string
): string | null {
  const root = path.resolve(realRoot);
  const target = path.resolve(realTarget);
  if (target === root) return target;
  if (target.startsWith(root + path.sep)) return target;
  return null;
}

/** A repo-derived path must be relative and free of home expansion. */
export function isRepoRelativePath(rawPath: string): boolean {
  return (
    !!rawPath &&
    !rawPath.includes('\0') &&
    rawPath.length <= 4096 &&
    !path.isAbsolute(rawPath) &&
    !rawPath.startsWith('~')
  );
}
