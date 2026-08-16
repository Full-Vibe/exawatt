import { describe, expect, it } from 'vitest';
import {
  findTerminalTargets,
  terminalTargetCopyText,
  terminalTargetCopyVerb,
  terminalTargetFromUri,
  terminalTargetLabel,
} from './terminal-targets';

const kinds = (line: string) =>
  findTerminalTargets(line).map(match => match.target);

describe('findTerminalTargets', () => {
  it('finds absolute, relative, and home paths with their location', () => {
    expect(
      kinds('open /tmp/report.md:12:4 then ./src/app.tsx:8 and ~/notes.txt')
    ).toMatchObject([
      { kind: 'path', path: '/tmp/report.md', line: 12, column: 4 },
      { kind: 'path', path: './src/app.tsx', line: 8 },
      { kind: 'path', path: '~/notes.txt' },
    ]);
  });

  it('recognises the bare repo-relative path Agents print most often', () => {
    expect(
      kinds('Updated src/components/workspace/terminal-pane.tsx:186')
    ).toMatchObject([
      {
        kind: 'path',
        path: 'src/components/workspace/terminal-pane.tsx',
        line: 186,
      },
    ]);
  });

  it('classifies a web URL as a url target, never as a path', () => {
    expect(kinds('see https://example.com/docs')).toEqual([
      {
        kind: 'url',
        text: 'https://example.com/docs',
        url: 'https://example.com/docs',
      },
    ]);
  });

  // The regression that made links "work sometimes": xterm asks link
  // providers in registration order and DROPS a lower-priority provider's
  // links on any line a higher one claimed. With a URL addon above a path
  // provider, every line that mentioned a URL lost its paths.
  it('returns BOTH a url and a path from one line', () => {
    expect(kinds('docs at https://exawatt.ai/guide and ./README.md')).toMatchObject([
      { kind: 'url' },
      { kind: 'path', path: './README.md' },
    ]);
  });

  it('reports offsets into the supplied line', () => {
    const [match] = findTerminalTargets('  -> /tmp/a.txt <-');
    expect(match).toMatchObject({ start: 5, end: 15 });
    expect('  -> /tmp/a.txt <-'.slice(5, 15)).toBe('/tmp/a.txt');
  });

  it('strips surrounding brackets and sentence punctuation', () => {
    expect(kinds('(see /tmp/a.txt), or /tmp/b.txt.')).toMatchObject([
      { path: '/tmp/a.txt' },
      { path: '/tmp/b.txt' },
    ]);
  });

  it('does not turn prose, ratios, or bare hosts into paths', () => {
    expect(kinds('runs 24/7 and/or nightly, see example.com/docs')).toEqual([]);
  });

  it('ignores protocol-relative and unsupported schemes', () => {
    expect(kinds('//cdn.example.com/a.js vscode://file/tmp/a.ts')).toEqual([]);
  });
});

describe('terminalTargetFromUri', () => {
  it('turns an OSC 8 file hyperlink into the same path vocabulary', () => {
    expect(terminalTargetFromUri('file:///tmp/a%20b.txt#L12')).toMatchObject({
      kind: 'path',
      path: '/tmp/a b.txt',
      line: 12,
    });
  });

  it('accepts http(s) and refuses anything Exawatt will not open', () => {
    expect(terminalTargetFromUri('https://exawatt.ai')).toMatchObject({
      kind: 'url',
    });
    expect(terminalTargetFromUri('javascript:alert(1)')).toBeNull();
    expect(terminalTargetFromUri('not a uri')).toBeNull();
  });
});

describe('operator-facing vocabulary', () => {
  it('names a target the way the operator saw it', () => {
    const [path] = kinds('/tmp/a.txt:9');
    const [url] = kinds('https://exawatt.ai/x');
    expect(terminalTargetLabel(path!)).toBe('/tmp/a.txt:9');
    expect(terminalTargetCopyText(path!)).toBe('/tmp/a.txt:9');
    expect(terminalTargetCopyVerb(path!)).toBe('Copy Path');
    expect(terminalTargetCopyVerb(url!)).toBe('Copy Link');
  });
});
