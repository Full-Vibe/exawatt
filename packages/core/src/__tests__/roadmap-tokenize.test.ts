import { describe, expect, it } from 'vitest';
import {
  hasDoneMarker,
  hasRetiredMarker,
  milestoneId,
  splitItemHeading,
  statusWord,
  tokenizeRoadmapLine,
} from '../roadmap/tokenize';

// The tokenizer reproduces what the replaced regexes captured (BUG-128),
// including the edges a roadmap author can reach by accident.
describe('tokenizeRoadmapLine', () => {
  it('reads headings by their marker and trims the heading text', () => {
    expect(tokenizeRoadmapLine('##  Now \t')).toEqual({
      kind: 'section',
      heading: 'Now',
    });
    expect(tokenizeRoadmapLine('### ENG-1 Thing')).toEqual({
      kind: 'item',
      heading: 'ENG-1 Thing',
    });
    expect(tokenizeRoadmapLine('#### Deeper').kind).toBe('prose');
    expect(tokenizeRoadmapLine('##Now').kind).toBe('prose');
  });

  it('keeps a marker followed only by whitespace a heading with a blank name', () => {
    expect(tokenizeRoadmapLine('##  ')).toEqual({
      kind: 'section',
      heading: ' ',
    });
    expect(tokenizeRoadmapLine('## ').kind).toBe('prose');
  });

  it('refuses heading text that a line terminator interrupts', () => {
    expect(tokenizeRoadmapLine('## Now\rlater').kind).toBe('prose');
    expect(tokenizeRoadmapLine('## Now \r')).toEqual({
      kind: 'section',
      heading: 'Now',
    });
  });

  it('reads Status, labels and bullets from the trimmed line', () => {
    expect(tokenizeRoadmapLine('  STATUS:  done.  ')).toEqual({
      kind: 'status',
      text: 'STATUS:  done.',
      note: 'done.',
    });
    expect(tokenizeRoadmapLine('Status:').kind).toBe('prose');
    expect(tokenizeRoadmapLine('\u017ftatus: done').kind).toBe('prose');
    expect(tokenizeRoadmapLine('Exit Criteria:')).toEqual({
      kind: 'label',
      text: 'Exit Criteria:',
      label: 'exitCriteria',
    });
    expect(tokenizeRoadmapLine('Scope: inline').kind).toBe('prose');
    expect(tokenizeRoadmapLine('*   wide')).toEqual({
      kind: 'bullet',
      text: '*   wide',
      bullet: 'wide',
    });
    expect(tokenizeRoadmapLine('-no-space').kind).toBe('prose');
    expect(tokenizeRoadmapLine(' \u00a0 ').kind).toBe('blank');
  });
});

describe('roadmap field readers', () => {
  it('splits an item id from its title only across whitespace', () => {
    expect(splitItemHeading('ENG-016 Daily driver')).toEqual({
      id: 'ENG-016',
      title: 'Daily driver',
    });
    expect(splitItemHeading('ENG-016: Daily driver')).toBeNull();
    expect(splitItemHeading('eng-016 Daily driver')).toBeNull();
  });

  it('alert #7 (item id): a long gap before a broken title is no split', () => {
    expect(splitItemHeading(`A-0 ${'  '.repeat(100_000)}a\rb`)).toBeNull();
  });

  it('reads the status word without trailing punctuation', () => {
    expect(statusWord('Done,; — next')).toBe('done');
    expect(statusWord('active-build')).toBe('active-build');
  });

  it('reads milestone ids the way the dotted grammar did', () => {
    expect(milestoneId('W0.5: Spatial')).toEqual({ id: 'W0.5', length: 6 });
    expect(milestoneId('D1.2x later')).toEqual({ id: 'D1', length: 2 });
    expect(milestoneId('D1x')).toBeNull();
    expect(milestoneId('ABCDE1 too long')).toBeNull();
  });

  it('reads parenthesized done and retired markers, closed', () => {
    expect(hasDoneMarker('D0 Baseline (Landed 2026-07-10)')).toBe(true);
    expect(hasDoneMarker('D7 (activation-gated; implementation landed)')).toBe(
      false
    );
    expect(hasDoneMarker('D1 (landed')).toBe(false);
    expect(hasRetiredMarker('D2 (cut) later')).toBe(true);
    expect(hasRetiredMarker('D2 )(cut')).toBe(false);
  });
});
