import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No notification path may post without asking the permission registry first
 * (ENG-045). Electron raises macOS's notification prompt as a side effect of
 * the first `Notification.show()`, so one stray `new Notification` is a path
 * on which the system prompt can appear before the primer. The behavior of
 * the one allowed path is `native-notification.test.ts`; this is the guard
 * that there is only one.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_ROOTS = ['electron', 'src', 'packages', 'scripts'];
const SKIPPED = new Set(['node_modules', 'dist', 'dist-cjs', 'generated']);
const THE_ONE_PATH = 'electron/main/permissions/runtime.ts';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    if (SKIPPED.has(name)) return [];
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) &&
      !/\.test(?:-support)?\.[cm]?[jt]sx?$/.test(name)
      ? [full]
      : [];
  });
}

const FILES = SOURCE_ROOTS.flatMap(dir =>
  sourceFiles(path.join(ROOT, dir))
).map(file => ({
  path: path.relative(ROOT, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/** Files whose text matches, minus the one place allowed to. */
function offenders(pattern: RegExp): string[] {
  return FILES.filter(file => pattern.test(file.text))
    .map(file => file.path)
    .filter(file => file !== THE_ONE_PATH);
}

describe('notification paths', () => {
  it('scans the product source, so a refactor cannot make it vacuous', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some(file => file.path === THE_ONE_PATH)).toBe(true);
  });

  it('builds a native notification in exactly one place', () => {
    const builders = FILES.filter(file =>
      /new\s+Notification\s*\(/.test(file.text)
    );
    expect(builders.map(file => file.path)).toEqual([THE_ONE_PATH]);
  });

  it('imports Electron’s Notification in exactly one place', () => {
    expect(
      offenders(
        /import\s*\{[^}]*\bNotification\b[^}]*\}\s*from\s*['"]electron['"]/
      )
    ).toEqual([]);
  });

  it('never asks the web Notification API for permission', () => {
    expect(offenders(/Notification\s*\.\s*requestPermission/)).toEqual([]);
  });

  it('posts that one notification only through the registry-checked notifier', () => {
    const runtime = FILES.find(file => file.path === THE_ONE_PATH)!.text;
    expect(runtime).toMatch(/createNativeNotifier\(/);
    // The construction sits inside the notifier's `create`, never beside it.
    const construction = runtime.indexOf('new Notification(');
    expect(construction).toBeGreaterThan(
      runtime.indexOf('createNativeNotifier(')
    );
  });

  it('routes every caller through postNativeNotification', () => {
    const callers = FILES.filter(file =>
      /\bpostNativeNotification\s*\(/.test(file.text)
    ).map(file => file.path);
    expect(callers).toEqual(
      expect.arrayContaining([
        'electron/main/pty-ipc.ts',
        'electron/main/unreadable-state-notice.ts',
      ])
    );
  });
});
