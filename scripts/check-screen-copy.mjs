#!/usr/bin/env node

/**
 * Screen copy carries no em dash (ENG-036 Voice; BUG-207).
 *
 * `docs/engineering/design-system.md` has said since 2026-09-23 that strings
 * a user reads separate clauses with a middle dot, a comma or a full stop,
 * never an em dash. Nothing checked it, and a release review counted about
 * fifty on screen, including the tooltip on every live tab. This is the check.
 *
 * Scope is the character in rendered string content: JSX text, string
 * literals and template text in production renderer source (`src/` and
 * `packages/ui-model/src/`). Out of scope by construction: comments (not
 * string content), `console.*` arguments (never rendered), tests, and files
 * only `/hud-gallery`, `/eval` or tests can reach, which the import graph
 * decides rather than a list that rots. A string that is ONLY an em dash is
 * the empty-value glyph in a table cell or meter, not a clause separator,
 * and is allowed.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EM_DASH = '—';

const SCANNED_ROOTS = ['src', 'packages/ui-model/src'];
/** Route trees that render only studies and eval rigs, never product. */
const NON_PRODUCTION_ROUTES = ['src/app/hud-gallery/', 'src/app/eval/'];
const UI_MODEL_ENTRY = 'packages/ui-model/src/index.ts';
const OVERLAY_MANIFEST = 'company/overlay-manifest.json';

/**
 * Strings that must keep an em dash, capped per file. Removing one is always
 * legal; adding one, or a new file, needs a reason here.
 */
export const SCREEN_COPY_DASH_EXCEPTIONS = {
  'src/components/workspace/workspace-client.tsx': {
    max: 1,
    reason:
      'the one-click roadmap launch prompt is addressed to the Agent, not the operator',
  },
};

const normalized = file => file.split(path.sep).join('/');
const isTestOrSupport = file =>
  /\.(?:test|spec|stories|test-support)\.[cm]?[jt]sx?$/.test(file) ||
  file.endsWith('.d.ts');

/**
 * The files production can render: every route outside the study and eval
 * trees, the top-level Next conventions (`src/proxy.ts`), the ui-model
 * package, and everything those import. Test files never make a file
 * production, so a fixture only tests and studies import is out of scope,
 * and a file nothing imports cannot render at all.
 *
 * `sources` maps a repository-relative path to its text. `composed` maps a
 * company-overlay file to the `src/` path an official build composes it to,
 * so its routes are routes and its imports resolve where they will live.
 */
export function productionFiles(sources, composed = new Map()) {
  const at = file => composed.get(file) ?? file;
  const byComposedPath = new Map(
    [...sources.keys()].map(file => [at(file), file])
  );
  const resolve = (from, specifier) => {
    let base;
    if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
    else if (specifier === '@exawatt/ui-model') base = UI_MODEL_ENTRY;
    else if (specifier.startsWith('.')) {
      base = path.posix.join(path.posix.dirname(at(from)), specifier);
    } else return undefined;
    for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const hit = byComposedPath.get(base + suffix);
      if (hit) return hit;
    }
    return undefined;
  };

  const roots = [...sources.keys()].filter(file => {
    if (isTestOrSupport(file)) return false;
    const target = at(file);
    if (NON_PRODUCTION_ROUTES.some(prefix => target.startsWith(prefix))) {
      return false;
    }
    return (
      target.startsWith('src/app/') ||
      /^src\/[^/]+$/.test(target) ||
      target.startsWith('packages/ui-model/')
    );
  });
  const reached = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    for (const entry of ts.preProcessFile(sources.get(file), true, true)
      .importedFiles) {
      const target = resolve(file, entry.fileName);
      if (target && !isTestOrSupport(target)) queue.push(target);
    }
  }
  return reached;
}

function isConsoleArgument(node) {
  for (let at = node.parent; at; at = at.parent) {
    if (
      ts.isCallExpression(at) &&
      ts.isPropertyAccessExpression(at.expression) &&
      ts.isIdentifier(at.expression.expression) &&
      at.expression.expression.text === 'console'
    ) {
      return true;
    }
    if (ts.isStatement(at)) return false;
  }
  return false;
}

/** Every em dash in the rendered string content of one source file. */
export function findScreenCopyDashes(source, file) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings = [];
  const visit = node => {
    const whole =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node);
    const part =
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;
    if (
      (whole || part) &&
      node.text.includes(EM_DASH) &&
      !(whole && node.text.trim() === EM_DASH) &&
      !isConsoleArgument(node)
    ) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      findings.push({
        file,
        line,
        text: node.text.replace(/\s+/g, ' ').trim(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

export function unexpectedScreenCopyDashes(
  findings,
  exceptions = SCREEN_COPY_DASH_EXCEPTIONS
) {
  const byFile = new Map();
  for (const finding of findings) {
    byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
  }
  return [...byFile].flatMap(([file, found]) => {
    const exception = exceptions[file];
    return exception && found.length <= exception.max ? [] : found;
  });
}

async function walk(directory) {
  const out = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(absolute)));
    else if (/\.tsx?$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

/**
 * The company overlay an official build composes into `src/`. Absent from a
 * public checkout, which then checks the community tree alone.
 */
async function overlayTargets(root) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, OVERLAY_MANIFEST), 'utf8')
    );
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return manifest.entries.filter(entry => /\.tsx?$/.test(entry.source));
}

export async function checkScreenCopy(root = ROOT) {
  const sources = new Map();
  const composed = new Map();
  for (const scanned of SCANNED_ROOTS) {
    for (const absolute of await walk(path.join(root, scanned))) {
      sources.set(
        normalized(path.relative(root, absolute)),
        await readFile(absolute, 'utf8')
      );
    }
  }
  for (const { source, target } of await overlayTargets(root)) {
    sources.set(source, await readFile(path.join(root, source), 'utf8'));
    composed.set(source, target);
  }
  const production = productionFiles(sources, composed);
  const findings = [...production]
    .sort()
    .flatMap(file => findScreenCopyDashes(sources.get(file), file));
  return {
    scanned: production.size,
    findings,
    unexpected: unexpectedScreenCopyDashes(findings),
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { scanned, findings, unexpected } = await checkScreenCopy();
  if (unexpected.length > 0) {
    const details = unexpected
      .map(finding => `  ${finding.file}:${finding.line}  ${finding.text}`)
      .join('\n');
    process.stderr.write(
      `[screen-copy] ${unexpected.length} em dash(es) in screen copy. Rewrite the sentence with a middle dot, a comma or a full stop (docs/engineering/design-system.md, Voice), or add a reasoned capped exception:\n${details}\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `[screen-copy] ${scanned} production files; ${findings.length} reviewed em dash(es), none unreviewed\n`
    );
  }
}
