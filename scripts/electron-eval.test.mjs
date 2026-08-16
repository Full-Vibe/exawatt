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
  readFileSync,
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
  RUNTIME_PACKAGES,
  assertNoPackagingSnapshot,
  discardRuntimeDependencies,
  isRuntimePayloadPath,
  packagesAlongPath,
  resolveRuntimeClosure,
} from './lib/electron-runtime-deps.mjs';

const listen = handler =>
  new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    );
  });

const DISTRIBUTION_DIGEST = 'a'.repeat(64);

function prepareDistributionIdentity(root, digest = DISTRIBUTION_DIGEST) {
  const directory = join(root, '.exawatt-build');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'distribution.sha256'), `${digest}\n`);
}

test('a tree without the node-pty binding fails with the rebuild remedy, not posix_spawnp', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  assert.equal(nodePtyBindingPath(root), null);
  assert.throws(
    () => assertNodePtyBuilt(root),
    /worktree:setup|electron:rebuild/
  );
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
  prepareDistributionIdentity(root);
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        repoRoot: root,
        distributionDigest: DISTRIBUTION_DIGEST,
      })
    );
  });
  try {
    await assertDevServerServesTree(`${origin}/workspace`, realpathSync(root));
  } finally {
    server.close();
  }
});

test('a dev server serving another distribution is refused loudly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  prepareDistributionIdentity(root);
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ repoRoot: root, distributionDigest: 'b'.repeat(64) })
    );
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, root),
      /WRONG DISTRIBUTION/
    );
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

/* ------------------------------------------------------------------ */
/* BUG-030 — what the packaging snapshot is allowed to contain          */
/* ------------------------------------------------------------------ */

test('a nested node_modules is never runtime payload, at any depth', () => {
  // How the TypeScript compiler and vitest reached users: the snapshot was a
  // dereferencing copy, and pnpm links devDependencies here.
  assert.equal(isRuntimePayloadPath('node_modules'), false);
  assert.equal(isRuntimePayloadPath('node_modules/typescript/bin/tsc'), false);
  assert.equal(isRuntimePayloadPath('node_modules/.bin/tsc'), false);
  // node-gyp writes build stamps under a nested path of the same shape.
  assert.equal(
    isRuntimePayloadPath('build/Release/node-addon-api@7.1.1/node_modules/x.stamp'),
    false
  );
  assert.equal(isRuntimePayloadPath('dist-cjs/index.js'), true);
  assert.equal(isRuntimePayloadPath('lib/node_modules_helper.js'), true);
});

test('only the target platform prebuilt binaries are runtime payload', () => {
  assert.equal(
    isRuntimePayloadPath('prebuilds/darwin-arm64/node.napi.node', 'darwin'),
    true
  );
  assert.equal(
    isRuntimePayloadPath('prebuilds/darwin-x64/node.napi.node', 'darwin'),
    true
  );
  assert.equal(
    isRuntimePayloadPath('prebuilds/win32-x64/node.napi.node', 'darwin'),
    false
  );
  assert.equal(isRuntimePayloadPath('build/Release/pty.node', 'darwin'), true);
});

test('the runtime closure is exactly the declared roots plus production deps', () => {
  const closure = resolveRuntimeClosure(process.cwd());
  for (const name of RUNTIME_PACKAGES) assert.ok(closure.has(name), `missing ${name}`);
  // Everything else in the closure must be reachable through a `dependencies`
  // edge, so nothing enters the payload by being installed nearby.
  const reachable = new Set(RUNTIME_PACKAGES);
  for (const { directory } of closure.values()) {
    const manifest = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8')
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      reachable.add(dependency);
    }
  }
  for (const name of closure.keys()) assert.ok(reachable.has(name), `stray ${name}`);
  assert.equal(closure.has('typescript'), false);
  assert.equal(closure.has('vitest'), false);
});

test('a bundle path reports every package it passes through', () => {
  assert.deepEqual(
    packagesAlongPath(
      'dist-electron/node_modules/@exawatt/core/node_modules/typescript/bin/tsc'
    ),
    ['@exawatt/core', 'typescript']
  );
  assert.deepEqual(packagesAlongPath('dist-electron/main/main.js'), []);
});
