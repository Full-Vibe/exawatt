/**
 * A paused Agent's transcript, as readable lines (ENG-016 BUG-013).
 *
 * The saved history is a raw terminal byte stream. Replaying it into a
 * terminal is what produced the operator's garbage: the bytes carry absolute
 * cursor moves and in-place redraws issued at the width the session ran at,
 * so at any other width the lines land on top of each other. The fix is not a
 * better replay — the operator's own answer was that a paused Agent should
 * read as a record, so this renders the stream to plain text ONCE and the
 * width stops mattering.
 *
 * `stripAnsi` in `context-summarizer` cannot be reused: it maps `\r` to a
 * newline, which is right for prose extraction and wrong here — every
 * spinner frame would become its own line, and a minute of "working…" would
 * bury the transcript. Here `\r` means what the terminal means by it: return
 * to column zero, and subsequent text OVERWRITES. That single difference is
 * what collapses ten thousand redraw frames back into the one line the
 * operator actually saw.
 *
 * Deliberately NOT a terminal emulator. Absolute cursor positioning, scroll
 * regions, and alternate screens are dropped rather than simulated: a
 * transcript is a record of what was written, and anything that needs true
 * cursor addressing is a live terminal's job.
 */

/** Matched at a cursor position, not globally: erase-in-line has to be
 *  HONOURED rather than stripped, and that only works in sequence order. */
// Sticky, and matched against the ORIGINAL string at an offset. Slicing the
// remainder at every escape byte would be O(n²) on exactly the megabyte
// transcripts this exists to make cheap.
const CSI_AT = /\x1b\[([0-9;?>=<]*)([a-zA-Z])/y;
const OSC_AT = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
const CHARSET_AT = /\x1b[()][A-Z0-9]/y;
/** C0 controls that would otherwise render as boxes. */
const DROP_C0 = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

interface LineState {
  text: string;
  column: number;
}

function write(state: LineState, char: string): void {
  const { text, column } = state;
  state.text =
    column === text.length
      ? text + char
      : text.slice(0, column) + char + text.slice(column + 1);
  state.column = column + 1;
}

/**
 * Erase-in-line. This is the sequence that makes a redraw readable: a
 * harness returns to column zero, erases what it wrote, and writes the next
 * frame. Strip it and every frame leaves its tail behind, which is how
 * "done in 4.2s" comes out as "done in 4.2s0".
 */
function eraseInLine(state: LineState, mode: string): void {
  if (mode === '' || mode === '0') {
    state.text = state.text.slice(0, state.column);
    return;
  }
  if (mode === '1') {
    state.text =
      ' '.repeat(Math.min(state.column, state.text.length)) +
      state.text.slice(state.column);
    return;
  }
  if (mode === '2') state.text = '';
}

export interface TranscriptLines {
  lines: string[];
  /** lines dropped from the head because `maxLines` was reached */
  truncated: number;
}

/**
 * Render raw terminal bytes to readable lines, keeping at most `maxLines`
 * from the END — a transcript is read backwards from where the Agent
 * stopped, and an unbounded return value is how a "read the history" feature
 * becomes the next performance incident.
 */
export function transcriptLines(
  raw: string,
  { maxLines = 2_000 }: { maxLines?: number } = {}
): TranscriptLines {
  const lines: string[] = [];
  let dropped = 0;
  const state: LineState = { text: '', column: 0 };

  const commit = () => {
    lines.push(state.text.replace(/\s+$/, ''));
    if (lines.length > maxLines) {
      lines.shift();
      dropped += 1;
    }
    state.text = '';
    state.column = 0;
  };

  for (let i = 0; i < raw.length; ) {
    const char = raw[i];

    if (char === '\x1b') {
      CSI_AT.lastIndex = i;
      const csi = CSI_AT.exec(raw);
      if (csi) {
        if (csi[2] === 'K') eraseInLine(state, csi[1]);
        i = CSI_AT.lastIndex;
        continue;
      }
      OSC_AT.lastIndex = i;
      if (OSC_AT.exec(raw)) {
        i = OSC_AT.lastIndex;
        continue;
      }
      CHARSET_AT.lastIndex = i;
      if (CHARSET_AT.exec(raw)) {
        i = CHARSET_AT.lastIndex;
        continue;
      }
      i += 2; // an escape we do not model: drop it and its intro byte
      continue;
    }

    if (char === '\n') {
      commit();
      i += 1;
      continue;
    }
    if (char === '\r') {
      state.column = 0;
      i += 1;
      continue;
    }
    if (char === '\b') {
      state.column = Math.max(0, state.column - 1);
      i += 1;
      continue;
    }
    if (DROP_C0.test(char)) {
      i += 1;
      continue;
    }
    write(state, char);
    i += 1;
  }
  if (state.text !== '') commit();

  // Collapse runs of blank lines: redraw-heavy harnesses leave long gaps
  // that are noise in a record, never signal.
  const collapsed: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line === '') {
      blanks += 1;
      if (blanks > 1) continue;
    } else {
      blanks = 0;
    }
    collapsed.push(line);
  }

  return { lines: collapsed, truncated: dropped };
}
