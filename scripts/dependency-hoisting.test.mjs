import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Turbopack's dev server loads a handful of Next internals as EXTERNAL modules,
 * and it resolves them from the literal path rather than the realpath. Under
 * pnpm's strict layout that difference decides whether the dev server starts:
 *
 *   from node_modules/next/dist/build/adapter/setup-node-env.external.js
 *     -> '@swc/helpers/_/_interop_require_default'   MODULE_NOT_FOUND
 *   from .pnpm/next@.../node_modules/next/dist/.../the same file
 *     -> resolves
 *
 * Node follows the symlink to the realpath before walking up for
 * `node_modules`, so it lands inside `.pnpm/next@.../node_modules/` where
 * `@swc/helpers` is linked. A resolver that keeps the literal path walks up to
 * the top-level `node_modules/` instead, and in a strict install nothing is
 * hoisted there.
 *
 * Measured on a fresh public clone: 0 of 3 cold boots reached HTTP 200 without
 * the hoist, 3 of 3 with it. The README's first instruction is `pnpm dev`, so
 * this is the difference between a stranger seeing the product and seeing a
 * stack trace.
 *
 * This is the same dependency and the same week as BUG-036, which broke every
 * packaged build: `next` 16.3.1 brought `@swc/helpers` 0.5.23 and its
 * `module-sync` export condition. That fix taught the PACKAGED path to resolve
 * `@swc/helpers` explicitly; the dev path had no equivalent, so one bump left
 * two holes and only one was closed.
 *
 * The guard is the hoist itself rather than a dev-server boot: booting Next is
 * slow and flaky as a gate, while "is it reachable from the top level" is the
 * exact property the resolver needs and costs nothing.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const HOISTED = '@swc/helpers';

test('@swc/helpers is hoisted where a literal-path resolver will find it', () => {
  const hoisted = path.join(root, 'node_modules', HOISTED);
  assert.ok(
    existsSync(hoisted),
    `${HOISTED} is not at the top level of node_modules. Turbopack's ` +
      'external-module loader resolves from the literal path, so a strict ' +
      'install leaves the dev server unable to start. Restore ' +
      `\`public-hoist-pattern[]=${HOISTED}\` in .npmrc and reinstall.`
  );

  // The property the dev server actually needs: resolvable from the literal
  // (unfollowed) next directory, not merely present somewhere in the store.
  const literalNext = path.join(root, 'node_modules', 'next', 'package.json');
  if (!existsSync(literalNext)) return; // next not installed in this checkout
  assert.doesNotThrow(
    () => createRequire(literalNext).resolve(HOISTED),
    `${HOISTED} does not resolve from node_modules/next without following ` +
      'the symlink, which is exactly what breaks `pnpm dev` on a fresh clone'
  );
});

test('.npmrc keeps the hoist, so a reinstall reproduces it', async () => {
  const npmrc = await readFile(path.join(root, '.npmrc'), 'utf8');
  assert.match(
    npmrc,
    new RegExp(
      `^public-hoist-pattern\\[\\]=${HOISTED.replace('/', '\\/')}$`,
      'mu'
    ),
    'the hoist must be declared in .npmrc; a node_modules that happens to ' +
      'carry it today is not a fix, because the next install removes it'
  );
});
