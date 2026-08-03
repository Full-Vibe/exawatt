import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRoadmap } from '@exawatt/core';
import { undoRoadmapState, writeRoadmapState } from './roadmap-writer';

const roots: string[] = [];

async function fixture(version: 'v1' | 'v2' | null = 'v2') {
  const projectDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-roadmap-')
  );
  roots.push(projectDir);
  const file = 'ROADMAP.md';
  const marker = version ? `---\nexawatt-roadmap: ${version}\n---\n\n` : '';
  const text = `${marker}## Now\n\n### ACME-001 Current work\n\nStatus: now\n\nMilestones:\n\n- [ ] M1 First slice\n\n### ACME-002 Other work\n\nStatus: now\n\n## Next\n\n### ACME-003 Queued work\n\nStatus: next\n`;
  await fs.promises.writeFile(path.join(projectDir, file), text);
  return {
    projectDir,
    file,
    text,
    hash: parseRoadmap(text, { projectDir, file }).contentHash,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => fs.promises.rm(root, { recursive: true }))
  );
});

describe('roadmap state writer', () => {
  it('changes structural state, writes no git metadata, and supports exact undo', async () => {
    const setup = await fixture();
    const result = await writeRoadmapState({
      ...setup,
      expectedContentHash: setup.hash,
      action: { kind: 'set-status', itemId: 'ACME-003', status: 'parked' },
    });
    expect(result.status).toBe('applied');
    const changed = await fs.promises.readFile(
      path.join(setup.projectDir, setup.file),
      'utf8'
    );
    expect(changed).toContain('## Parked');
    expect(changed).toContain('Status: parked');
    await expect(
      fs.promises.stat(path.join(setup.projectDir, '.git'))
    ).rejects.toThrow();

    if (result.status !== 'applied') throw new Error('expected applied write');
    expect(await undoRoadmapState(result.undoToken)).toMatchObject({
      status: 'applied',
    });
    expect(
      await fs.promises.readFile(
        path.join(setup.projectDir, setup.file),
        'utf8'
      )
    ).toBe(setup.text);
  });

  it('refuses undeclared and concurrently changed roadmaps', async () => {
    const undeclared = await fixture(null);
    expect(
      await writeRoadmapState({
        ...undeclared,
        expectedContentHash: undeclared.hash,
        action: { kind: 'move-item', itemId: 'ACME-002', direction: 'up' },
      })
    ).toMatchObject({ status: 'refused' });

    const moved = await fixture();
    await fs.promises.appendFile(
      path.join(moved.projectDir, moved.file),
      '\nexternal edit\n'
    );
    expect(
      await writeRoadmapState({
        ...moved,
        expectedContentHash: moved.hash,
        action: {
          kind: 'set-milestone',
          itemId: 'ACME-001',
          line: 12,
          done: true,
        },
      })
    ).toMatchObject({ status: 'refused' });
  });

  it('reorders only within one state and toggles a source-anchored milestone', async () => {
    const moved = await fixture();
    const moveResult = await writeRoadmapState({
      ...moved,
      expectedContentHash: moved.hash,
      action: { kind: 'move-item', itemId: 'ACME-002', direction: 'up' },
    });
    expect(moveResult.status).toBe('applied');
    const movedText = await fs.promises.readFile(
      path.join(moved.projectDir, moved.file),
      'utf8'
    );
    expect(movedText.indexOf('### ACME-002')).toBeLessThan(
      movedText.indexOf('### ACME-001')
    );

    const milestone = await fixture();
    const milestoneResult = await writeRoadmapState({
      ...milestone,
      expectedContentHash: milestone.hash,
      action: {
        kind: 'set-milestone',
        itemId: 'ACME-001',
        line: 13,
        done: true,
      },
    });
    expect(milestoneResult.status).toBe('applied');
    expect(
      await fs.promises.readFile(
        path.join(milestone.projectDir, milestone.file),
        'utf8'
      )
    ).toContain('- [x] M1 First slice');
  });

  it('refuses undo after another writer moves the file', async () => {
    const setup = await fixture();
    const result = await writeRoadmapState({
      ...setup,
      expectedContentHash: setup.hash,
      action: { kind: 'set-status', itemId: 'ACME-003', status: 'later' },
    });
    if (result.status !== 'applied') throw new Error('expected applied write');
    await fs.promises.appendFile(
      path.join(setup.projectDir, setup.file),
      '\nagent edit\n'
    );
    expect(await undoRoadmapState(result.undoToken)).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('changed after'),
    });
  });

  it('rejects backlog metadata mutation as outside structural state writes', async () => {
    const setup = await fixture('v1');
    expect(
      await writeRoadmapState({
        ...setup,
        expectedContentHash: setup.hash,
        action: {
          kind: 'set-status',
          itemId: 'ACME-003',
          status: 'backlog',
        } as never,
      })
    ).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Invalid roadmap state action'),
    });
  });

  it('recognizes declared conformance without normalizing CRLF files', async () => {
    const setup = await fixture('v2');
    const crlf = setup.text.replace(/\n/g, '\r\n');
    await fs.promises.writeFile(path.join(setup.projectDir, setup.file), crlf);
    const result = await writeRoadmapState({
      projectDir: setup.projectDir,
      file: setup.file,
      expectedContentHash: parseRoadmap(crlf, {
        projectDir: setup.projectDir,
        file: setup.file,
      }).contentHash,
      action: { kind: 'move-item', itemId: 'ACME-002', direction: 'up' },
    });
    expect(result.status).toBe('applied');
    expect(
      await fs.promises.readFile(
        path.join(setup.projectDir, setup.file),
        'utf8'
      )
    ).toContain('\r\n');
  });
});
