import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listResumeCandidates } from './resume-candidates';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true }))
  );
});

async function rollout(id: string, cwd: string, userText: string) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exawatt-codex-'));
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
        payload: { role: 'user', content: [{ type: 'input_text', text: userText }] },
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
    expect(await listResumeCandidates('codex', '/projects/exawatt', root)).toEqual([]);
    expect(await listResumeCandidates('claude', '/projects/other', root)).toEqual([]);
  });
});
