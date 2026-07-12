import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listResumeCandidates } from './resume-candidates';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

async function rollout(id: string, cwd: string, userText: string) {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-codex-')
  );
  roots.push(root);
  const file = path.join(root, `rollout-${id}.jsonl`);
  await fs.promises.writeFile(
    file,
    [
      JSON.stringify({
        type: 'session_meta',
        payload: { session_id: id, cwd },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ type: 'input_text', text: userText }],
        },
      }),
    ].join('\n')
  );
  return { root, file };
}

describe('listResumeCandidates', () => {
  it('returns exact Codex IDs for the requested cwd with useful labels', async () => {
    const cwd = '/projects/exawatt';
    const { root } = await rollout(
      '22222222-2222-4222-8222-222222222222',
      cwd,
      'Implement the terminal search flow'
    );
    const candidates = await listResumeCandidates('codex', cwd, root);
    expect(candidates).toMatchObject([
      {
        id: '22222222-2222-4222-8222-222222222222',
        cwd,
        label: 'Implement the terminal search flow',
      },
    ]);
  });

  it('does not offer another cwd or a non-Codex harness', async () => {
    const { root } = await rollout(
      '33333333-3333-4333-8333-333333333333',
      '/projects/other',
      'Unrelated work'
    );
    expect(
      await listResumeCandidates('codex', '/projects/exawatt', root)
    ).toEqual([]);
    expect(
      await listResumeCandidates('claude', '/projects/other', root)
    ).toEqual([]);
  });

  it('matches the same directory through a filesystem symlink', async () => {
    const projectRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-project-')
    );
    roots.push(projectRoot);
    const realCwd = path.join(projectRoot, 'real');
    const linkedCwd = path.join(projectRoot, 'linked');
    await fs.promises.mkdir(realCwd);
    await fs.promises.symlink(realCwd, linkedCwd);
    const { root } = await rollout(
      '44444444-4444-4444-8444-444444444444',
      realCwd,
      'Resume through a canonical macOS path'
    );

    const candidates = await listResumeCandidates('codex', linkedCwd, root);
    expect(candidates.map(candidate => candidate.id)).toEqual([
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('isolates rollout churn instead of rejecting the whole catalog', async () => {
    const cwd = '/projects/exawatt';
    const { root } = await rollout(
      '55555555-5555-4555-8555-555555555555',
      cwd,
      'Keep the usable conversation'
    );
    await fs.promises.symlink(
      path.join(root, 'already-rotated'),
      path.join(root, 'rollout-disappeared.jsonl')
    );

    await expect(
      listResumeCandidates('codex', cwd, root)
    ).resolves.toMatchObject([{ id: '55555555-5555-4555-8555-555555555555' }]);
  });

  it('reads a bounded prefix rather than loading a large rollout body', async () => {
    const cwd = '/projects/exawatt';
    const { root, file } = await rollout(
      '66666666-6666-4666-8666-666666666666',
      cwd,
      'Label near the front'
    );
    await fs.promises.appendFile(file, `\n${'z'.repeat(16 * 1024 * 1024)}`);

    const readFile = vi.spyOn(fs.promises, 'readFile');
    const candidates = await listResumeCandidates('codex', cwd, root);
    expect(candidates[0]).toMatchObject({
      id: '66666666-6666-4666-8666-666666666666',
      label: 'Label near the front',
    });
    expect(readFile).not.toHaveBeenCalled();
    readFile.mockRestore();
  });
});
