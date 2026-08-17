import { describe, expect, it } from 'vitest';
import { transientAllocation } from '../cost.test-support';
import { TranscriptWindow } from './transcript-window';

/** The string representation this replaced, kept as the oracle for parity. */
function stringWindow(limit: number) {
  let text = '';
  let end = 0;
  return {
    append(data: string) {
      end += data.length;
      text += data;
      if (text.length > limit) {
        text = text.slice(-limit);
        const newline = text.indexOf('\n');
        if (newline !== -1 && newline < 4096) text = text.slice(newline + 1);
      }
    },
    get text() {
      return text;
    },
    get end() {
      return end;
    },
    get start() {
      return end - text.length;
    },
  };
}

describe('TranscriptWindow', () => {
  it('matches the string representation it replaced, trim for trim', () => {
    const window = new TranscriptWindow(120);
    const oracle = stringWindow(120);
    const chunks = [
      'first line\n',
      'a redraw\r',
      '\x1b[Kspinner frame ',
      'and a committed line that is long enough to push past the limit\n',
      'short\n',
      'x'.repeat(200),
      '\ntail\n',
    ];
    for (const chunk of chunks) {
      window.append(chunk);
      oracle.append(chunk);
      expect(window.text()).toBe(oracle.text);
      expect(window.cursor).toBe(oracle.end);
      expect(window.start).toBe(oracle.start);
      expect(window.length).toBe(oracle.text.length);
    }
  });

  it('seeds retained text at an absolute cursor', () => {
    const window = new TranscriptWindow(10);
    window.seed('retained', 1_000);
    expect(window.text()).toBe('retained');
    expect(window.cursor).toBe(1_000);
    expect(window.start).toBe(992);
  });

  it('reads ranges, tails and post-checkpoint deltas without joining', () => {
    const window = new TranscriptWindow(1_000);
    window.append('alpha ');
    const checkpoint = window.cursor;
    window.append('beta ');
    window.append('gamma');

    expect(window.range(checkpoint, 4)).toBe('beta');
    expect(window.range(0, 5)).toBe('alpha');
    expect(window.tail(5)).toBe('gamma');
    expect(window.since(checkpoint)).toEqual({
      text: 'beta gamma',
      truncated: false,
    });
    expect(window.since(window.cursor)).toEqual({
      text: '',
      truncated: false,
    });
  });

  it('reports a checkpoint that fell out of the retained window', () => {
    const window = new TranscriptWindow(12);
    window.append('old line\n');
    const checkpoint = window.cursor;
    window.append('new one\nnew two\n');
    expect(window.since(checkpoint)).toEqual({
      text: 'new two\n',
      truncated: true,
    });
  });

  it('trims to an exact retained length for journal replay', () => {
    const window = new TranscriptWindow(Number.POSITIVE_INFINITY);
    window.append('0123456789');
    window.trimTo(4);
    expect(window.text()).toBe('6789');
    expect(window.cursor).toBe(10);
    expect(window.length).toBe(4);
    window.append('abc');
    window.trimTo(4);
    expect(window.text()).toBe('9abc');
  });

  it('appends at a cost proportional to the delta, not the window', () => {
    const limit = 2_000_000;
    const window = new TranscriptWindow(limit);
    window.seed('y'.repeat(limit));
    const { bytes } = transientAllocation(() => {
      for (let index = 0; index < 20_000; index += 1) window.append('delta ');
    });
    expect(window.length).toBe(limit);
    // The string representation copied the full window on every append once it
    // was saturated: 20,000 x 2,000,000 characters, ~40 GB of garbage and tens
    // of seconds. The deque touches one chunk boundary per append, so it
    // produces a few times the window and no more however many appends land.
    // Stated as bytes rather than as the second it used to be measured in:
    // wall clock here read the host's contention, not this class (BUG-057).
    expect(bytes).toBeLessThan(limit * 2 * 100);
  });
});
