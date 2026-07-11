import { describe, expect, it } from 'vitest';
import { parseRoadmap } from '../roadmap/parse';
import { inferSessionLinks, type SessionLinkCandidate } from '../roadmap/link';

const doc = parseRoadmap(
  `## Now

### ENG-016 Daily-driver adoption

### ENG-017 Project roadmap lens

## Next

### ENG-018 Durable sessions

## Later

### Dark mode support everywhere
`,
  { projectDir: '/repo', file: 'ROADMAP.md', now: () => 0 }
);

function candidate(over: Partial<SessionLinkCandidate>): SessionLinkCandidate {
  return {
    sessionId: 's1',
    tabId: 'tab-1',
    projectDir: '/repo',
    title: 'shell',
    contextSummary: null,
    cwd: '/repo',
    branch: null,
    worktreeDirname: null,
    commitSubjects: [],
    ...over,
  };
}

const links = (c: Partial<SessionLinkCandidate>) =>
  inferSessionLinks(doc, [candidate(c)], () => 0);

describe('inferSessionLinks', () => {
  it('links by branch id with high confidence', () => {
    const [link] = links({ branch: 'worktree-eng-017-roadmap-lens' });
    expect(link).toMatchObject({
      itemId: 'ENG-017',
      method: 'inferred',
      confidence: 'high',
    });
    expect(link.evidence[0]).toMatchObject({ kind: 'branch-name' });
  });

  it('respects id boundaries: eng-01 must not match inside eng-017', () => {
    const short = parseRoadmap(`## Now\n\n### ENG-01 Old thing\n`, {
      projectDir: '/repo',
      file: 'ROADMAP.md',
      now: () => 0,
    });
    expect(
      inferSessionLinks(short, [candidate({ branch: 'eng-017-rail' })], () => 0)
    ).toEqual([]);
  });

  it('links by context summary and commit subject with medium confidence', () => {
    const [viaSummary] = links({ contextSummary: 'Implementing ENG-018 resume flow' });
    expect(viaSummary).toMatchObject({ itemId: 'ENG-018', confidence: 'medium' });
    const [viaCommit] = links({ commitSubjects: ['ENG-016 S4: notifications'] });
    expect(viaCommit).toMatchObject({ itemId: 'ENG-016', confidence: 'medium' });
  });

  it('falls back to normalized title containment with low confidence', () => {
    const [link] = links({ title: 'dark mode support everywhere — spike' });
    expect(link).toMatchObject({ itemId: '~dark-mode-support-everywhere', confidence: 'low' });
  });

  it('leaves ambiguous sessions unmapped', () => {
    expect(
      links({ contextSummary: 'Working across ENG-016 and ENG-017 today' })
    ).toEqual([]);
  });

  it('collects every evidence kind for the winning item', () => {
    const [link] = links({
      branch: 'eng-017-rail',
      title: 'ENG-017 rail work',
      worktreeDirname: 'eng-017-roadmap-lens',
    });
    expect(link.itemId).toBe('ENG-017');
    expect(link.evidence.map(e => e.kind)).toEqual([
      'branch-name',
      'worktree-path',
      'session-title',
    ]);
  });

  it('leaves sessions with no signal unmapped', () => {
    expect(links({ title: 'shell', branch: 'master' })).toEqual([]);
  });
});
