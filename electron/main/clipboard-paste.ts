import { app, clipboard } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const temporaryImages = new Set<string>();

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function writeClipboardText(value: string): void {
  clipboard.writeText(value);
}

export async function clipboardInput(): Promise<{
  kind: 'image' | 'text' | 'empty';
  input: string;
  path?: string;
}> {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    const directory = path.join(app.getPath('temp'), 'exawatt-clipboard');
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `${randomUUID()}.png`);
    await fs.promises.writeFile(file, image.toPNG(), { mode: 0o600 });
    temporaryImages.add(file);
    return { kind: 'image', input: shellQuote(file), path: file };
  }
  const text = clipboard.readText();
  return text ? { kind: 'text', input: text } : { kind: 'empty', input: '' };
}

export async function cleanupClipboardImages(): Promise<void> {
  await Promise.all(
    [...temporaryImages].map(async file => {
      await fs.promises.rm(file, { force: true });
      temporaryImages.delete(file);
    })
  );
}
