import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/** `~` and `~/x` are how operators type paths — expand before any fs use */
export function expandTilde(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Directory → Project resolution: the grouping key that maps sessions to a
 * Project/Initiative (a resolvable Project / Context Group lens — see
 * docs/product/concepts.md and ENG-002).
 *
 * A git WORKTREE resolves to its MAIN repository: `--git-common-dir` points
 * at the primary .git even from a linked worktree, so agents running in
 * `exawatt-wt/<branch>` cluster under `exawatt`. Non-git directories are
 * their own project.
 */
export interface ProjectRef {
  projectDir: string;
  projectName: string;
}

export async function resolveProject(cwd: string): Promise<ProjectRef> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--git-common-dir'],
      { timeout: 5000 }
    );
    const common = stdout.trim();
    const abs = path.isAbsolute(common) ? common : path.resolve(cwd, common);
    const projectDir = path.dirname(abs);
    return { projectDir, projectName: path.basename(projectDir) };
  } catch {
    return { projectDir: cwd, projectName: path.basename(cwd) || cwd };
  }
}

/**
 * Every live working directory for one git Project. Provider histories are
 * keyed by the directory they launched in, so Project-scoped discovery needs
 * these paths even though Exawatt groups them under the common repository.
 */
export async function listProjectWorktrees(
  projectDir: string
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectDir, 'worktree', 'list', '--porcelain', '-z'],
      { timeout: 5000 }
    );
    const directories = stdout
      .split('\0')
      .filter(field => field.startsWith('worktree '))
      .map(field => field.slice('worktree '.length))
      .filter(Boolean);
    return directories.length > 0 ? directories : [projectDir];
  } catch {
    return [projectDir];
  }
}

/**
 * One-gesture worktree creation (operator convention, 2026-07-02):
 * worktrees live in a sibling container `<repo>-wt/<branch-dirname>/`.
 * Returns the new worktree path.
 */
export async function createWorktree(
  repoDir: string,
  branch: string
): Promise<string> {
  repoDir = expandTilde(repoDir.trim());
  const name = path.basename(repoDir);
  const container = path.join(path.dirname(repoDir), `${name}-wt`);
  // branch names may contain slashes (agent/foo); flatten for the dir name
  const dirName = branch.replace(/\//g, '-').replace(/[^\w.-]+/g, '-');
  const dest = path.join(container, dirName);
  await execFileAsync(
    'git',
    ['-C', repoDir, 'worktree', 'add', dest, '-b', branch],
    { timeout: 30000 }
  );
  return dest;
}
