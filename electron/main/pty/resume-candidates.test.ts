import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listResumeCandidates,
  opencodeSessionAgent,
  parseOpencodeSessionList,
} from './resume-candidates';

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

async function projectDirectory() {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-resume-project-')
  );
  roots.push(root);
  return fs.promises.realpath(root);
}

describe('listResumeCandidates', () => {
  it('parses bounded exact OpenCode session identities without accepting malformed rows', () => {
    expect(
      parseOpencodeSessionList(
        JSON.stringify([
          {
            id: 'ses_0365acf1bffe15qKmRP05YlcIu',
            title: 'Provider routing',
            directory: '/projects/exawatt',
            created: 100,
            updated: 200,
          },
          {
            id: '../unsafe',
            title: 'Unsafe',
            directory: '/projects/exawatt',
            created: 100,
            updated: 200,
          },
        ])
      )
    ).toEqual([
      {
        id: 'ses_0365acf1bffe15qKmRP05YlcIu',
        title: 'Provider routing',
        directory: '/projects/exawatt',
        created: 100,
        updated: 200,
      },
    ]);
  });

  it('reads the source-owned OpenCode launch-agent marker from the first user turn', async () => {
    const bin = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-opencode-export-')
    );
    roots.push(bin);
    const executable = path.join(bin, 'opencode');
    await fs.promises.writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"info":{"id":"ses_exact_marker"},"messages":[{"info":{"role":"user","agent":"exawatt-12345678"},"parts":[]}]}'
`,
      { mode: 0o755 }
    );
    const priorTest = process.env.EXAWATT_TEST;
    const priorBin = process.env.EXAWATT_TEST_HARNESS_BIN;
    process.env.EXAWATT_TEST = '1';
    process.env.EXAWATT_TEST_HARNESS_BIN = bin;
    try {
      await expect(
        opencodeSessionAgent(
          'ses_exact_marker',
          await projectDirectory(),
          '/bin/sh'
        )
      ).resolves.toBe('exawatt-12345678');
    } finally {
      if (priorTest === undefined) delete process.env.EXAWATT_TEST;
      else process.env.EXAWATT_TEST = priorTest;
      if (priorBin === undefined) delete process.env.EXAWATT_TEST_HARNESS_BIN;
      else process.env.EXAWATT_TEST_HARNESS_BIN = priorBin;
    }
  });

  it('does not fabricate an OpenCode marker without a user message', async () => {
    const bin = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'exawatt-opencode-export-empty-')
    );
    roots.push(bin);
    await fs.promises.writeFile(
      path.join(bin, 'opencode'),
      `#!/bin/sh
printf '%s\n' '{"info":{"id":"ses_no_user_marker"},"messages":[{"info":{"role":"assistant","agent":"exawatt-wrong"},"parts":[]}]}'
`,
      { mode: 0o755 }
    );
    const priorTest = process.env.EXAWATT_TEST;
    const priorBin = process.env.EXAWATT_TEST_HARNESS_BIN;
    process.env.EXAWATT_TEST = '1';
    process.env.EXAWATT_TEST_HARNESS_BIN = bin;
    try {
      await expect(
        opencodeSessionAgent(
          'ses_no_user_marker',
          await projectDirectory(),
          '/bin/sh'
        )
      ).resolves.toBeNull();
    } finally {
      if (priorTest === undefined) delete process.env.EXAWATT_TEST;
      else process.env.EXAWATT_TEST = priorTest;
      if (priorBin === undefined) delete process.env.EXAWATT_TEST_HARNESS_BIN;
      else process.env.EXAWATT_TEST_HARNESS_BIN = priorBin;
    }
  });
  it('returns exact Codex IDs for the requested cwd with useful labels', async () => {
    const cwd = await projectDirectory();
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
    const cwd = await projectDirectory();
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
    const cwd = await projectDirectory();
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
