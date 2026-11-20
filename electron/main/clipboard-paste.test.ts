import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// This suite runs in Node, so importing the real `electron` package would run
// its installer shim: it reads `node_modules/electron/path.txt`, and when that
// file is briefly absent — which it is every time a sibling agent worktree
// re-links Electron — it tries to DOWNLOAD Electron and then throws "Electron
// failed to install correctly" (BUG-057). The double below carries only the
// surface `clipboard-paste.ts` touches, answering the way Electron 43 answered
// a probe of the real macOS pasteboard (BUG-353).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-clipboard-test-'));
const pasteboard = vi.hoisted(() => ({
  formats: {} as Record<string, string | Buffer>,
  image: null as Buffer | null,
  text: '',
}));
vi.mock('electron', () => ({
  app: { getPath: () => temp },
  clipboard: {
    // both answer empty for a format the pasteboard does not hold; `read`
    // decodes the bytes as UTF-8 whatever they are
    read: (format: string) => String(pasteboard.formats[format] ?? ''),
    readBuffer: (format: string) =>
      Buffer.from(pasteboard.formats[format] ?? ''),
    readImage: () => ({
      isEmpty: () => pasteboard.image === null,
      toPNG: () => pasteboard.image ?? Buffer.alloc(0),
    }),
    readText: () => pasteboard.text,
  },
}));

const {
  cleanupClipboardImages,
  pastedPathsText,
  pathsFromFilenamesPlist,
  readClipboard,
  shellQuote,
} = await import('./clipboard-paste');

const ICON = Buffer.from('finder-icon-png');

function filenamesPlist(paths: string[]): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<array>',
    ...paths.map(file => `\t<string>${escape(file)}</string>`),
    '</array>',
    '</plist>',
    '',
  ].join('\n');
}

/** A Finder copy: every file's URL, the first file's icon as image data, and
 * the names as text. Electron lists all the paths as NSFilenamesPboardType and
 * only the first as public.file-url. */
function finderCopy(paths: string[]) {
  pasteboard.formats = {
    NSFilenamesPboardType: filenamesPlist(paths),
    'public.file-url': `file://${encodeURI(paths[0])}`,
  };
  pasteboard.image = ICON;
  pasteboard.text = paths.map(file => path.basename(file)).join('\r');
}

const platform = process.platform;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  pasteboard.formats = {};
  pasteboard.image = null;
  pasteboard.text = '';
});
afterAll(async () => {
  Object.defineProperty(process, 'platform', { value: platform });
  await cleanupClipboardImages();
  fs.rmSync(temp, { recursive: true, force: true });
});

describe('shellQuote', () => {
  it('quotes image paths without permitting shell injection', () => {
    expect(shellQuote("/tmp/a user's; image.png")).toBe(
      "'/tmp/a user'\\''s; image.png'"
    );
  });
});

describe('pastedPathsText', () => {
  it('leaves shell-safe paths bare and quotes the rest', () => {
    expect(
      pastedPathsText([
        '/Users/user/Desktop/1 Auto.png',
        "/Users/user/Jake's pin.png",
        '/var/folders/T/exawatt-clipboard/1f2e.png',
        '/Users/user/$(touch pwned).png',
      ])
    ).toBe(
      "'/Users/user/Desktop/1 Auto.png' '/Users/user/Jake'\\''s pin.png' " +
        "/var/folders/T/exawatt-clipboard/1f2e.png '/Users/user/$(touch pwned).png'"
    );
  });
});

// `plutil -convert binary1` of an array of three paths: two ASCII strings
// around a UTF-16 one ("café"), each longer than a marker's inline length
const BINARY_FILE_LIST = Buffer.from(
  '62706c6973743030a30102035f101e2f55736572732f757365722f4465736b746f702f31' +
    '204175746f2e706e676f1021002f00550073006500720073002f00750073006500720' +
    '02f004400650073006b0074006f0070002f00630061006600e9002000310030003000' +
    '25002e0070006e00675f10232f55736572732f757365722f4465736b746f702f522644' +
    '2773206e6f7465732e747874080c2d7200000000000001010000000000000004000000' +
    '00000000000000000000000098',
  'hex'
);

describe('pathsFromFilenamesPlist', () => {
  it('reads every path and decodes XML escapes', () => {
    const paths = ['/a/R&D <draft>.png', '/b/café 100%.png', '/c/"q".txt'];
    expect(pathsFromFilenamesPlist(Buffer.from(filenamesPlist(paths)))).toEqual(
      paths
    );
    expect(
      pathsFromFilenamesPlist(
        Buffer.from(
          '<string>/x/&quot;a&apos;&amp;lt;&#9;&#x1F600;.txt</string>'
        )
      )
    ).toEqual(['/x/"a\'&lt;\t\u{1F600}.txt']);
  });

  it('reads the binary list an app writes itself', () => {
    expect(pathsFromFilenamesPlist(BINARY_FILE_LIST)).toEqual([
      '/Users/user/Desktop/1 Auto.png',
      '/Users/user/Desktop/café 100%.png',
      "/Users/user/Desktop/R&D's notes.txt",
    ]);
  });

  it('finds nothing in an empty, truncated or foreign list', () => {
    expect(pathsFromFilenamesPlist(Buffer.alloc(0))).toEqual([]);
    expect(pathsFromFilenamesPlist(BINARY_FILE_LIST.subarray(0, 60))).toEqual(
      []
    );
    const notAnArray = Buffer.from(BINARY_FILE_LIST);
    notAnArray[8] = 0x5f; // the top object becomes a string
    expect(pathsFromFilenamesPlist(notAnArray)).toEqual([]);
  });
});

describe('readClipboard', () => {
  it('pastes every file copied in Finder as its path, never its icon', async () => {
    finderCopy([
      '/Users/user/Desktop/3 Analyses.png',
      '/Users/user/Desktop/2 Pin.png',
      '/Users/user/Desktop/1 Auto.png',
    ]);
    await expect(readClipboard()).resolves.toEqual({
      kind: 'files',
      text:
        "'/Users/user/Desktop/3 Analyses.png' '/Users/user/Desktop/2 Pin.png' " +
        "'/Users/user/Desktop/1 Auto.png'",
    });
  });

  it('pastes every path from a binary list', async () => {
    pasteboard.formats = {
      NSFilenamesPboardType: BINARY_FILE_LIST,
      'public.file-url': 'file:///Users/user/Desktop/1%20Auto.png',
    };
    pasteboard.image = ICON;
    await expect(readClipboard()).resolves.toEqual({
      kind: 'files',
      text:
        "'/Users/user/Desktop/1 Auto.png' '/Users/user/Desktop/café 100%.png' " +
        "'/Users/user/Desktop/R&D'\\''s notes.txt'",
    });
  });

  it('falls back to the single file URL when no list is offered', async () => {
    pasteboard.formats = {
      'public.file-url': 'file:///Users/user/caf%C3%A9%20100%25.png',
    };
    pasteboard.image = ICON;
    await expect(readClipboard()).resolves.toEqual({
      kind: 'files',
      text: "'/Users/user/café 100%.png'",
    });
  });

  it('ignores a file URL naming another host', async () => {
    pasteboard.formats = { 'public.file-url': 'file://server/share/a.png' };
    pasteboard.text = 'a.png';
    await expect(readClipboard()).resolves.toEqual({
      kind: 'text',
      text: 'a.png',
    });
  });

  it('pastes text over the picture of it an app copies alongside', async () => {
    // Excel and Word put a rendering of copied cells beside their text
    pasteboard.text = 'Region\tRevenue\nWest\t42';
    pasteboard.image = Buffer.from('table-picture');
    await expect(readClipboard()).resolves.toEqual({
      kind: 'text',
      text: 'Region\tRevenue\nWest\t42',
    });
  });

  it('pastes the image when its text is only its address or placeholder', async () => {
    // Safari copies an image with its URL; Notes and Pages with U+FFFC
    for (const stand of ['https://example.com/cat.png', '\uFFFC', ' \n']) {
      pasteboard.text = stand;
      pasteboard.image = Buffer.from('copied-image');
      await expect(readClipboard()).resolves.toMatchObject({ kind: 'image' });
    }
    // the same address with no image beside it is the content
    pasteboard.text = 'https://example.com/cat.png';
    pasteboard.image = null;
    await expect(readClipboard()).resolves.toEqual({
      kind: 'text',
      text: 'https://example.com/cat.png',
    });
  });

  it('saves image data with no file behind it to a private temp file', async () => {
    pasteboard.image = Buffer.from('screenshot-png');
    const result = await readClipboard();
    expect(result.kind).toBe('image');
    expect(result.text).toMatch(
      new RegExp(`^${temp}/exawatt-clipboard/[0-9a-f-]+\\.png$`)
    );
    expect(fs.readFileSync(result.text, 'utf8')).toBe('screenshot-png');
    expect(fs.statSync(result.text).mode & 0o777).toBe(0o600);
  });

  it('pastes text as is, and nothing from an empty clipboard', async () => {
    pasteboard.text = "echo 'hi'";
    await expect(readClipboard()).resolves.toEqual({
      kind: 'text',
      text: "echo 'hi'",
    });
    pasteboard.text = '';
    await expect(readClipboard()).resolves.toEqual({ kind: 'empty', text: '' });
  });

  it('reads no file list off macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    finderCopy(['/home/me/a.png']);
    await expect(readClipboard()).resolves.toEqual({
      kind: 'text',
      text: 'a.png',
    });
  });
});
