import { describe, expect, it } from 'vitest';
import { transientAllocation } from '../cost.test-support';
import { transcriptLines } from './transcript-lines';

const ESC = '\x1b';

describe('transcriptLines (BUG-013)', () => {
  it('keeps plain output as written', () => {
    const { lines, truncated } = transcriptLines('one\ntwo\nthree\n');
    expect(lines).toEqual(['one', 'two', 'three']);
    expect(truncated).toBe(0);
  });

  // The defect in one test: a spinner redraws in place hundreds of times.
  // Treating \r as a newline (which the existing stripAnsi does, correctly
  // for its own purpose) turns that into hundreds of lines.
  it('collapses an in-place redraw to the line the operator saw', () => {
    let raw = '';
    for (let i = 1; i <= 200; i += 1) raw += `\r${ESC}[K⠋ working ${i}`;
    raw += '\r\x1b[Kdone in 4.2s\n';
    expect(transcriptLines(raw).lines).toEqual(['done in 4.2s']);
  });

  it('overwrites only the columns rewritten, exactly as a terminal does', () => {
    // a shorter status returning to column 0 does NOT truncate — the tail
    // survives until something erases it, which is why erase-in-line has to
    // be honoured rather than stripped
    expect(transcriptLines('loading......\rdone\n').lines).toEqual([
      'doneing......',
    ]);
    expect(transcriptLines('loading......\rdone\x1b[K\n').lines).toEqual([
      'done',
    ]);
  });

  it('moves the cursor on backspace, and erases only when told to', () => {
    // \b alone is a cursor move; \b \b is the erase idiom
    expect(transcriptLines('hello worldd\b\n').lines).toEqual([
      'hello worldd',
    ]);
    expect(transcriptLines('hello worldd\b \b\n').lines).toEqual([
      'hello world',
    ]);
  });

  it('erases the whole line on ESC[2K', () => {
    expect(transcriptLines('scratch\x1b[2Kkept\n').lines).toEqual(['kept']);
  });

  it('drops colour and cursor sequences without eating text', () => {
    const raw = `${ESC}[36mENG-016${ESC}[0m ${ESC}[1mD52${ESC}[0m ok\n`;
    expect(transcriptLines(raw).lines).toEqual(['ENG-016 D52 ok']);
  });

  it('drops OSC title sequences whole', () => {
    expect(transcriptLines(`${ESC}]0;a title\x07visible\n`).lines).toEqual([
      'visible',
    ]);
  });

  it('drops absolute cursor moves rather than simulating them', () => {
    // a TUI repositioning to draw a status bar: the text survives, the
    // positioning does not, which is the whole point of a transcript
    const raw = `${ESC}[2;1Hstatus${ESC}[H\ntop\n`;
    expect(transcriptLines(raw).lines).toEqual(['status', 'top']);
  });

  it('strips control bytes that would render as boxes', () => {
    expect(transcriptLines('clean\x00\x07text\n').lines).toEqual(['cleantext']);
  });

  it('normalises CRLF without turning it into a blank line', () => {
    expect(transcriptLines('a\r\nb\r\n').lines).toEqual(['a', 'b']);
  });

  it('collapses runs of blank lines to one', () => {
    expect(transcriptLines('a\n\n\n\n\nb\n').lines).toEqual(['a', '', 'b']);
  });

  it('does not end on a blank line the stream never had', () => {
    expect(transcriptLines('only\n').lines).toEqual(['only']);
    expect(transcriptLines('no trailing newline').lines).toEqual([
      'no trailing newline',
    ]);
  });

  it('keeps the END of a long transcript and reports what it dropped', () => {
    const raw = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const { lines, truncated } = transcriptLines(raw, { maxLines: 10 });
    expect(lines).toHaveLength(10);
    expect(lines[lines.length - 1]).toBe('line 499');
    expect(lines[0]).toBe('line 490');
    expect(truncated).toBe(490);
  });

  it('survives an empty stream', () => {
    expect(transcriptLines('')).toEqual({ lines: [], truncated: 0 });
  });

  it('renders a realistic harness turn without redraw noise', () => {
    const raw =
      `${ESC}[?25l` +
      `\r${ESC}[K${ESC}[36m⠋${ESC}[0m Thinking…` +
      `\r${ESC}[K${ESC}[36m⠙${ESC}[0m Thinking…` +
      `\r${ESC}[K${ESC}[32m✓${ESC}[0m Edited terminal-pane.tsx\n` +
      `${ESC}[?25h` +
      `  2 files changed\n`;
    expect(transcriptLines(raw).lines).toEqual([
      '✓ Edited terminal-pane.tsx',
      '  2 files changed',
    ]);
  });
});

// A transcript renderer that is itself slow would just move the incident.
// This is a floor, not a benchmark: it fails on an accidental O(n²), which is
// what rebuilding the remainder rather than reading it in place would be.
//
// It used to say that as "4 MB in under a second", which read the host's spare
// CPU as much as this function: the render costs ~600ms of a quiet machine, so
// four agent worktrees sharing twelve cores failed it on load alone (BUG-057).
// The property was never the second. It is that the work per character stays
// FLAT as the stream grows, and transient allocation states that directly and
// does not move with contention.
describe('transcriptLines cost', () => {
  function redrawHeavyStream(chars: number): string {
    let raw = '';
    while (raw.length < chars) {
      raw += `\r\x1b[K\x1b[36m⠋\x1b[0m working ${raw.length}`;
      if (raw.length % 7 < 40) raw += '\r\x1b[Kcommitted a line\n';
    }
    return raw;
  }

  /** Measured at ~30 bytes per character rendered, across an 8x size range.
   *  Doubled, so ordinary drift is silent and a growing per-character cost —
   *  the only shape a quadratic can take — is not. */
  const ALLOCATION_PER_CHARACTER = 64;

  it.each([250_000, 1_000_000])(
    'allocates in proportion to the %i characters it renders, not to their square',
    chars => {
      const raw = redrawHeavyStream(chars);
      const { value, bytes } = transientAllocation(() =>
        transcriptLines(raw, { maxLines: 2_000 })
      );
      expect(value.lines.length).toBeGreaterThan(0);
      // Asserted at both scales on purpose: a per-character ceiling that holds
      // at 250k and again at 1M is the statement that the ratio is constant.
      expect(bytes / raw.length).toBeLessThan(ALLOCATION_PER_CHARACTER);
    }
  );
});
