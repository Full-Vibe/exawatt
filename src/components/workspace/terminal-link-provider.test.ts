import { describe, expect, it, vi } from 'vitest';
import type { ILink, Terminal } from '@xterm/xterm';
import { createTerminalLinkProvider } from './terminal-link-provider';
import type { TerminalTarget } from './terminal-targets';

interface Row {
  text: string;
  wrapped?: boolean;
}

/** Minimal xterm buffer double: fixed-width rows, one cell per character. */
function fakeTerminal(rows: Row[], cols: number): Terminal {
  const lines = rows.map(row => {
    const chars = [...row.text.padEnd(cols, ' ')].slice(0, cols);
    return {
      isWrapped: row.wrapped ?? false,
      length: cols,
      translateToString: (trim?: boolean) =>
        trim ? chars.join('').replace(/\s+$/, '') : chars.join(''),
      getCell: (index: number, cell: { chars: string; width: number }) => {
        cell.chars = chars[index] ?? '';
        cell.width = 1;
      },
    };
  });
  const cell = {
    chars: '',
    width: 1,
    getChars() {
      return cell.chars;
    },
    getWidth() {
      return cell.width;
    },
  };
  return {
    buffer: {
      active: {
        getLine: (index: number) => lines[index],
        getNullCell: () => cell,
      },
    },
  } as unknown as Terminal;
}

function linksOn(terminal: Terminal, bufferLine: number): ILink[] {
  const activate = vi.fn();
  const provider = createTerminalLinkProvider(terminal, {
    activate,
    hover: () => undefined,
    leave: () => undefined,
  });
  let result: ILink[] | undefined;
  provider.provideLinks(bufferLine, links => {
    result = links;
  });
  return result ?? [];
}

describe('createTerminalLinkProvider', () => {
  it('links a path that the terminal wrapped across two rows', () => {
    // 20 columns; the path starts on row 0 and finishes on the wrapped row 1
    const terminal = fakeTerminal(
      [
        { text: 'open /var/tmp/report' },
        { text: '.md:12 now', wrapped: true },
      ],
      20
    );
    const links = linksOn(terminal, 1);
    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe('/var/tmp/report.md:12');
    // 1-based, right side including
    expect(links[0]!.range).toEqual({
      start: { x: 6, y: 1 },
      end: { x: 6, y: 2 },
    });
  });

  it('offers the same link from either row of the wrapped run', () => {
    const terminal = fakeTerminal(
      [
        { text: 'open /var/tmp/report' },
        { text: '.md:12 now', wrapped: true },
      ],
      20
    );
    expect(linksOn(terminal, 2)[0]?.text).toBe('/var/tmp/report.md:12');
  });

  it('links a url and a path on the same row', () => {
    const terminal = fakeTerminal(
      [{ text: 'https://exawatt.ai ./a.md' }],
      40
    );
    expect(linksOn(terminal, 1).map(link => link.text)).toEqual([
      'https://exawatt.ai',
      './a.md',
    ]);
  });

  it('reports no links rather than an empty list on a bare line', () => {
    const terminal = fakeTerminal([{ text: 'nothing to see here' }], 40);
    const provider = createTerminalLinkProvider(terminal, {
      activate: () => undefined,
      hover: () => undefined,
      leave: () => undefined,
    });
    const callback = vi.fn();
    provider.provideLinks(1, callback);
    expect(callback).toHaveBeenCalledWith(undefined);
  });

  it('activates with the recognised target, not raw text', () => {
    const terminal = fakeTerminal([{ text: 'edit ./src/a.ts:4:2' }], 40);
    const activated: TerminalTarget[] = [];
    const provider = createTerminalLinkProvider(terminal, {
      activate: target => activated.push(target),
      hover: () => undefined,
      leave: () => undefined,
    });
    let links: ILink[] | undefined;
    provider.provideLinks(1, result => {
      links = result;
    });
    links![0]!.activate({} as MouseEvent, links![0]!.text);
    expect(activated).toMatchObject([
      { kind: 'path', path: './src/a.ts', line: 4, column: 2 },
    ]);
  });
});
