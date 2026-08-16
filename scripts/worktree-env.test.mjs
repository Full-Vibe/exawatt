import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findExecutableOnPath,
  prepareWorktreeEnv,
  syncWorktreeEnvSnapshot,
} from './lib/worktree-env.mjs';

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'exawatt-worktree-env-'));
  const mainCheckout = path.join(parent, 'main');
  const root = path.join(parent, 'agent');
  mkdirSync(mainCheckout);
  mkdirSync(root);
  return {
    parent,
    mainCheckout,
    root,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test('refreshes a stale worktree snapshot and is idempotent', () => {
  const tree = fixture();
  try {
    writeFileSync(path.join(tree.mainCheckout, '.env.local'), 'KEY=fresh\n');
    writeFileSync(path.join(tree.root, '.env.local'), 'KEY=stale\n');
    assert.equal(syncWorktreeEnvSnapshot(tree).status, 'refreshed');
    assert.equal(
      readFileSync(path.join(tree.root, '.env.local'), 'utf8'),
      'KEY=fresh\n'
    );
    assert.equal(
      statSync(path.join(tree.root, '.env.local')).mode & 0o777,
      0o600
    );
    assert.equal(syncWorktreeEnvSnapshot(tree).status, 'current');
  } finally {
    tree.cleanup();
  }
});

test('pulls directly into a worktree when the main checkout is linked', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.mainCheckout, '.vercel'));
    writeFileSync(
      path.join(tree.mainCheckout, '.vercel', 'project.json'),
      '{}'
    );
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: ({ cwd, target }) => {
        assert.equal(cwd, tree.mainCheckout);
        writeFileSync(target, 'ANTHROPIC_API_KEY=present\n');
      },
    });
    assert.equal(result.status, 'pulled');
    assert.equal(result.pullStatus, 'pulled');
    assert.match(readFileSync(result.target, 'utf8'), /ANTHROPIC_API_KEY/);
    assert.equal(
      statSync(path.join(tree.root, '.env.local')).mode & 0o777,
      0o600
    );
  } finally {
    tree.cleanup();
  }
});

test('an unlinked community checkout neither pulls nor copies a main snapshot', () => {
  const tree = fixture();
  try {
    writeFileSync(
      path.join(tree.mainCheckout, '.env.local'),
      'PRIVATE=stale\n'
    );
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: () => {
        assert.fail('an unlinked checkout must not attempt a Vercel pull');
      },
    });
    assert.equal(result.status, 'skipped-unconfigured');
    assert.equal(result.pullStatus, 'not-configured');
    assert.equal(existsSync(path.join(tree.root, '.env.local')), false);
  } finally {
    tree.cleanup();
  }
});

test('a linked checkout uses its private-safe last-good snapshot without the CLI', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.mainCheckout, '.vercel'));
    writeFileSync(
      path.join(tree.mainCheckout, '.vercel', 'project.json'),
      '{}'
    );
    writeFileSync(path.join(tree.mainCheckout, '.env.local'), 'KEY=fallback\n');
    const result = prepareWorktreeEnv(tree);
    assert.equal(result.status, 'copied');
    assert.equal(result.pullStatus, 'cli-unavailable');
    assert.equal(readFileSync(result.target, 'utf8'), 'KEY=fallback\n');
  } finally {
    tree.cleanup();
  }
});

test('a linked checkout falls back to last-good after an access failure', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.mainCheckout, '.vercel'));
    writeFileSync(
      path.join(tree.mainCheckout, '.vercel', 'project.json'),
      '{}'
    );
    writeFileSync(path.join(tree.mainCheckout, '.env.local'), 'KEY=fallback\n');
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: () => {
        throw new Error('offline');
      },
    });
    assert.equal(result.status, 'copied');
    assert.equal(result.pullStatus, 'failed');
    assert.equal(readFileSync(result.target, 'utf8'), 'KEY=fallback\n');
  } finally {
    tree.cleanup();
  }
});

test('a root-local link never falls back to a different main checkout env', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.root, '.vercel'));
    writeFileSync(path.join(tree.root, '.vercel', 'project.json'), '{}');
    writeFileSync(
      path.join(tree.mainCheckout, '.env.local'),
      'PRIVATE=other\n'
    );
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: () => {
        throw new Error('offline');
      },
    });
    assert.equal(result.status, 'missing-source');
    assert.equal(result.pullStatus, 'failed');
    assert.equal(result.snapshotSource, tree.root);
    assert.equal(existsSync(result.target), false);
  } finally {
    tree.cleanup();
  }
});

test('a linked checkout without access or a snapshot continues without env', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.mainCheckout, '.vercel'));
    writeFileSync(
      path.join(tree.mainCheckout, '.vercel', 'project.json'),
      '{}'
    );
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: () => {
        throw new Error('not authenticated');
      },
    });
    assert.equal(result.status, 'missing-source');
    assert.equal(result.pullStatus, 'failed');
    assert.equal(existsSync(result.target), false);
  } finally {
    tree.cleanup();
  }
});

test('failed pulls do not replace an existing worktree environment', () => {
  const tree = fixture();
  try {
    mkdirSync(path.join(tree.mainCheckout, '.vercel'));
    writeFileSync(
      path.join(tree.mainCheckout, '.vercel', 'project.json'),
      '{}'
    );
    writeFileSync(path.join(tree.root, '.env.local'), 'LOCAL=last-good\n');
    const result = prepareWorktreeEnv({
      ...tree,
      pullDevelopmentEnv: ({ target }) => {
        writeFileSync(target, 'PARTIAL=unsafe\n');
        throw new Error('interrupted');
      },
    });
    assert.equal(result.pullStatus, 'failed');
    assert.equal(
      readFileSync(path.join(tree.root, '.env.local'), 'utf8'),
      'LOCAL=last-good\n'
    );
  } finally {
    tree.cleanup();
  }
});

test('findExecutableOnPath distinguishes available and missing optional CLIs', () => {
  const accesses = [];
  const access = candidate => {
    accesses.push(candidate);
    if (candidate.endsWith(path.join('second', 'vercel'))) return;
    throw new Error('missing');
  };
  assert.equal(
    findExecutableOnPath('vercel', {
      pathValue: ['/first', '/second'].join(path.delimiter),
      access,
    }),
    path.join('/second', 'vercel')
  );
  assert.deepEqual(accesses, [
    path.join('/first', 'vercel'),
    path.join('/second', 'vercel'),
  ]);
  assert.equal(
    findExecutableOnPath('vercel', {
      pathValue: '/only',
      access: () => {
        throw new Error('missing');
      },
    }),
    null
  );
});
