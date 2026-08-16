/**
 * The ONE xterm link provider the pane registers (BUG-004).
 *
 * It joins a wrapped run of buffer rows into the logical line the operator
 * actually sees, hands that to `findTerminalTargets`, and maps the resulting
 * string offsets back to buffer cells. Both halves matter:
 *
 *  - unwrapping is why a long path near the right edge is clickable at all.
 *    The pane's previous provider read one row via `translateToString`, so a
 *    target that wrapped simply did not exist — the "it works sometimes" the
 *    2026-08-14 partner conversation reported.
 *  - back-mapping walks CELLS, not string indices, so a line containing wide
 *    (CJK) or combining characters still underlines the right columns.
 *
 * The wrapped-window and cell-walk algorithms are ported from xterm's
 * `@xterm/addon-web-links` `LinkComputer`, which solved them for URLs only
 * and kept them private. Owning them here is what let that addon — a second,
 * competing link owner over the same pixels — be deleted.
 */
import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findTerminalTargets, type TerminalTarget } from './terminal-targets';

export interface TerminalLinkHandlers {
  activate(target: TerminalTarget): void;
  hover(target: TerminalTarget): void;
  leave(target: TerminalTarget): void;
}

/** Stop expanding a wrapped run once it is this long; matches xterm. */
const MAX_WINDOW = 2048;

export function createTerminalLinkProvider(
  terminal: Terminal,
  handlers: TerminalLinkHandlers
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const [rows, topIndex] = windowedRows(terminal, bufferLineNumber - 1);
      if (rows.length === 0) {
        callback(undefined);
        return;
      }
      const line = rows.join('');
      const links: ILink[] = [];
      for (const match of findTerminalTargets(line)) {
        const [startY, startX] = mapStringIndex(terminal, topIndex, 0, match.start);
        if (startY === -1) continue;
        const [endY, endX] = mapStringIndex(
          terminal,
          startY,
          startX,
          match.end - match.start
        );
        if (endY === -1) continue;
        const target = match.target;
        links.push({
          // 1-based, right side INCLUDING — hence +1 except for endX
          range: {
            start: { x: startX + 1, y: startY + 1 },
            end: { x: endX, y: endY + 1 },
          },
          text: target.text,
          activate: () => handlers.activate(target),
          hover: () => handlers.hover(target),
          leave: () => handlers.leave(target),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

/**
 * Collect the wrapped run of rows containing `lineIndex` and return their
 * trimmed strings plus the index of the topmost row.
 */
function windowedRows(
  terminal: Terminal,
  lineIndex: number
): [string[], number] {
  const buffer = terminal.buffer.active;
  const current = buffer.getLine(lineIndex);
  if (!current) return [[], lineIndex];

  const rows: string[] = [];
  let topIndex = lineIndex;
  let bottomIndex = lineIndex;
  let line: IBufferLine | undefined;
  const currentContent = current.translateToString(true);

  if (current.isWrapped && currentContent[0] !== ' ') {
    let length = 0;
    while ((line = buffer.getLine(--topIndex)) && length < MAX_WINDOW) {
      const content = line.translateToString(true);
      length += content.length;
      rows.push(content);
      if (!line.isWrapped || content.includes(' ')) break;
    }
    rows.reverse();
  }
  rows.push(currentContent);

  let length = 0;
  while (
    (line = buffer.getLine(++bottomIndex)) &&
    line.isWrapped &&
    length < MAX_WINDOW
  ) {
    const content = line.translateToString(true);
    length += content.length;
    rows.push(content);
    if (content.includes(' ')) break;
  }
  return [rows, topIndex];
}

/**
 * Map a string offset within the joined window back to a buffer position.
 * Returns [-1, -1] when the walk leaves the buffer.
 */
function mapStringIndex(
  terminal: Terminal,
  lineIndex: number,
  cellIndex: number,
  stringIndex: number
): [number, number] {
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  let start = cellIndex;
  let remaining = stringIndex;
  while (remaining) {
    const line = buffer.getLine(lineIndex);
    if (!line) return [-1, -1];
    for (let i = start; i < line.length; i += 1) {
      line.getCell(i, cell);
      const chars = cell.getChars();
      if (cell.getWidth()) {
        remaining -= chars.length || 1;
        // A wide char pushed off the end of a row leaves an empty last cell
        // and reappears at column 0 of the wrapped row; correct for the
        // character the joined string counted only once.
        if (i === line.length - 1 && chars === '') {
          const next = buffer.getLine(lineIndex + 1);
          if (next?.isWrapped) {
            next.getCell(0, cell);
            if (cell.getWidth() === 2) remaining += 1;
          }
        }
      }
      if (remaining < 0) return [lineIndex, i];
    }
    lineIndex += 1;
    start = 0;
  }
  return [lineIndex, start];
}
