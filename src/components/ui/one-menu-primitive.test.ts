/**
 * Decision `0033`: one menu primitive. `src/components/ui/option-menu.tsx`
 * is the only module allowed to render `role="menu"` or `role="menuitem"`;
 * every context menu, dropdown and action list in `src/` is one of its two
 * faces. The terminal pane and the Project ribbon each hand-rolled a menu
 * before (BUG-052), with three different keyboard grammars between them.
 *
 * By reflection over the source rather than by an enumerated list, so the
 * next hand-rolled menu fails the build instead of a review. The same shape
 * as `session-scope.test.tsx`'s declaration guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(process.cwd(), 'src');
const PRIMITIVE = path.join(ROOT, 'components', 'ui', 'option-menu.tsx');

/** A JSX or object role of `menu`/`menuitem`. Excludes CSS selectors such as
 *  `[role="menuitem"]`, which query the primitive rather than render one. */
const RENDERED_MENU_ROLE = /(?<![[\w-])role\s*[=:]\s*["'](menu|menuitem)["']/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(tsx?|mts|cts)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    files.push(full);
  }
  return files;
}

describe('one menu primitive', () => {
  it('renders role="menu" nowhere but option-menu.tsx', () => {
    const offenders = sourceFiles(ROOT)
      .filter(file => file !== PRIMITIVE)
      .filter(file => RENDERED_MENU_ROLE.test(readFileSync(file, 'utf8')))
      .map(file => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it('still renders one in the primitive, so the guard is live', () => {
    expect(RENDERED_MENU_ROLE.test(readFileSync(PRIMITIVE, 'utf8'))).toBe(true);
  });
});
