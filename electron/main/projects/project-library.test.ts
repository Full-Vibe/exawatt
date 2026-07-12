import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveProjectDirectory,
  scanProjectDirectory,
} from './project-library';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true })));
});

describe('Project directory discovery', () => {
  it('returns immediate children and suggests directories with project markers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'exawatt-projects-'));
    roots.push(root);
    await mkdir(join(root, 'marked'));
    await mkdir(join(root, 'plain'));
    await mkdir(join(root, '.hidden'));
    await writeFile(join(root, 'marked', 'package.json'), '{}');

    expect(await scanProjectDirectory(root)).toEqual([
      {
        projectDir: join(root, 'marked'),
        projectName: 'marked',
        suggested: true,
      },
      {
        projectDir: join(root, 'plain'),
        projectName: 'plain',
        suggested: false,
      },
    ]);
  });

  it('rejects missing and relative directories before discovery', async () => {
    await expect(resolveProjectDirectory('relative')).rejects.toThrow(
      'valid absolute directory'
    );
    await expect(
      resolveProjectDirectory('/definitely/missing/exawatt')
    ).rejects.toThrow('Directory does not exist');
  });
});
