#!/usr/bin/env node

/**
 * What an eval binds to is checked before the eval runs (BUG-312).
 *
 * On 2026-10-22 two renames broke evals that nothing could see until their
 * gate ran inside an hour-long landing train. One eval still called
 * `window.electron.settings.setPresentation`, renamed a week earlier: the eval
 * scripts are untyped JavaScript and reach the bridge inside `page.evaluate`,
 * so type-check and lint passed. Two more found shortcut-help rows by their
 * label, and a packet relabelled the command.
 *
 * Three rules, static and whole-tree in a few seconds:
 *
 * 1. Every desktop-bridge member an eval reaches exists on the bridge the
 *    renderer gets. The TypeScript checker reads the scripts against
 *    `src/types/electron.d.ts`, so `window.electron.<ns>.<member>` resolves the
 *    way the compiler resolves it: inside `page.evaluate` callbacks and string
 *    bodies, through aliases and destructuring, and on to the fields of what a
 *    call returns. A member the bridge lacks fails with the closest it has.
 * 2. An eval finds an element by a handle the product renders (a registry id,
 *    a `data-*` attribute, a role), never by its copy. Text locators, label and
 *    accessible-name lookups, copy selectors (`text=`, `:has-text(`,
 *    `[aria-label=`) and comparisons of rendered text against a literal fail,
 *    unless the line says why the text is the contract:
 *    `// binds-text: <reason>`. Text the eval itself wrote into the product
 *    (a fixture's name, a line typed into a terminal) is data, not copy.
 * 3. Every `data-*` attribute an eval selects on is one the product renders,
 *    so renaming a handle fails here rather than in the gate.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOW_DECLARATION = 'src/types/electron.d.ts';
const BRIDGE_DIRECTORY = 'packages/core/src/desktop-bridge/';
const BRIDGE_MODULE = '@exawatt/core/desktop-bridge';
const BRIDGE_ENTRY = 'packages/core/src/desktop-bridge/index.ts';
/** Where the product writes its copy and its attributes. */
const PRODUCT_ROOTS = [
  'src',
  'packages/ui-model/src',
  'packages/core/src',
  'electron',
  'company/overlay',
  'contracts',
];
const MARKER = /\bbinds-text:\s*\S/u;

/** Calls whose first argument is code that runs in the page. */
const PAGE_CODE_CALLS = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateAll',
  'waitForFunction',
  'addInitScript',
  'executeJavaScript',
]);
/** Locators whose only input is text the product renders. */
const TEXT_LOCATORS = new Set([
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
]);
const TEXT_OPTIONS = new Set(['hasText', 'hasNotText']);
/** Assertions that compare an element's text, whatever the receiver. */
const TEXT_ASSERTIONS = new Set([
  'toHaveText',
  'toContainText',
  'toHaveAccessibleName',
]);
/** What reads the text, or the copy-bearing attribute, of an element. */
const TEXT_READS = new Set([
  'innerText',
  'textContent',
  'allInnerTexts',
  'allTextContents',
]);
const COPY_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt']);
const TEXT_COMPARISONS = new Set([
  'includes',
  'startsWith',
  'endsWith',
  'indexOf',
  'match',
]);
const ASSERT_COMPARISONS = new Set([
  'equal',
  'strictEqual',
  'notEqual',
  'notStrictEqual',
  'deepEqual',
  'match',
  'doesNotMatch',
  'toBe',
  'toEqual',
  'toContain',
  'toMatch',
]);
/** Calls a string passes through as the same text. */
const TEXT_PRESERVING = new Set([
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'replace',
  'replaceAll',
  'normalize',
  'split',
  'join',
  'at',
  'find',
  'filter',
  'map',
]);
/**
 * Selector syntax that matches copy: Playwright's text engines, and attribute
 * selectors over the attributes that hold copy.
 */
const COPY_SELECTOR =
  /^(?:internal:)?text=|>>\s*(?:internal:)?text=|:(?:has-text|text|text-is|text-matches)\(|\[(?:aria-label|title|placeholder|alt)\s*[*^$|~]?=/u;
const DATA_SELECTOR = /\[data-([a-z0-9]+(?:-[a-z0-9]+)*)/gu;

const normalized = file => file.split(path.sep).join('/');
const isTest = file =>
  /\.(?:test|spec|stories|test-support)\.[cm]?[jt]sx?$/u.test(file) ||
  file.includes('/__tests__/');

function lineOf(sourceFile, node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function calledName(call) {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isIdentifier(callee)) return callee.text;
  return undefined;
}

/* ---- Program ------------------------------------------------------------- */

/**
 * Page code written as a string is checked as code: each string becomes a
 * virtual script that reports at the string's line in the file that sends it.
 */
function pageCodeStrings(scripts) {
  const out = new Map();
  for (const [file, text] of scripts) {
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    let count = 0;
    const visit = node => {
      const code = ts.isCallExpression(node) ? node.arguments[0] : undefined;
      if (
        code &&
        PAGE_CODE_CALLS.has(calledName(node)) &&
        ts.isStringLiteralLike(code)
      ) {
        count += 1;
        out.set(`${file}.page-code-${count}.js`, {
          text: code.text,
          file,
          line: lineOf(sourceFile, code),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return out;
}

/**
 * One checker over the scripts and the declaration of `window.electron`.
 * Scripts are virtual so a test can hand in fixtures; everything else (the
 * standard library, the bridge contract) is read from `root`.
 */
function createChecker(scripts, declarations, root) {
  const files = new Map();
  for (const [file, text] of [...scripts, ...declarations]) {
    files.set(path.resolve(root, file), text);
  }
  const options = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    baseUrl: root,
    // The renderer reads the contract through the package; read its source,
    // so a checkout with no built declarations checks the same surface.
    paths: { [BRIDGE_MODULE]: [BRIDGE_ENTRY] },
  };
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = file => files.get(path.resolve(file)) ?? readFile(file);
  host.fileExists = file => files.has(path.resolve(file)) || fileExists(file);
  host.getSourceFile = (file, language, onError, create) => {
    const text = files.get(path.resolve(file));
    if (text === undefined) {
      return getSourceFile(file, language, onError, create);
    }
    return ts.createSourceFile(
      file,
      text,
      language,
      true,
      /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    );
  };
  // A script's own package imports (Playwright, Node) say nothing about the
  // bridge, and loading their declarations would cost most of the run.
  host.resolveModuleNameLiterals = (literals, containing, redirected, opts) =>
    literals.map(literal =>
      /\.[cm]?js$/u.test(containing) && !literal.text.startsWith('.')
        ? { resolvedModule: undefined }
        : ts.resolveModuleName(
            literal.text,
            containing,
            opts,
            host,
            undefined,
            redirected
          )
    );
  const program = ts.createProgram({
    rootNames: [...files.keys()],
    options,
    host,
  });
  return { program, checker: program.getTypeChecker() };
}

/* ---- Rule 1: bridge members --------------------------------------------- */

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return row[b.length];
}

function longestSharedRun(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let best = 0;
  for (let i = 0; i < x.length; i += 1) {
    for (let j = 0; j < y.length; j += 1) {
      let run = 0;
      while (i + run < x.length && x[i + run] === y[j + run]) run += 1;
      best = Math.max(best, run);
    }
  }
  return best;
}

/**
 * The real member a missing one most likely became. A rename usually keeps
 * the noun and changes the verb (`setPresentation` became
 * `updatePresentation`), so the longest shared run of characters ranks first
 * and edit distance breaks ties.
 */
export function closestMember(name, candidates) {
  return [...candidates].sort(
    (a, b) =>
      longestSharedRun(name, b) - longestSharedRun(name, a) ||
      editDistance(name, a) - editDistance(name, b) ||
      a.localeCompare(b)
  )[0];
}

function bridgeMembers({
  program,
  checker,
  files,
  origins,
  root,
  bridgeDirectory,
}) {
  const bridgeRoot = path.resolve(root, bridgeDirectory);
  const isBridgeType = type =>
    Boolean(
      (type.aliasSymbol ?? type.getSymbol())?.declarations?.some(declaration =>
        path
          .resolve(declaration.getSourceFile().fileName)
          .startsWith(bridgeRoot)
      )
    );
  const parts = type => (type.isUnion() ? type.types : [type]);
  const hasMember = (type, name) =>
    parts(type).some(
      part =>
        checker.getPropertyOfType(part, name) !== undefined ||
        checker.getIndexInfosOfType(part).length > 0
    );
  const memberNames = type =>
    parts(type).flatMap(part =>
      checker.getPropertiesOfType(part).map(property => property.name)
    );

  const reached = [];
  const missing = [];
  for (const file of files) {
    const sourceFile = program.getSourceFile(path.resolve(root, file));
    if (!sourceFile) continue;
    const origin = origins.get(file);
    const check = (node, objectNode, name) => {
      const objectType = checker.getNonNullableType(
        checker.getTypeAtLocation(objectNode)
      );
      // `window.electron` itself: a renamed global is the same defect.
      const onWindow =
        name === 'electron' && objectType.getSymbol()?.name === 'Window';
      if (!onWindow && !isBridgeType(objectType)) return;
      const where = origin
        ? { file: origin.file, line: origin.line }
        : { file, line: lineOf(sourceFile, node) };
      const owner = checker.typeToString(objectType);
      reached.push({ ...where, owner, member: name });
      if (!hasMember(objectType, name)) {
        missing.push({
          ...where,
          owner,
          member: name,
          closest: closestMember(name, memberNames(objectType)),
        });
      }
    };
    const visit = node => {
      if (ts.isPropertyAccessExpression(node)) {
        check(node.name, node.expression, node.name.text);
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        check(node, node.expression, node.argumentExpression.text);
      } else if (
        ts.isObjectBindingPattern(node) &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.initializer
      ) {
        for (const element of node.elements) {
          const key = element.propertyName ?? element.name;
          if (element.dotDotDotToken || !ts.isIdentifier(key)) continue;
          check(element, node.parent.initializer, key.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { reached, missing };
}

/* ---- Rule 2: copy-bound locators ---------------------------------------- */

function unwrap(node) {
  let at = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(at) ||
      ts.isAwaitExpression(at) ||
      ts.isNonNullExpression(at)
    ) {
      at = at.expression;
    } else if (
      ts.isBinaryExpression(at) &&
      (at.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        at.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      at = at.left;
    } else return at;
  }
}

const hasLetters = text => /\p{L}{2}/u.test(text);

/** The literal stretches of a regular expression's source. */
function regexRuns(source) {
  return source
    .replace(/\\[dDwWsSbB]/gu, ' ')
    .replace(/\\(.)/gu, '$1')
    .split(/[\^$.*+?()[\]{}|]+/u)
    .map(run => run.trim())
    .filter(hasLetters);
}

/**
 * The text a value carries when the script writes it: a string, a template's
 * literal stretches, a regular expression's literal runs, or a constant or a
 * loop variable over an array bound to those. Undefined for data the eval
 * computes. `runs` is what a fixture must contain for the text to be data.
 */
function writtenText(node, checker, seen = new Set()) {
  const at = unwrap(node);
  if (ts.isStringLiteralLike(at)) {
    return hasLetters(at.text)
      ? { display: at.text, runs: [at.text.trim()], fold: false }
      : undefined;
  }
  if (ts.isRegularExpressionLiteral(at)) {
    const slash = at.text.lastIndexOf('/');
    const runs = regexRuns(at.text.slice(1, slash));
    return runs.length > 0
      ? { display: at.text, runs, fold: at.text.slice(slash).includes('i') }
      : undefined;
  }
  if (ts.isTemplateExpression(at)) {
    const runs = [at.head, ...at.templateSpans.map(span => span.literal)]
      .map(part => part.text.trim())
      .filter(hasLetters);
    return runs.length > 0
      ? { display: at.getText(), runs, fold: false }
      : undefined;
  }
  if (!ts.isIdentifier(at) || !checker) return undefined;
  const declaration = checker.getSymbolAtLocation(at)?.valueDeclaration;
  if (
    !declaration ||
    seen.has(declaration) ||
    !ts.isVariableDeclaration(declaration)
  ) {
    return undefined;
  }
  seen.add(declaration);
  const statement = declaration.parent?.parent;
  if (statement && ts.isForOfStatement(statement)) {
    const iterable = unwrap(statement.expression);
    if (!ts.isArrayLiteralExpression(iterable)) return undefined;
    const texts = iterable.elements
      .map(element => writtenText(element, checker, seen))
      .filter(Boolean);
    return texts.length > 0
      ? {
          display: texts.map(text => text.display).join(' | '),
          runs: texts.flatMap(text => text.runs),
          fold: texts.some(text => text.fold),
        }
      : undefined;
  }
  if (
    declaration.parent.flags & ts.NodeFlags.Const &&
    declaration.initializer &&
    ts.isIdentifier(declaration.name)
  ) {
    return writtenText(declaration.initializer, checker, seen);
  }
  return undefined;
}

/** Whether a value is the text, or a copy attribute, an element renders. */
function isRenderedText(node, checker, seen = new Set()) {
  const at = unwrap(node);
  if (ts.isCallExpression(at)) {
    const name = calledName(at);
    if (TEXT_READS.has(name)) return true;
    if (name === 'getAttribute') {
      const [attribute] = at.arguments;
      return Boolean(
        attribute &&
        ts.isStringLiteralLike(attribute) &&
        COPY_ATTRIBUTES.has(attribute.text)
      );
    }
    return (
      TEXT_PRESERVING.has(name) &&
      ts.isPropertyAccessExpression(at.expression) &&
      isRenderedText(at.expression.expression, checker, seen)
    );
  }
  if (ts.isPropertyAccessExpression(at)) {
    return TEXT_READS.has(at.name.text) || at.name.text === 'ariaLabel';
  }
  if (ts.isElementAccessExpression(at)) {
    return isRenderedText(at.expression, checker, seen);
  }
  if (!ts.isIdentifier(at) || !checker) return false;
  const declaration = checker.getSymbolAtLocation(at)?.valueDeclaration;
  if (
    !declaration ||
    seen.has(declaration) ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer
  ) {
    return false;
  }
  seen.add(declaration);
  return isRenderedText(declaration.initializer, checker, seen);
}

function optionsNamed(objectLiteral, names) {
  if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return [];
  return objectLiteral.properties.filter(
    property =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      names.has(property.name.text)
  );
}

function carriesMarker(sourceFile, node) {
  const starts = sourceFile.getLineStarts();
  const first = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  ).line;
  const last = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;
  const from = starts[Math.max(0, first - 1)];
  const to =
    last + 1 < starts.length ? starts[last + 1] : sourceFile.text.length;
  return MARKER.test(sourceFile.text.slice(from, to));
}

const isWordCharacter = character =>
  character !== undefined && /[\p{L}\p{N}_]/u.test(character);

/** Whether `run` occurs in `text` as whole words. */
function containsWords(text, run) {
  for (let at = text.indexOf(run); at !== -1; at = text.indexOf(run, at + 1)) {
    if (!isWordCharacter(text[at - 1]) || !isWordCharacter(run[0])) {
      if (
        !isWordCharacter(text[at + run.length]) ||
        !isWordCharacter(run[run.length - 1])
      ) {
        return true;
      }
    }
  }
  return false;
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Product files whose text is fixtures and studies, not shipped copy. */
const isFixture = file =>
  /(?:^|[/.-])fixtures?(?:[/.-]|$)|\.contract\.ts$/u.test(file);
/** Files the pointer to where copy is written names last. */
const isStudy = file =>
  file.startsWith('src/app/hud-gallery/') ||
  file.startsWith('src/app/eval/') ||
  file.startsWith('company/');

/**
 * The product's copy: every string, template and JSX text the product source
 * writes, and every string a contract it renders from declares. Text an eval
 * wrote itself (a fixture's name, a line typed into a terminal) is not in it,
 * so it is data, not copy.
 */
function productCopy(sources) {
  const strings = new Map();
  const templates = [];
  const attributes = new Set();
  const addString = (text, file) => {
    const trimmed = text.trim();
    if (hasLetters(trimmed) && !strings.has(trimmed))
      strings.set(trimmed, file);
  };
  const files = [...sources.keys()]
    .filter(file => !isFixture(file) && !isTest(file))
    .sort(
      (a, b) => Number(isStudy(a)) - Number(isStudy(b)) || a.localeCompare(b)
    );
  for (const file of files) {
    const text = sources.get(file);
    for (const match of text.matchAll(/\bdata-([a-z0-9]+(?:-[a-z0-9]+)*)/gu)) {
      attributes.add(match[1]);
    }
    for (const match of text.matchAll(
      /\bdataset(?:\.([A-Za-z0-9]+)|\[\s*['"]([A-Za-z0-9]+)['"]\s*\])/gu
    )) {
      attributes.add(
        (match[1] ?? match[2]).replace(
          /[A-Z]/gu,
          letter => `-${letter.toLowerCase()}`
        )
      );
    }
    if (file.endsWith('.json')) {
      const leaves = value => {
        if (typeof value === 'string') addString(value, file);
        else if (value && typeof value === 'object') {
          Object.values(value).forEach(leaves);
        }
      };
      try {
        leaves(JSON.parse(text));
      } catch {
        // Not JSON the product reads.
      }
      continue;
    }
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = node => {
      if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
        addString(node.text, file);
      } else if (ts.isTemplateExpression(node)) {
        const parts = [
          node.head,
          ...node.templateSpans.map(span => span.literal),
        ];
        for (const part of parts) addString(part.text, file);
        if (parts.some(part => hasLetters(part.text))) {
          templates.push({
            pattern: new RegExp(
              `^${parts.map(part => escapeRegExp(part.text)).join('.+?')}$`,
              'su'
            ),
            file,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { strings, templates, attributes };
}

/**
 * Where the product writes `text`, or undefined when it never does. A run is
 * product copy when a product string holds it as whole words, or when it is
 * exactly what a product template renders.
 */
function writtenByProduct(product, text) {
  const fold = value => (text.fold ? value.toLowerCase() : value);
  for (const raw of text.runs) {
    const run = fold(raw);
    for (const [candidate, file] of product.strings) {
      if (containsWords(fold(candidate), run)) return file;
    }
    for (const { pattern, file } of product.templates) {
      if (
        text.fold
          ? new RegExp(pattern.source, 'siu').test(raw)
          : pattern.test(raw)
      ) {
        return file;
      }
    }
  }
  return undefined;
}

function copyBindings(sourceFile, checker, file, product) {
  const findings = [];
  const flag = (node, kind, text) => {
    if (!text || carriesMarker(sourceFile, node)) return;
    const writtenIn = writtenByProduct(product, text);
    if (!writtenIn) return;
    findings.push({
      file,
      line: lineOf(sourceFile, node),
      kind,
      copy: text.display.replace(/\s+/gu, ' ').trim(),
      writtenIn,
    });
  };
  const comparesRendered = (node, kind, a, b) => {
    if (a && b && isRenderedText(a, checker)) {
      flag(node, kind, writtenText(b, checker));
      return true;
    }
    return false;
  };
  const selector = (node, text) => {
    if (!COPY_SELECTOR.test(text)) return;
    const values = [
      ...text.matchAll(
        /(?:text=|(?:has-text|text|text-is|text-matches)\(|(?:aria-label|title|placeholder|alt)\s*[*^$|~]?=)\s*["'/]?([^"'\])/]*)/gu
      ),
    ].map(match => match[1].replace(/\u0000/gu, ' ').trim());
    const display = text.replace(/\u0000/gu, '${…}');
    if (values.some(value => !hasLetters(value))) {
      // The copy is computed into the selector, so it cannot be told apart
      // from data; the attribute it reads still holds copy.
      if (!carriesMarker(sourceFile, node)) {
        findings.push({
          file,
          line: lineOf(sourceFile, node),
          kind: 'copy selector',
          copy: display,
          writtenIn: undefined,
        });
      }
      return;
    }
    flag(node, 'copy selector', { display, runs: values, fold: false });
  };
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      const [first, second] = node.arguments;
      const receiver = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.expression
        : undefined;
      if ((TEXT_LOCATORS.has(name) || TEXT_ASSERTIONS.has(name)) && first) {
        flag(node, name, writtenText(first, checker));
      }
      if (name === 'getByRole') {
        for (const option of optionsNamed(second, new Set(['name']))) {
          flag(
            node,
            'getByRole name',
            writtenText(option.initializer, checker)
          );
        }
      }
      for (const argument of node.arguments) {
        for (const option of optionsNamed(argument, TEXT_OPTIONS)) {
          flag(
            node,
            option.name.text,
            writtenText(option.initializer, checker)
          );
        }
      }
      if (TEXT_COMPARISONS.has(name) && receiver) {
        comparesRendered(node, `rendered text ${name}`, receiver, first);
      }
      if (name === 'test' && receiver) {
        comparesRendered(node, 'rendered text test', first, receiver);
      }
      if (ASSERT_COMPARISONS.has(name)) {
        const subject =
          receiver &&
          ts.isCallExpression(receiver) &&
          calledName(receiver) === 'expect'
            ? receiver.arguments[0]
            : undefined;
        if (subject) {
          comparesRendered(node, `rendered text ${name}`, subject, first);
        } else if (
          !comparesRendered(node, `rendered text ${name}`, first, second)
        ) {
          comparesRendered(node, `rendered text ${name}`, second, first);
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind) &&
      !comparesRendered(node, 'rendered text equality', node.left, node.right)
    ) {
      comparesRendered(node, 'rendered text equality', node.right, node.left);
    }
    if (ts.isStringLiteralLike(node)) selector(node, node.text);
    if (ts.isTemplateExpression(node)) {
      selector(
        node,
        [node.head, ...node.templateSpans.map(span => span.literal)]
          .map(part => part.text)
          .join('\u0000')
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/* ---- Rule 3: rendered handles ------------------------------------------- */

/** Every `data-*` attribute name an eval selects on, with where. */
function selectedAttributes(sourceFile, file) {
  const out = [];
  const visit = node => {
    const text = ts.isStringLiteralLike(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? [node.head, ...node.templateSpans.map(span => span.literal)]
            .map(part => part.text)
            .join('\u0000')
        : undefined;
    for (const match of text?.matchAll(DATA_SELECTOR) ?? []) {
      out.push({ file, line: lineOf(sourceFile, node), attribute: match[1] });
    }
    if (ts.isCallExpression(node) && calledName(node) === 'getByTestId') {
      out.push({ file, line: lineOf(sourceFile, node), attribute: 'testid' });
    }
    if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
    else node.templateSpans.forEach(span => visit(span.expression));
  };
  visit(sourceFile);
  return out;
}

/* ---- The check ---------------------------------------------------------- */

/**
 * `scripts`, `declarations` and `product` map a repository-relative path to
 * its text: the eval scripts, the declaration of `window.electron`, and the
 * product source whose copy and attributes the evals are held to.
 */
export function checkEvalHandles({
  scripts,
  declarations,
  product,
  root = ROOT,
  bridgeDirectory = BRIDGE_DIRECTORY,
}) {
  const pageCode = pageCodeStrings(scripts);
  const all = new Map(scripts);
  for (const [file, code] of pageCode) all.set(file, code.text);
  const { program, checker } = createChecker(all, declarations, root);
  const bridge = bridgeMembers({
    program,
    checker,
    files: [...all.keys()],
    origins: pageCode,
    root,
    bridgeDirectory,
  });
  const written = productCopy(product);
  const copy = [];
  const handles = [];
  for (const file of scripts.keys()) {
    const sourceFile = program.getSourceFile(path.resolve(root, file));
    if (!sourceFile) continue;
    copy.push(...copyBindings(sourceFile, checker, file, written));
    handles.push(
      ...selectedAttributes(sourceFile, file).filter(
        found => !written.attributes.has(found.attribute)
      )
    );
  }
  return { bridge, copy, handles };
}

async function filesUnder(root, directory, accept) {
  const out = [];
  let entries;
  try {
    entries = await readdir(path.join(root, directory), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '__tests__' ||
      entry.name.startsWith('.') ||
      entry.name.startsWith('dist')
    ) {
      continue;
    }
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await filesUnder(root, relative, accept)));
    } else if (accept(relative)) out.push(relative);
  }
  return out;
}

async function readAll(root, files) {
  const out = new Map();
  for (const file of files.sort()) {
    out.set(file, await readFile(path.join(root, file), 'utf8'));
  }
  return out;
}

/** The eval scripts, the bridge declaration, and the product they drive. */
async function readEvalTree(root = ROOT) {
  const scripts = await readAll(
    root,
    await filesUnder(
      root,
      'scripts',
      file => file.endsWith('.mjs') && !isTest(file)
    )
  );
  const declarations = await readAll(root, [WINDOW_DECLARATION]);
  const productFiles = [];
  for (const directory of PRODUCT_ROOTS) {
    productFiles.push(
      ...(await filesUnder(
        root,
        directory,
        file => /\.(?:tsx?|json)$/u.test(file) && !isTest(file)
      ))
    );
  }
  return {
    scripts,
    declarations,
    product: await readAll(root, productFiles),
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const tree = await readEvalTree();
  // Named scripts narrow the report to themselves; the tree is still read
  // whole, because a script's bindings resolve against all of it.
  const only = new Set(process.argv.slice(2).map(file => normalized(file)));
  const mine = found => only.size === 0 || only.has(found.file);
  const result = checkEvalHandles(tree);
  const bridge = {
    reached: result.bridge.reached.filter(mine),
    missing: result.bridge.missing.filter(mine),
  };
  const copy = result.copy.filter(mine);
  const handles = result.handles.filter(mine);
  const sections = [];
  if (bridge.missing.length > 0) {
    sections.push(
      `${bridge.missing.length} desktop-bridge member(s) an eval reaches are not on the bridge (${WINDOW_DECLARATION}):\n${bridge.missing
        .map(
          found =>
            `  ${found.file}:${found.line}  ${found.owner}.${found.member}${found.closest ? `, did you mean ${found.closest}?` : ''}`
        )
        .join('\n')}`
    );
  }
  if (copy.length > 0) {
    sections.push(
      `${copy.length} locator(s) bound to product copy. Find the element by a handle it renders (a registry id, a data-* attribute, a role), or say why the text is the contract with \`// binds-text: <reason>\` on the line:\n${copy
        .map(
          found =>
            `  ${found.file}:${found.line}  ${found.kind}  ${found.copy}${found.writtenIn ? `  (${found.writtenIn})` : ''}`
        )
        .join('\n')}`
    );
  }
  if (handles.length > 0) {
    sections.push(
      `${handles.length} data-* attribute(s) an eval selects on that no product source renders:\n${handles
        .map(found => `  ${found.file}:${found.line}  data-${found.attribute}`)
        .join('\n')}`
    );
  }
  if (sections.length > 0) {
    process.stderr.write(
      `[eval-handles] ${sections.join('\n[eval-handles] ')}\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `[eval-handles] ${only.size || tree.scripts.size} scripts; ${bridge.reached.length} desktop-bridge member(s) checked; no copy-bound locators; every selected data-* attribute is rendered\n`
    );
  }
}
