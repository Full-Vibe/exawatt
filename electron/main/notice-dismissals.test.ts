import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { createNoticeDismissalStore } from './notice-dismissals';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-notices-'));
  roots.push(root);
  const sent: unknown[][] = [];
  const window = {
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => sent.push(args) },
  };
  const file = path.join(root, 'notice-dismissals.json');
  const open = () =>
    createNoticeDismissalStore({ file, allWindows: () => [window] });
  return { file, sent, open };
}

const event = {} as IpcMainInvokeEvent;

describe('notice dismissals', () => {
  it('remembers a dismissal across launches and tells every window', () => {
    const { sent, open } = fixture();
    open().dismiss('local-build-installed', 'running-sha');
    expect(sent.at(-1)).toEqual([
      'app:notice-dismissals-changed',
      { 'local-build-installed': 'running-sha' },
    ]);
    expect(open().current()).toEqual({
      'local-build-installed': 'running-sha',
    });
  });

  it('keeps one version per notice', () => {
    const { open } = fixture();
    const store = open();
    store.dismiss('product-update:ready', '1.1.0');
    store.dismiss('product-update:ready', '1.2.0');
    expect(store.current()).toEqual({ 'product-update:ready': '1.2.0' });
  });

  it('forgets a family of notices when the operator asks for them again', () => {
    const { open } = fixture();
    const store = open();
    store.dismiss('product-update:ready', '1.1.0');
    store.dismiss('local-build-installed', 'sha');
    store.forget('product-update:');
    expect(open().current()).toEqual({ 'local-build-installed': 'sha' });
  });

  it('refuses a malformed dismissal from the renderer', async () => {
    const { open } = fixture();
    const store = open();
    const dismiss = store.channels['app:dismiss-notice']!;
    await dismiss(event, '' as string, 'x');
    await dismiss(event, 'id', 42 as unknown as string);
    expect(store.current()).toEqual({});
  });

  it('never writes over a dismissal file it cannot read', () => {
    const { file, open } = fixture();
    fs.mkdirSync(file);
    const store = open();
    store.dismiss('local-build-installed', 'sha');
    expect(store.current()).toEqual({ 'local-build-installed': 'sha' });
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });

  // Review of 0.1.22: the store re-read the file once it became readable
  // and replaced what the operator had dismissed meanwhile.
  it('keeps what was dismissed while the file was unreadable once it can be read', () => {
    const { file, open } = fixture();
    fs.mkdirSync(file);
    const store = open();
    store.dismiss('local-build-installed', 'running-sha');
    store.dismiss('product-update:ready', '1.2.0');
    store.forget('product-update:');

    fs.rmSync(file, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        dismissed: {
          'local-build-installed': 'older-sha',
          'product-update:available': '1.1.0',
          'account-first-run': '1',
        },
      })
    );
    store.dismiss('product-update:error', '1.2.0');

    const expected = {
      'account-first-run': '1',
      'local-build-installed': 'running-sha',
      'product-update:error': '1.2.0',
    };
    expect(store.current()).toEqual(expected);
    expect(open().current()).toEqual(expected);
  });
});
