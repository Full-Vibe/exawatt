/**
 * A hand-rolled stale-result guard is a defect waiting for its fifth report.
 *
 * BUG-118, BUG-119, BUG-120 and BUG-121 were one stale-async defect fixed
 * four times with four local counters. `useLatestRequest` is the one owner
 * now. This test is the ratchet: it finds every remaining hand-rolled guard,
 * compares the set with KNOWN_GUARDS below, and fails on a new one with the
 * fix named, and on a listed one that no longer exists.
 *
 * It finds guards by SHAPE, never by name (BUG-206). The first version
 * matched a name list (`xSeq`, `xGeneration`, `let cancelled`), so renaming
 * `attempt` to `attemptToken` turned it red on master, and seventeen correct
 * guards spelled `active`, `mounted`, `current`, `disposed` or `writeScope`
 * were invisible to it. A guard is:
 *
 *   1. a mutable counter or flag: `useRef(<number|boolean>)` read through
 *      `.current`, or a `let` initialised to a number or boolean;
 *   2. read in a branch condition (`if`, `&&`, `||`) after an await: in an
 *      async function after an `await`, or in a `.then`/`.catch`/`.finally`
 *      callback, directly or through a named predicate such as
 *      `const stale = () => cancelled || mine !== generation`;
 *   3. written by someone other than the continuation that reads it: an
 *      effect cleanup, an unmount, a newer request. A counter the reading
 *      function increments itself counts when the read compares it by
 *      equality (`mine !== seq.current`), because the write that matters is
 *      a concurrent call's.
 *
 * Rule 3 is what keeps result variables out: `let ok = false; ok = await
 * launch(); if (!ok) return;` is written by its own reader and is no guard.
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const PRIMITIVE = path.join('hooks', 'use-latest-request.ts');

/**
 * The guards that stay, each with why. Keyed `file:name`; `count` when one
 * file holds several of one name. Delete a line when you migrate a guard to
 * `useLatestRequest`; add one only with a reason the primitive cannot serve.
 */
const KNOWN_GUARDS: Record<string, { why: string; count?: number }> = {
  // Request generations the primitive would own, held by their owners.
  'app/settings/connected-sources-section.tsx:listRequest': {
    why: 'one of two read channels; Agent Source settings migrate as one change with their gate',
  },
  'app/settings/connected-sources-section.tsx:statusRequest': {
    why: 'the second read channel beside listRequest',
  },
  'app/settings/connected-sources-section.tsx:mounted': {
    why: 'also gates the per-source actions, not only the two reads',
  },
  'components/roadmap/roadmap-rail.tsx:writeScope': {
    why: 'a scope change, not a newer write, supersedes a write; it also clears the in-flight lock',
  },
  'components/workspace/remote-agent/use-remote-coworkers.ts:readGeneration': {
    why: 'a superseded read answers with the newest read, which a ticket cannot express',
  },
  'components/workspace/use-agent-source-registry.ts:liveLanded': {
    why: 'orders two reads inside one ticket: the remembered paint yields to the live read',
  },
  'components/workspace/use-closed-session-count.ts:revision': {
    why: 'a ledger event, not a newer read, supersedes the hydration read',
  },

  // Effect-scoped cancel flags around one read: correct, and the migration
  // `useLatestRequest` names. Each sits on a gated surface or a file another
  // change owns today.
  'components/shortcuts/command-palette.tsx:cancelled': {
    why: 'one read per open; the navigation spine gate owns this file',
  },
  'components/workspace/paused-agent-record.tsx:cancelled': {
    why: 'one record read per open; the paused-record gate owns this file',
  },
  'components/workspace/project-opener.tsx:cancelled': {
    why: 'one library read per open',
  },
  'components/workspace/recent-conversations.tsx:cancelled': {
    count: 2,
    why: 'one catalog read per open and one per query; the recents gate owns this file',
  },
  'components/workspace/session-model-control.tsx:current': {
    why: 'one catalog read per open; the model-change gate owns this file',
  },
  'components/workspace/use-closed-session-count.ts:cancelled': {
    why: 'also gates the ledger subscription',
  },
  'components/workspace/use-workspace-state.ts:cancelled': {
    why: 'one hydration read per mount',
  },
  'components/workspace/workspace-client.tsx:cancelled': {
    why: 'one read per mount; four surface gates own this file',
  },
  'components/workspace/workspace-client.tsx:current': {
    why: 'one Clone-target read per Project; four surface gates own this file',
  },

  // Lifetime flags: the effect owns a subscription as well as a read, and the
  // flag is that subscription's lifetime, not a request order.
  'app/settings/privacy-settings.tsx:active': {
    why: 'settings read plus change subscription',
  },
  'components/appearance/appearance-provider.tsx:active': {
    count: 2,
    why: 'preference and native-appearance reads plus their subscriptions and settle timers',
  },
  'components/goal-visuals/goal-visual-preference-provider.tsx:active': {
    why: 'preference read plus change subscription',
  },
  'components/operator-stats/publish-panel.tsx:active': {
    why: 'settings read plus change subscription',
  },
  'components/workspace/terminal-pane.tsx:disposed': {
    why: 'the terminal build is a chain of awaits whose resources the destructor releases',
  },
  'lib/fleet/fleet-provider.tsx:mounted': {
    count: 3,
    why: 'each effect owns a manager subscription or poll beside its read',
  },
};

interface GuardSite {
  file: string;
  name: string;
  line: number;
}

type Fn =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

const isFn = (node: ts.Node): node is Fn =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

const isScalar = (node: ts.Expression | undefined): boolean =>
  !!node &&
  (ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)));

const isUseRef = (callee: ts.Expression): boolean =>
  (ts.isIdentifier(callee) && callee.text === 'useRef') ||
  (ts.isPropertyAccessExpression(callee) && callee.name.text === 'useRef');

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);

function isWrite(access: ts.Node): boolean {
  const parent = access.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === access &&
    ASSIGNMENTS.has(parent.operatorToken.kind)
  ) {
    return true;
  }
  return (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  );
}

/** `++x`, `x += 1`, `x = x + 1`: a write that moves a counter on. */
function isIncrement(access: ts.Node): boolean {
  const parent = access.parent;
  if (
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent)
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      ts.isBinaryExpression(parent.right))
  );
}

function isEqualityOperand(access: ts.Node): boolean {
  let node = access.parent;
  while (ts.isParenthesizedExpression(node)) node = node.parent;
  return ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind);
}

function enclosingFn(node: ts.Node): Fn | undefined {
  for (let at = node.parent; at; at = at.parent) if (isFn(at)) return at;
  return undefined;
}

const isAsync = (fn: Fn): boolean =>
  (ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async) !== 0;

const PROMISE_CONTINUATIONS = new Set(['then', 'catch', 'finally']);

function isContinuationCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    PROMISE_CONTINUATIONS.has(node.expression.name.text)
  );
}

/** The name a function is bound to (`const f = () => …`, `function f`). */
function boundName(fn: Fn): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
    return fn.parent.name.text;
  }
  return undefined;
}

function awaitsBefore(fn: Fn, position: number): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || node.pos >= position) return;
    if (isFn(node)) return;
    if (ts.isAwaitExpression(node) && node.end <= position) found = true;
    else if (ts.isForOfStatement(node) && node.awaitModifier) found = true;
    else ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
  return found;
}

/** Condition of an `if`, or the left side of `&&` / `||`. */
function inBranchCondition(node: ts.Node, fn: Fn): boolean {
  let child = node;
  for (let at = node.parent; at && at !== fn; at = at.parent) {
    if (ts.isIfStatement(at)) return at.expression === child;
    if (
      ts.isBinaryExpression(at) &&
      SHORT_CIRCUIT.has(at.operatorToken.kind) &&
      at.left === child
    ) {
      return true;
    }
    if (ts.isStatement(at)) return false;
    child = at;
  }
  return false;
}

const contains = (outer: ts.Node, inner: ts.Node): boolean =>
  inner.pos >= outer.pos && inner.end <= outer.end;

function findStaleAsyncGuards(source: string, file: string): GuardSite[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // Functions handed to a promise continuation by name: `.then(accept)`.
  const continuationNames = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (isContinuationCall(node)) {
      for (const argument of node.arguments) {
        if (ts.isIdentifier(argument)) continuationNames.add(argument.text);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const isLate = (fn: Fn, at: ts.Node): boolean => {
    if (isAsync(fn) && awaitsBefore(fn, at.pos)) return true;
    if (
      isContinuationCall(fn.parent) &&
      fn.parent.arguments.some(argument => argument === fn)
    ) {
      return true;
    }
    const name = boundName(fn);
    return name !== undefined && continuationNames.has(name);
  };

  const candidates: Array<{
    declaration: ts.VariableDeclaration & { name: ts.Identifier };
    ref: boolean;
  }> = [];
  const declarations = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const declaration = node as ts.VariableDeclaration & {
        name: ts.Identifier;
      };
      const initializer = node.initializer;
      const isLet =
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Let) !== 0;
      if (
        ts.isCallExpression(initializer) &&
        isUseRef(initializer.expression) &&
        isScalar(initializer.arguments[0])
      ) {
        candidates.push({ declaration, ref: true });
      } else if (isLet && isScalar(initializer)) {
        candidates.push({ declaration, ref: false });
      }
    }
    ts.forEachChild(node, declarations);
  };
  declarations(sourceFile);

  const found: GuardSite[] = [];
  for (const { declaration, ref } of candidates) {
    const name = declaration.name.text;
    let scope: ts.Node = declaration.parent;
    while (!isFn(scope) && !ts.isSourceFile(scope)) scope = scope.parent;

    // Every access: `name.current` for a ref, the bare identifier for a let.
    const accesses: ts.Node[] = [];
    const gather = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text === name &&
        node !== declaration.name
      ) {
        const parent = node.parent;
        if (ref) {
          if (
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            parent.name.text === 'current'
          ) {
            accesses.push(parent);
          }
        } else if (
          !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
          !ts.isPropertyAssignment(parent)
        ) {
          accesses.push(node);
        }
      }
      ts.forEachChild(node, gather);
    };
    gather(scope);

    const writes = accesses.filter(isWrite);
    if (writes.length === 0) continue;

    // A read counts where it happens, or where a predicate wrapping it is
    // called: `const stale = () => mine !== generation; … if (stale())`.
    const readSites: Array<{ site: ts.Node; read: ts.Node }> = [];
    for (const read of accesses) {
      if (isWrite(read)) continue;
      readSites.push({ site: read, read });
      const predicate = enclosingFn(read);
      const predicateName = predicate && boundName(predicate);
      if (!predicate || !predicateName || isAsync(predicate)) continue;
      const callers = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === predicateName
        ) {
          readSites.push({ site: node, read });
        }
        ts.forEachChild(node, callers);
      };
      callers(enclosingFn(predicate) ?? sourceFile);
    }

    const guarded = readSites.some(({ site, read }) => {
      const reader = enclosingFn(site);
      if (!reader || !isLate(reader, site)) return false;
      if (!inBranchCondition(site, reader)) return false;
      return writes.some(write => {
        const writer = enclosingFn(write);
        if (writer === reader) {
          return isIncrement(write) && isEqualityOperand(read);
        }
        // Written inside the reader's own nested callbacks: a result.
        return !(writer && contains(reader, writer));
      });
    });
    if (guarded) {
      found.push({
        file,
        name,
        line:
          sourceFile.getLineAndCharacterOfPosition(declaration.getStart())
            .line + 1,
      });
    }
  }
  return found;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function census(): GuardSite[] {
  const sites: GuardSite[] = [];
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file);
    if (relative === PRIMITIVE) continue;
    const text = fs.readFileSync(file, 'utf8');
    // A guard needs a late read, so a file with no await and no promise
    // continuation cannot hold one.
    if (!/\bawait\b|\.(?:then|catch|finally)\(/.test(text)) continue;
    sites.push(
      ...findStaleAsyncGuards(text, relative.split(path.sep).join('/'))
    );
  }
  return sites;
}

describe('stale-async ratchet (BUG-118/119/120/121, BUG-206)', () => {
  it('finds no hand-rolled guard outside KNOWN_GUARDS, and every listed one', () => {
    const sites = census();
    const counts = new Map<string, GuardSite[]>();
    for (const site of sites) {
      const key = `${site.file}:${site.name}`;
      counts.set(key, [...(counts.get(key) ?? []), site]);
    }

    const unlisted: string[] = [];
    for (const [key, found] of counts) {
      const listed = KNOWN_GUARDS[key];
      if (!listed || found.length > (listed.count ?? 1)) {
        unlisted.push(
          ...found.map(site => `src/${site.file}:${site.line} \`${site.name}\``)
        );
      }
    }
    const gone = Object.entries(KNOWN_GUARDS)
      .filter(([key, listed]) => {
        const count = counts.get(key)?.length ?? 0;
        return count < (listed.count ?? 1);
      })
      .map(([key]) => key);

    // One assertion, so a rename reads as what it is: the old name under
    // `gone` beside the new one under `unlisted`.
    expect(
      { unlisted, gone },
      '`unlisted` is a hand-rolled stale-async guard: a counter or flag compared ' +
        'after an await. Use `useLatestRequest` from src/hooks/use-latest-request.ts: ' +
        '`begin()` per request, `if (!ticket.current) return` after the await, ' +
        '`invalidate()` in the cleanup; if it genuinely cannot be one, list it in ' +
        'KNOWN_GUARDS with why. `gone` is listed but no longer found: delete its ' +
        'line, or list the new name if you renamed it.'
    ).toEqual({ unlisted: [], gone: [] });
  });
});

describe('the census recognises a guard by shape, not by name', () => {
  const names = (source: string) =>
    findStaleAsyncGuards(source, 'fixture.tsx').map(site => site.name);

  it('finds a request counter under a name it has never seen', () => {
    expect(
      names(`
        function Panel() {
          const zebra = useRef(0);
          const load = async () => {
            const mine = ++zebra.current;
            const next = await read();
            if (mine !== zebra.current) return;
            setValue(next);
          };
        }
      `)
    ).toEqual(['zebra']);
  });

  it('finds an effect flag flipped by its cleanup, in a promise continuation', () => {
    expect(
      names(`
        function Panel() {
          useEffect(() => {
            let lantern = true;
            read().then(next => {
              if (!lantern) return;
              setValue(next);
            });
            return () => {
              lantern = false;
            };
          }, []);
        }
      `)
    ).toEqual(['lantern']);
  });

  it('finds a flag read through a predicate after an await', () => {
    expect(
      names(`
        function Panel() {
          useEffect(() => {
            let torn = false;
            let epoch = 0;
            const sample = async () => {
              const mine = ++epoch;
              const stale = () => torn || mine !== epoch;
              const next = await read();
              if (!stale()) setValue(next);
            };
            void sample();
            return () => {
              torn = true;
            };
          }, []);
        }
      `).sort()
    ).toEqual(['epoch', 'torn']);
  });

  it('finds a flag read by a continuation passed by name', () => {
    expect(
      names(`
        function Panel() {
          useEffect(() => {
            let open = true;
            const accept = next => {
              if (!open) return;
              setValue(next);
            };
            void read().then(accept);
            return () => {
              open = false;
            };
          }, []);
        }
      `)
    ).toEqual(['open']);
  });

  it('ignores results, animation state and synchronous dedupes', () => {
    expect(
      names(`
        function Panel() {
          const progress = useRef(0);
          const handled = useRef(0);
          const launch = async () => {
            let ok = false;
            try {
              ok = await start();
            } catch {
              ok = false;
            }
            if (!ok) return;
            setDone(true);
          };
          useEffect(() => {
            requestAnimationFrame(() => {
              progress.current += 1;
            });
          });
          useEffect(() => {
            if (request === handled.current) return;
            handled.current = request;
          }, [request]);
        }
      `)
    ).toEqual([]);
  });
});
