import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The delivery policy of the tree being checked (BUG-317).
 *
 * A landing decided what a tree owed with the code of the checkout that ran
 * it: `agent-land.mjs` imported `classifyDeliveryPolicy` and the surface gate
 * map statically, so only the tree's FACTS (`deliveryTree`) were the tree's.
 * On 2026-10-22 a five-car train carried ENG-039's new `modules:check` and a
 * car that deleted ten files `modules.json` still named; it ran from a master
 * older than the check, the check never ran on the stack, and master landed
 * red. A car that added a gate for its own surface was not held to it either.
 *
 * So every classification loads the tree's own `scripts/lib/delivery-policy.mjs`
 * from the checkout that holds the tree: the candidate's worktree, the queue
 * head after its rebase, a train's integration worktree for each stack it
 * checks, the docs lane's temporary checkout. The invoking checkout keeps
 * orchestration (queue, tickets, push, bisection, reporting, and running the
 * checks), and reads the policy only through its exports.
 *
 * Each load is a fresh module instance, and so is everything it reaches
 * outside `node_modules`: the resolve hook below carries the load's token to
 * every relative import, so two stacks checked in one process, or one
 * worktree before and after a rebase, never share `module-graph.mjs` or any
 * other part of the policy.
 *
 * A policy that does not load, lacks an export the landing asks for, or
 * throws is a `TreePolicyError`: the tree's own failure, recorded as the
 * landing check `delivery-policy`, never a crash of the landing.
 */

export const TREE_POLICY_FILE = 'scripts/lib/delivery-policy.mjs';

/** The landing-check id a tree's unusable policy fails as. */
export const TREE_POLICY_CHECK = 'delivery-policy';

/** What the landing asks a tree's policy. */
const POLICY_EXPORTS = Object.freeze([
  'classifyDeliveryPolicy',
  'classifyDocsChecks',
  'deliveryTree',
  'gateNeedsDevServer',
  'missingSurfaceGates',
  'quarantinedSurfaceGates',
  'surfaceGateMessage',
  'surfaceGateRecheck',
]);

const LOAD_PARAMETER = 'exawatt-tree-policy';
let hooked = false;
let loads = 0;

/** A tree's policy could not answer: that tree fails its landing. */
export class TreePolicyError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'TreePolicyError';
  }
}

function carryLoadToken() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (!context.parentURL?.includes(LOAD_PARAMETER)) return resolved;
      const token = new URL(context.parentURL).searchParams.get(LOAD_PARAMETER);
      const url = new URL(resolved.url);
      if (
        !token ||
        url.protocol !== 'file:' ||
        url.search !== '' ||
        url.pathname.split('/').includes('node_modules')
      ) {
        return resolved;
      }
      url.searchParams.set(LOAD_PARAMETER, token);
      return { ...resolved, url: url.href };
    },
  });
}

function treeHash(root) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD^{tree}'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function describe(error) {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.split('\n')[0];
}

/**
 * A fresh instance of the delivery policy of the tree checked out at `root`,
 * with `tree` (its own `deliveryTree(root)`) and every export the landing
 * asks for. Each export throws `TreePolicyError` when the tree lacks it or
 * it throws.
 */
export async function loadTreePolicy(root) {
  const hash = treeHash(root);
  const named = `${TREE_POLICY_FILE} of tree ${hash ? hash.slice(0, 12) : 'at ' + root}`;
  const fail = (what, cause) =>
    new TreePolicyError(
      `${TREE_POLICY_CHECK}: ${named} ${what}. A tree's own policy decides the checks and gates it owes: fix it, or what it imports, and land again.`,
      { cause }
    );

  carryLoadToken();
  loads += 1;
  const url = pathToFileURL(path.join(root, TREE_POLICY_FILE));
  url.searchParams.set(
    LOAD_PARAMETER,
    `${hash ? hash.slice(0, 12) : 'untracked'}.${process.pid}.${loads}`
  );
  let policy;
  try {
    policy = await import(url.href);
  } catch (error) {
    throw fail(`did not load: ${describe(error)}`, error);
  }

  const guarded = {};
  for (const name of POLICY_EXPORTS) {
    guarded[name] = (...args) => {
      if (typeof policy[name] !== 'function') {
        throw fail(`exports no ${name}`);
      }
      try {
        return policy[name](...args);
      } catch (error) {
        throw fail(`threw in ${name}: ${describe(error)}`, error);
      }
    };
  }
  guarded.tree = guarded.deliveryTree(root);
  return Object.freeze(guarded);
}
