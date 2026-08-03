import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export interface RoadmapProjectChange {
  hash: string;
  subject: string;
  /** Unix epoch milliseconds. */
  committedAt: number;
}

export async function readRoadmapActivity(
  projectDir: string
): Promise<RoadmapProjectChange[]> {
  if (!path.isAbsolute(projectDir) || projectDir.includes('\0')) {
    throw new Error('Invalid Project directory');
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectDir, 'log', '-30', '--pretty=%H%x00%ct%x00%s'],
      { timeout: 5000, maxBuffer: 512 * 1024 }
    );
    return stdout
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        const [hash, seconds, ...subject] = line.split('\0');
        const committedAt = Number(seconds) * 1000;
        return hash && Number.isFinite(committedAt) && subject.length > 0
          ? [{ hash, committedAt, subject: subject.join('\0') }]
          : [];
      });
  } catch {
    return [];
  }
}
