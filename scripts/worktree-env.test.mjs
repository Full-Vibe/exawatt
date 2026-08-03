import assert from 'node:assert/strict';
import {
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
    assert.equal(result.pullFailed, false);
    assert.match(readFileSync(result.target, 'utf8'), /ANTHROPIC_API_KEY/);
  } finally {
    tree.cleanup();
  }
});

test('falls back to the last good main snapshot when Vercel is unavailable', () => {
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
    assert.equal(result.pullFailed, true);
    assert.equal(readFileSync(result.target, 'utf8'), 'KEY=fallback\n');
  } finally {
    tree.cleanup();
  }
});
