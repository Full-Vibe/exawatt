import { app, clipboard } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import type { ClipboardReadResult } from '@exawatt/core/desktop-bridge';

const temporaryImages = new Set<string>();

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Characters a POSIX shell, and an agent reading a prompt, take literally.
const SHELL_SAFE_PATH = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** The text a paste inserts for files: each path as is when it is shell-safe,
 * quoted when it is not, separated by spaces. Terminal and composer pastes
 * share it, so a path reads the same wherever it lands. */
export function pastedPathsText(paths: readonly string[]): string {
  return paths
    .map(file => (SHELL_SAFE_PATH.test(file) ? file : shellQuote(file)))
    .join(' ');
}

const XML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

function decodeXmlText(text: string): string {
  return text.replace(
    /&(?:(lt|gt|quot|apos|amp)|#(\d+)|#x([0-9a-f]+));/gi,
    (entity, name?: string, decimal?: string, hex?: string) => {
      if (name) return XML_ENTITIES[name];
      const code = decimal ? Number(decimal) : parseInt(hex ?? '', 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
  );
}

/** The strings of a binary property list whose top object is an array of
 * strings, as `NSFilenamesPboardType` holds when an app writes the list
 * itself. Anything else, or anything malformed, reads as no paths. */
function stringsFromBinaryPlist(data: Buffer): string[] {
  if (data.length < 40) return [];
  const trailer = data.length - 32;
  const offsetSize = data[trailer + 6];
  const refSize = data[trailer + 7];
  const objectCount = Number(data.readBigUInt64BE(trailer + 8));
  const top = Number(data.readBigUInt64BE(trailer + 16));
  const offsetTable = Number(data.readBigUInt64BE(trailer + 24));
  const sized = (at: number, size: number) => {
    if (size < 1 || size > 6 || at + size > trailer) throw new RangeError();
    return data.readUIntBE(at, size);
  };
  const objectAt = (index: number) => {
    if (index >= objectCount) throw new RangeError();
    return sized(offsetTable + index * offsetSize, offsetSize);
  };
  // a marker's low nibble is its length, or 0xF and an integer object after it
  const length = (at: number): [count: number, start: number] => {
    const info = data[at] & 0x0f;
    if (info !== 0x0f) return [info, at + 1];
    const intMarker = data[at + 1];
    if (intMarker >> 4 !== 0x1) throw new RangeError();
    const size = 1 << (intMarker & 0x0f);
    return [sized(at + 2, size), at + 2 + size];
  };
  const stringAt = (at: number) => {
    const type = data[at] >> 4;
    const [count, start] = length(at);
    if (type === 0x5) return data.toString('latin1', start, start + count);
    if (type === 0x6) {
      const utf16 = Buffer.from(data.subarray(start, start + count * 2));
      return utf16.swap16().toString('utf16le');
    }
    throw new RangeError();
  };
  try {
    const array = objectAt(top);
    if (data[array] >> 4 !== 0xa) return [];
    const [count, refs] = length(array);
    return Array.from({ length: count }, (_, index) =>
      stringAt(objectAt(sized(refs + index * refSize, refSize)))
    );
  } catch {
    return [];
  }
}

/** The paths in macOS's `NSFilenamesPboardType` property list: one string
 * per copied file. AppKit hands it over as XML when it builds the list from
 * the copied file URLs, as for a Finder copy; an app that writes the list
 * itself may store it in the binary format. */
export function pathsFromFilenamesPlist(plist: Buffer): string[] {
  if (plist.subarray(0, 8).toString('latin1') === 'bplist00') {
    return stringsFromBinaryPlist(plist);
  }
  return [
    ...plist.toString('utf8').matchAll(/<string>([\s\S]*?)<\/string>/g),
  ].map(match => decodeXmlText(match[1]));
}

/** A local path from a `file://` URL; nothing from any other URL, including a
 * file URL naming another host, which no local agent could open. */
function pathFromFileUrl(url: string): string | null {
  try {
    return url.startsWith('file://') ? fileURLToPath(url) : null;
  } catch {
    return null;
  }
}

/** Every file copied to the clipboard, as absolute paths. Finder puts each
 * file's URL on the pasteboard together with a picture of its icon; Electron
 * exposes the whole list as `NSFilenamesPboardType`, while `public.file-url`
 * carries only the first file. */
function clipboardFilePaths(): string[] {
  if (process.platform !== 'darwin') return [];
  const listed = pathsFromFilenamesPlist(
    clipboard.readBuffer('NSFilenamesPboardType')
  );
  if (listed.length) return listed;
  const file = pathFromFileUrl(clipboard.read('public.file-url'));
  return file ? [file] : [];
}

/** Text that only stands in for an image beside it: the address Safari copies
 * with an image, or the attachment character Notes and Pages copy in its
 * place. */
function textStandsInForImage(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^[\s\uFFFC]*$/.test(text) ||
    /^(?:https?|data|blob|file):\S*$/i.test(trimmed)
  );
}

/** What a paste inserts, read once in main for every paste in the app. The
 * clipboard often offers a stand-in for its content beside the content
 * itself, and the stand-in must never win (BUG-353):
 *  1. copied files paste as their paths; the image beside them is only
 *     Finder's icon;
 *  2. text pastes as is; an image beside it is a rendering of it, such as
 *     the table picture Excel or Word adds to copied cells. Text that is
 *     only the image's address or placeholder yields to the image;
 *  3. image data, such as a screenshot, saves to a private temp file whose
 *     path is pasted. */
export async function readClipboard(): Promise<ClipboardReadResult> {
  const files = clipboardFilePaths();
  if (files.length) return { kind: 'files', text: pastedPathsText(files) };
  const text = clipboard.readText();
  const image = clipboard.readImage();
  if (text && (image.isEmpty() || !textStandsInForImage(text))) {
    return { kind: 'text', text };
  }
  if (!image.isEmpty()) {
    const directory = path.join(app.getPath('temp'), 'exawatt-clipboard');
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${randomUUID()}.png`);
    await fs.promises.writeFile(file, image.toPNG(), { mode: 0o600 });
    temporaryImages.add(file);
    return { kind: 'image', text: pastedPathsText([file]) };
  }
  return text ? { kind: 'text', text } : { kind: 'empty', text: '' };
}

export function writeClipboardText(value: string): void {
  clipboard.writeText(value);
}

export async function cleanupClipboardImages(): Promise<void> {
  await Promise.all(
    [...temporaryImages].map(async file => {
      await fs.promises.rm(file, { force: true });
      temporaryImages.delete(file);
    })
  );
}
