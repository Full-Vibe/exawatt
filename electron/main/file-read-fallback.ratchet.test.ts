/**
 * A failed read must never return the same value as an empty read.
 *
 * BUG-242 and BUG-245 were one defect in five readers: `try { readFile }
 * catch { return null }` turned a permission error, a half-saved file or a
 * comment the harness accepts into "no settings", which the operator saw as
 * "Sign-in required", "Source default" or "needs a configuration", and which
 * overwrote the last good observation. `readConfigFile` in
 * `@exawatt/core/server` is the one owner of that read now: it answers
 * missing, unreadable (with why) or ok, and never folds the second into the
 * first.
 *
 * This test is the ratchet. It finds every catch that swallows a file read
 * into an empty value under `electron/main`, compares the set with
 * KNOWN_FALLBACKS below, and fails on a new one with the fix named, and on a
 * listed one that no longer exists.
 *
 * It finds them by SHAPE. A fallback is:
 *
 *   1. a `try` whose block calls `readFile` or `readFileSync` (any receiver:
 *      `fs.`, `fs.promises.`, a bare import), or a `.catch(...)` chained onto
 *      such a call;
 *   2. whose handler neither throws, nor names `ENOENT` (telling missing from
 *      failed is the fix), nor returns or assigns anything but an empty value:
 *      `null`, `undefined`, `false`, `''`, `0`, `[]`, `{}`, or nothing at all.
 *
 * A handler that returns `{ status: 'unreadable' }`, calls `failed(...)`, or
 * rethrows is a handler that reports the failure, and is not counted.
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MAIN = __dirname;

/**
 * The fallbacks that stay, each with why. Keyed `file:function`; `count` when
 * one function holds several. Add one only when the empty value is the true
 * answer for a failed read, and say why; a harness or credential file never
 * qualifies, it goes through `readConfigFile`.
 */
const KNOWN_FALLBACKS: Record<string, { why: string; count?: number }> = {
  // Exawatt's own caches: a failed read costs a recompute, and nothing is
  // reported to the operator from the empty value.
  'consumption/state-store.ts:load': {
    why: 'scan metadata cache; unreadable means a full rescan of the source logs',
  },
  'content-store.ts:read': {
    why: 'content-addressed render cache; a miss re-renders the artifact',
  },
  'content-store.ts:write': {
    count: 2,
    why: 'the dedupe read before a write; a failed read only costs a rewrite of identical bytes',
  },
  'pty/conversation-catalog.ts:readCache': {
    why: 'summary cache; a miss re-reads the transcripts',
  },
  'renderer-server.ts:hasWarmRendererCache': {
    why: 'a cold cache only chooses the slower extraction path',
  },

  // Harness history, where the empty answer degrades to a fuller scan.
  'pty/conversation-catalog.ts:readIndex': {
    why: "Claude's sessions-index.json is an accelerator: every transcript it does not list is scanned beside it",
  },
  'pty/conversation-catalog.ts:fallbackCwd': {
    why: 'a Grok session whose cwd file cannot be read is decoded from its directory name, or skipped',
  },
  'pty/conversation-catalog.ts:list': {
    why: 'one Grok session summary that cannot be read is one missing row, not an empty history',
  },
  'pty/conversation-catalog.ts:longFormDirectories': {
    why: 'one Grok session directory whose cwd cannot be read is skipped, not the history',
  },

  // Evidence and suggestions, where the fallback is itself the safe answer.
  'atomic-json-file.ts:recoveryEvidence': {
    why: 'a damaged recovery marker still blocks writes, and the marker itself is revealed as the evidence',
  },
  'installed-build.ts:report': {
    why: 'no update banner until the installed-build state can be read; it is polled again',
  },
  'ssh-alias-candidates.ts:readTextFile': {
    why: 'alias suggestions only; the operator can still type any alias, and Connect reads the real config through ssh',
  },

  // Persisted state that a later write replaces. Tracked as BUG-245 residuals:
  // an unreadable file here is overwritten by the next save.
  'consumption/claude-plan-account.ts:loadPersisted': {
    why: 'last-known plan windows only; the live read refills them (BUG-245 residual)',
  },
  'pty/session-identity-store.ts:initialize': {
    why: 'identities are recoverable from provider transcripts when one match is unambiguous (BUG-245 residual)',
  },
};

interface FallbackSite {
  file: string;
  owner: string;
  line: number;
}

const READ_CALLS = new Set(['readFile', 'readFileSync']);

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** Does this subtree read a file? Nested functions count: a read inside a
 *  `map` callback is still guarded by the enclosing catch. */
function readsFile(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child)) {
      const name = calleeName(child);
      if (name && READ_CALLS.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isEmptyValue(expression: ts.Expression | undefined): boolean {
  if (!expression) return true;
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isTypeAssertionExpression(value)
  ) {
    value = value.expression;
  }
  if (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(value) && value.text === 'undefined') return true;
  if (ts.isVoidExpression(value)) return true;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text === '';
  }
  if (ts.isNumericLiteral(value)) return value.text === '0';
  if (ts.isArrayLiteralExpression(value)) return value.elements.length === 0;
  if (ts.isObjectLiteralExpression(value)) return value.properties.length === 0;
  return false;
}

/**
 * Does this handler body report the failure? It does if it throws, tells
 * `ENOENT` apart, or produces anything but an empty value. Nested functions
 * are not the handler's own control flow and are skipped.
 */
function reportsFailure(body: ts.Node): boolean {
  let reports = false;
  const visit = (node: ts.Node): void => {
    if (reports) return;
    if (node !== body && isFunctionLike(node)) return;
    if (ts.isThrowStatement(node)) reports = true;
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === 'ENOENT'
    ) {
      reports = true;
    } else if (ts.isReturnStatement(node) && !isEmptyValue(node.expression)) {
      reports = true;
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      !isEmptyValue(node.right)
    ) {
      reports = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return reports;
}

/** An arrow with an expression body returns that expression. */
function handlerReportsFailure(handler: ts.Expression): boolean {
  if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
    if (!ts.isBlock(handler.body)) return !isEmptyValue(handler.body);
    return reportsFailure(handler.body);
  }
  // A named handler is someone else's decision; it is not counted.
  return true;
}

function ownerName(node: ts.Node): string {
  for (let current = node.parent; current; current = current.parent) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isGetAccessor(current) ||
        ts.isSetAccessor(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    if (ts.isConstructorDeclaration(current)) return 'constructor';
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      (ts.isVariableDeclaration(current.parent) ||
        ts.isPropertyDeclaration(current.parent) ||
        ts.isPropertyAssignment(current.parent)) &&
      current.parent.name
    ) {
      return current.parent.name.getText();
    }
  }
  return '<module>';
}

function findFileReadFallbacks(source: string, file: string): FallbackSite[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const sites: FallbackSite[] = [];
  const record = (node: ts.Node): void => {
    sites.push({
      file,
      owner: ownerName(node),
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isTryStatement(node) &&
      node.catchClause &&
      readsFile(node.tryBlock) &&
      !reportsFailure(node.catchClause.block)
    ) {
      record(node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      node.arguments.length > 0 &&
      readsFile(node.expression.expression) &&
      !handlerReportsFailure(node.arguments[0])
    ) {
      record(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !/\.test(?:-support)?\.ts$|\.test\.[a-z-]+\.ts$|\.test-support\.ts$/.test(
        entry.name
      )
    ) {
      files.push(full);
    }
  }
  return files;
}

function census(): FallbackSite[] {
  const sites: FallbackSite[] = [];
  for (const file of sourceFiles(MAIN)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/\breadFile(?:Sync)?\b/.test(text)) continue;
    const relative = path.relative(MAIN, file).split(path.sep).join('/');
    sites.push(...findFileReadFallbacks(text, relative));
  }
  return sites;
}

describe('file-read fallback ratchet (BUG-242, BUG-245)', () => {
  it('finds no catch that turns a failed file read into an empty value outside KNOWN_FALLBACKS', () => {
    const counts = new Map<string, FallbackSite[]>();
    for (const site of census()) {
      const key = `${site.file}:${site.owner}`;
      counts.set(key, [...(counts.get(key) ?? []), site]);
    }
    const unlisted: string[] = [];
    for (const [key, found] of counts) {
      const listed = KNOWN_FALLBACKS[key];
      if (!listed || found.length > (listed.count ?? 1)) {
        unlisted.push(
          ...found.map(
            site => `electron/main/${site.file}:${site.line} \`${site.owner}\``
          )
        );
      }
    }
    const gone = Object.entries(KNOWN_FALLBACKS)
      .filter(([key, listed]) => {
        const count = counts.get(key)?.length ?? 0;
        return count < (listed.count ?? 1);
      })
      .map(([key]) => key);

    expect(
      { unlisted, gone },
      '`unlisted` swallows a failed file read into an empty value, so a ' +
        'permission error or a half-written file reads exactly like no file. ' +
        'Read through `readConfigFile`/`readConfigFileSync` from ' +
        '`@exawatt/core/server` and handle `unreadable` separately from ' +
        '`missing`; or tell `ENOENT` apart and report the rest. If the empty ' +
        'value is genuinely the right answer for a failed read, list it in ' +
        'KNOWN_FALLBACKS with why. `gone` is listed but no longer found: ' +
        'delete its line, or list the new name if you renamed it.'
    ).toEqual({ unlisted: [], gone: [] });
  });
});

describe('the census recognises a fallback by shape', () => {
  const owners = (source: string) =>
    findFileReadFallbacks(source, 'fixture.ts').map(site => site.owner);

  it('finds a catch that returns an empty value, whatever it is called', () => {
    expect(
      owners(`
        function readSettings(file) {
          try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
          } catch {
            return null;
          }
        }
        async function readList(file) {
          try {
            return JSON.parse(await fs.promises.readFile(file, 'utf8'));
          } catch (error) {
            log(error);
            return [];
          }
        }
        const readFlags = async file => {
          let flags = { on: true };
          try {
            flags = JSON.parse(await readFile(file, 'utf8'));
          } catch {
            // absent is the normal case
          }
          return flags;
        };
      `)
    ).toEqual(['readSettings', 'readList', 'readFlags']);
  });

  it('finds a promise catch that answers an empty value', () => {
    expect(
      owners(`
        function readToken(file) {
          return fs.promises.readFile(file, 'utf8').catch(() => null);
        }
      `)
    ).toEqual(['readToken']);
  });

  it('ignores handlers that report the failure', () => {
    expect(
      owners(`
        function a(file) {
          try {
            return fs.readFileSync(file, 'utf8');
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        }
        function b(file) {
          try {
            return { status: 'ok', value: fs.readFileSync(file, 'utf8') };
          } catch {
            return { status: 'unreadable' };
          }
        }
        function c(file) {
          try {
            fs.readFileSync(file, 'utf8');
          } catch {
            return failed('unreadable-config');
          }
        }
        function d(file) {
          try {
            compute();
          } catch {
            return null;
          }
        }
      `)
    ).toEqual([]);
  });
});
