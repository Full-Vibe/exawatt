// Eval-harness preflights (ENG-022): the two silent killers of agent
// iteration — an unbuilt node-pty binding (bare "posix_spawnp failed."
// at every PTY spawn) and a dev server that serves a DIFFERENT checkout
// than the one under test — must fail loudly before any Electron launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNodePtyBuilt,
  nodePtyBindingPath,
} from './lib/native-preflight.mjs';
import { assertDevServerServesTree } from './lib/electron-eval.mjs';
import {
  assertNoPackagingSnapshot,
  discardRuntimeDependencies,
} from './lib/electron-runtime-deps.mjs';

const listen = handler =>
  new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    );
  });

test('a tree without the node-pty binding fails with the rebuild remedy, not posix_spawnp', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  assert.equal(nodePtyBindingPath(root), null);
  assert.throws(() => assertNodePtyBuilt(root), /worktree:setup|electron:rebuild/);
});

test('a built binding passes the preflight', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  const release = join(root, 'node_modules', 'node-pty', 'build', 'Release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'pty.node'), '');
  assert.ok(nodePtyBindingPath(root));
  assert.doesNotThrow(() => assertNodePtyBuilt(root));
});

test('a dev server serving the SAME tree passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ repoRoot: root }));
  });
  try {
    await assertDevServerServesTree(`${origin}/workspace`, realpathSync(root));
  } finally {
    server.close();
  }
});

test('a dev server serving ANOTHER tree is refused loudly', async () => {
  const served = mkdtempSync(join(tmpdir(), 'devid-served-'));
  const testing = mkdtempSync(join(tmpdir(), 'devid-testing-'));
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ repoRoot: served }));
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, testing),
      /WRONG TREE/
    );
  } finally {
    server.close();
  }
});

test('an identity-less server (older tree / prod) is tolerated with a warning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  try {
    await assertDevServerServesTree(`${origin}/workspace`, root);
  } finally {
    server.close();
  }
});

test('an UNHEALTHY server (stale deleted-worktree dev server 500s) is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen((_request, response) => {
    response.statusCode = 500;
    response.end();
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, root),
      /unhealthy/
    );
  } finally {
    server.close();
  }
});

test('no server answering fails fast with the start-a-dev-server remedy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen(() => {});
  server.close();
  await assert.rejects(
    assertDevServerServesTree(`${origin}/workspace`, root),
    /No dev server is answering/
  );
});

test('a non-URL dev target (packaged-app evals) is skipped', async () => {
  await assertDevServerServesTree('not a url', '/nowhere');
});

/* ------------------------------------------------------------------ */
/* BUG-016 — a packaging snapshot on the dev resolution path            */
/* ------------------------------------------------------------------ */

test('a dev tree carrying a packaging snapshot is refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'node_modules', '@exawatt', 'core'), {
    recursive: true,
  });
  await assert.rejects(
    () => assertNoPackagingSnapshot(root),
    /electron:compile/
  );
});

test('a dev tree with no snapshot resolves the workspace and passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'main'), { recursive: true });
  await assert.doesNotReject(() => assertNoPackagingSnapshot(root));
});

test('discarding is idempotent and leaves the compiled main alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'node_modules', 'node-pty'), {
    recursive: true,
  });
  mkdirSync(join(root, 'dist-electron', 'main'), { recursive: true });
  writeFileSync(join(root, 'dist-electron', 'main', 'main.js'), '');
  await discardRuntimeDependencies(root);
  await discardRuntimeDependencies(root);
  assert.equal(existsSync(join(root, 'dist-electron', 'node_modules')), false);
  assert.ok(existsSync(join(root, 'dist-electron', 'main', 'main.js')));
  await assert.doesNotReject(() => assertNoPackagingSnapshot(root));
});
