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

/**
 * Whether a linked worktree folds into its repository (ENG-046, operator
 * 2026-10-15: "Start with 1. We'll shift this around over time."). The
 * two-way door: flipping it changes which folder a worktree joins, and the
 * join rule below stays the one place that decides.
 */
export const FOLD_WORKTREES = true;

/** A joined folder: the Project's directory and, inside git, the common
 *  directory that identifies the repository across its worktrees. */
export interface ProjectFolder extends ProjectRef {
  /** Absolute git common directory, or null for a folder outside git. */
  commonDir: string | null;
}

/**
 * THE join rule (decision 0037 §3 applied to discovery): every directory a
 * session, a Browse, an Import or a harness store names resolves here to the
 * one folder a Project binds. Folding a worktree into its repository is the
 * `foldWorktrees` flag; a subdirectory always folds to its checkout; a
 * directory outside git is itself.
 */
export async function joinProjectFolder(
  cwd: string,
  { foldWorktrees = FOLD_WORKTREES }: { foldWorktrees?: boolean } = {}
): Promise<ProjectFolder> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      // Folding asks only for the common directory, exactly as the join
      // always has; `--show-toplevel` fails inside a bare repository.
      [
        '-C',
        cwd,
        'rev-parse',
        '--git-common-dir',
        ...(foldWorktrees ? [] : ['--show-toplevel']),
      ],
      { timeout: 5000 }
    );
    const [common = '', toplevel = ''] = stdout
      .split('\n')
      .map(line => line.trim());
    if (!common) throw new Error('not a repository');
    const commonDir = path.isAbsolute(common)
      ? common
      : path.resolve(cwd, common);
    const projectDir =
      foldWorktrees || !toplevel ? path.dirname(commonDir) : toplevel;
    return {
      projectDir,
      projectName: path.basename(projectDir),
      commonDir,
    };
  } catch {
    return {
      projectDir: cwd,
      projectName: path.basename(cwd) || cwd,
      commonDir: null,
    };
  }
}

export async function resolveProject(cwd: string): Promise<ProjectRef> {
  const { projectDir, projectName } = await joinProjectFolder(cwd);
  return { projectDir, projectName };
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
