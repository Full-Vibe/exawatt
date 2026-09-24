import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { RoadmapSessionEvidence } from '@exawatt/core/desktop-bridge';

const execFileAsync = promisify(execFile);

function assertValidCwd(cwd: string): void {
  if (!cwd || cwd.includes('\0') || cwd.length > 4096 || !path.isAbsolute(cwd)) {
    throw new Error('Invalid session directory');
  }
}

export async function readSessionEvidence(cwd: string): Promise<RoadmapSessionEvidence> {
  assertValidCwd(cwd);
  let branch: string | null = null;
  let commitSubjects: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { timeout: 5000 }
    );
    branch = stdout.trim() || null;
  } catch {
    // not a git checkout — evidence stays branchless
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'log', '-5', '--pretty=%s'],
      { timeout: 5000 }
    );
    commitSubjects = stdout.split('\n').filter(Boolean);
  } catch {
    commitSubjects = [];
  }
  return { branch, worktreeDirname: path.basename(cwd), commitSubjects };
}
