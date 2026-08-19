/**
 * Executable renderers for Gate A's GENERATED recipes (ENG-030 WP6-D 1a).
 *
 * A GENERATED path is one the public repository must receive as a DERIVED
 * variant rather than as the private blob. `open-source-paths.manifest.json`
 * declares each recipe's `kind`, `inputs`, and `outputs`; this module supplies
 * the missing executable half, so a projection can substitute those bytes
 * without a human reviewing a generated tree per landing.
 *
 * Two constraints shape every renderer here, and neither is negotiable:
 *
 *   1. **Pure function of the source blob at the same path.** The projector
 *      substitutes through `git filter-repo --file-info-callback`, which sees
 *      one `(filename, mode, blob)` triple at a time. A renderer that needed a
 *      second file, the working tree, the clock, or the network could not run
 *      there, and the projection would stop being a pure function of source
 *      history — which is what makes it deterministic and ancestor-stable.
 *   2. **No post-projection overlay commit.** Substituting after the fact
 *      re-parents the public tip on every landing and destroys the
 *      fast-forward property the two-repository mechanism rests on.
 *
 * So each renderer takes the private bytes of an output path and returns the
 * public bytes of that same path. Where the two differ, the difference is
 * declared IN the private file with public-variant directives (see
 * `applyPublicVariantDirectives`) rather than encoded as string surgery here:
 * the editorial judgement then lives where a human already reviews it, in the
 * private diff, and the renderer stays a mechanical, auditable transformation
 * that fails closed when the private file grows something it cannot remove.
 *
 * The directives come in two forms, because the outputs do. A text file
 * declares its public variant in delimited regions written in its own comment
 * syntax — `#`, `//`, or Markdown's `<!-- … -->` — and a JSON file, which has
 * no comments, declares it in a reserved `exawatt:public-variant` member of
 * JSON Pointers. Both are mechanical: resolve, drop, substitute, and assert.
 *
 * Recipes with no renderer are declared, not forgotten. `unrenderedReason`
 * returns why, and the projector reports them; their private blobs are never
 * projected, so the gap is an absence, not a leak.
 */

const DIRECTIVE_NAMESPACE = 'exawatt:public-';
const OMIT_BEGIN = 'exawatt:public-omit-begin';
const OMIT_END = 'exawatt:public-omit-end';
const REPLACE_BEGIN = 'exawatt:public-replace-begin';
const REPLACE_WITH = 'exawatt:public-replace-with';
const REPLACE_END = 'exawatt:public-replace-end';

const DIRECTIVES = [
  OMIT_BEGIN,
  OMIT_END,
  REPLACE_BEGIN,
  REPLACE_WITH,
  REPLACE_END,
];

function fail(message) {
  throw new Error('[recipe-renderers] ' + message);
}

function directiveOn(line) {
  if (!line.includes(DIRECTIVE_NAMESPACE)) return null;
  const found = DIRECTIVES.filter(directive => line.includes(directive));
  // No directive is a substring of another, so more than one match means the
  // line names two directives at once, which has no defined meaning.
  if (found.length !== 1) {
    fail('line names ' + found.length + ' public-variant directives: ' + line);
  }
  return found[0];
}

function decodeText(buffer, path) {
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
    fail('cannot render binary content at ' + path);
  }
  return buffer.toString('utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Reads the comment syntax out of the `-replace-with` line itself, so one
 * directive protocol serves `#`, `//`, and the delimited `<!-- … -->` form
 * Markdown needs. The closing token is optional and empty for line comments.
 */
function commentToken(line, path, at) {
  const match =
    /^(\s*)(\S+)[ \t]+exawatt:public-replace-with[ \t]*(\S*)[ \t]*$/u.exec(line);
  if (!match) {
    fail(path + ':' + at + ' must write ' + REPLACE_WITH + ' after a comment');
  }
  return { open: match[2], close: match[3] };
}

function uncomment(line, token, path, at) {
  const match = new RegExp(
    '^(\\s*)' + escapeRegExp(token.open) + '( ?)(.*)$',
    'u'
  ).exec(line);
  if (!match) {
    fail(
      path + ':' + at + ' replacement line does not start with ' + token.open
    );
  }
  let body = match[3];
  if (token.close !== '') {
    const closed = new RegExp(
      '^(.*?)[ \\t]?' + escapeRegExp(token.close) + '$',
      'u'
    ).exec(body);
    if (!closed) {
      fail(
        path + ':' + at + ' replacement line does not end with ' + token.close
      );
    }
    body = closed[1];
  }
  return body === '' ? '' : match[1] + body;
}

/**
 * Applies the public-variant directives a private file uses to declare how its
 * public variant differs from it.
 *
 *   <comment> exawatt:public-omit-begin <note>
 *   ...lines dropped from the public variant...
 *   <comment> exawatt:public-omit-end
 *
 *   <comment> exawatt:public-replace-begin <note>
 *   ...lines dropped from the public variant...
 *   <comment> exawatt:public-replace-with
 *   <comment> the public lines, written as comments
 *   <comment> exawatt:public-replace-end
 *
 * The comment syntax is read off the `-replace-with` line itself, so Markdown's
 * delimited `<!-- … -->` works alongside `#` and `//` without a second dialect.
 * Replacement lines are emitted with their comment token removed, keeping the
 * indentation the comment itself carried, so the public bytes are legible in
 * the private file exactly as they will be published. Anything malformed —
 * unbalanced markers, a nested region, a replacement line that does not carry
 * the comment token — throws rather than guessing.
 */
export function applyPublicVariantDirectives(source, { path = 'input' } = {}) {
  const lines = source.split('\n');
  const output = [];
  let mode = 'copy';
  let token = null;
  let openedAt = 0;

  for (const [index, line] of lines.entries()) {
    const at = index + 1;
    const directive = directiveOn(line);
    if (directive === null) {
      if (mode === 'copy') output.push(line);
      else if (mode === 'replace-with') {
        output.push(uncomment(line, token, path, at));
      }
      continue;
    }
    if (directive === OMIT_BEGIN || directive === REPLACE_BEGIN) {
      if (mode !== 'copy') {
        fail(
          path + ':' + at + ' opens a public-variant region inside another one'
        );
      }
      mode = directive === OMIT_BEGIN ? 'omit' : 'replace-omit';
      openedAt = at;
      continue;
    }
    if (directive === REPLACE_WITH) {
      if (mode !== 'replace-omit') {
        fail(path + ':' + at + ' has ' + REPLACE_WITH + ' outside a replace');
      }
      token = commentToken(line, path, at);
      mode = 'replace-with';
      continue;
    }
    if (directive === OMIT_END) {
      if (mode !== 'omit') fail(path + ':' + at + ' closes an unopened omit');
      mode = 'copy';
      continue;
    }
    if (mode !== 'replace-with') {
      fail(path + ':' + at + ' closes a replace with no ' + REPLACE_WITH);
    }
    mode = 'copy';
    token = null;
  }

  if (mode !== 'copy') {
    fail(path + ':' + openedAt + ' opens a public-variant region never closed');
  }
  const rendered = output.join('\n');
  if (rendered.includes(DIRECTIVE_NAMESPACE)) {
    fail('rendered variant of ' + path + ' still carries a directive marker');
  }
  return rendered;
}

/**
 * Prepends the one-line notice that tells a reader of the public repository
 * that this file is a projection output. It goes after a shebang, because a
 * shebang is only a shebang on line one, and after YAML front matter, because
 * `exawatt-roadmap: v2` is only front matter when the document opens with it.
 */
function withGeneratedNotice(text, { comment, recipeId }) {
  const notice =
    comment.open +
    ' Generated for the public repository by the "' +
    recipeId +
    '" recipe.' +
    (comment.close === '' ? '' : ' ' + comment.close);
  const lines = text.split('\n');
  if (lines[0]?.startsWith('#!')) {
    return [lines[0], notice, ...lines.slice(1)].join('\n');
  }
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close === -1) fail('front matter opened but never closed');
    return [
      ...lines.slice(0, close + 1),
      notice,
      ...lines.slice(close + 1),
    ].join('\n');
  }
  return [notice, ...lines].join('\n');
}

function assertAbsent(text, forbidden, { path, why }) {
  for (const entry of forbidden) {
    const hit =
      typeof entry.pattern === 'string'
        ? text.includes(entry.pattern)
        : entry.pattern.test(text);
    if (hit) {
      fail(
        'rendered ' +
          path +
          ' still carries ' +
          entry.label +
          '; ' +
          why +
          '. Declare the difference with public-variant directives in the ' +
          'private file.'
      );
    }
  }
}

function literal(pattern) {
  return { pattern, label: '"' + pattern + '"' };
}

/**
 * Private modules and configuration a public-bound output may never reach.
 * Each string names a PRIVATE-classified repository path or the identifier
 * that imports it; `recipe-renderers.test.mjs` proves every one is still
 * PRIVATE in Gate A, so this list cannot rot into terms that mean nothing.
 */
export const PRIVATE_DISTRIBUTION_PATHS = Object.freeze([
  'scripts/lib/exawatt-official-distribution.mjs',
  'scripts/release-package.mjs',
  'scripts/release-notarize.mjs',
  'scripts/release-after-pack.cjs',
  'electron-builder.release.yml',
]);

const PRIVATE_DISTRIBUTION_REFERENCES = Object.freeze([
  ...PRIVATE_DISTRIBUTION_PATHS.map(literal),
  literal('exawatt-official-distribution'),
  literal('requireExawattOfficialPackagedApp'),
  literal('release-after-pack'),
]);

/** The private update feed is service custody, never a public default. */
const PRIVATE_UPDATE_FEED = Object.freeze([literal('supabase.co')]);

/**
 * Path prefixes whose every tracked file is company canon: private evidence,
 * go-to-market, production schema custody, and the release lane. A public
 * document that cites one of them fails decision `0036` §2's standing
 * requirement that public canon never needs a private link to be actionable,
 * so the document-set renderer refuses it rather than publishing a dead link.
 *
 * `recipe-renderers.test.mjs` proves each prefix still covers at least one
 * tracked path and covers nothing that is not PRIVATE, so the list can neither
 * rot into dead terms nor quietly start forbidding public material.
 */
export const PRIVATE_COMPANY_PATH_PREFIXES = Object.freeze([
  '.claude/commands/triage-feedback.md',
  '.github/workflows/release-macos.yml',
  'docs/archive/founder-q-and-a-',
  'docs/engineering/projects/feedback-reinflation.md',
  'docs/engineering/projects/launch-execution.md',
  'docs/engineering/projects/open-source-readiness',
  'docs/engineering/projects/release-macos-cost.md',
  'docs/product/demo-script.md',
  'docs/product/marketing.md',
  'docs/research/market/',
  'docs/research/open-source-comps/',
  'docs/research/operator-briefs/',
  'docs/research/partner-conversations/',
  'scripts/electron-auth-session-eval.mjs',
  'scripts/feedback-triage.mjs',
  'scripts/issue-invite.mjs',
  'scripts/prepare-release-metadata.mjs',
  'scripts/product-feedback-supabase-eval.mjs',
  'scripts/publish-supabase-updates.mjs',
  'scripts/require-official-distribution.mjs',
  'scripts/service-ceiling-quota-eval.mjs',
  'supabase/migrations/',
]);

const PRIVATE_COMPANY_REFERENCES = Object.freeze(
  PRIVATE_COMPANY_PATH_PREFIXES.map(literal)
);

function renderText(source, { path, recipeId, forbidden = [], why }) {
  const rendered = withGeneratedNotice(
    applyPublicVariantDirectives(decodeText(source, path), { path }),
    { comment: commentSyntaxFor(path), recipeId }
  );
  if (forbidden.length > 0) assertAbsent(rendered, forbidden, { path, why });
  return Buffer.from(rendered, 'utf8');
}

function commentSyntaxFor(path) {
  if (path.endsWith('.yml') || path.endsWith('.yaml')) {
    return { open: '#', close: '' };
  }
  if (path.endsWith('.md')) return { open: '<!--', close: '-->' };
  if (
    path.endsWith('.mjs') ||
    path.endsWith('.cjs') ||
    path.endsWith('.js') ||
    path.endsWith('.ts') ||
    path.endsWith('.tsx')
  ) {
    return { open: '//', close: '' };
  }
  fail('no comment syntax is known for ' + path);
}

const JSON_DIRECTIVE_KEY = 'exawatt:public-variant';

function unescapePointerSegment(segment) {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * Resolves a JSON Pointer to its container and final key, failing when the
 * pointer names something the document does not have. A directive that no
 * longer matches the document is a stale judgement, and publishing on a stale
 * judgement is exactly what fail-closed means here.
 */
function resolvePointer(document, pointer, path) {
  if (!pointer.startsWith('/')) {
    fail(path + ' public-variant pointer must start with "/": ' + pointer);
  }
  const segments = pointer.slice(1).split('/').map(unescapePointerSegment);
  let container = document;
  for (const segment of segments.slice(0, -1)) {
    if (
      container === null ||
      typeof container !== 'object' ||
      !Object.hasOwn(container, segment)
    ) {
      fail(path + ' public-variant pointer matches nothing: ' + pointer);
    }
    container = container[segment];
  }
  const key = segments.at(-1);
  if (
    container === null ||
    typeof container !== 'object' ||
    !Object.hasOwn(container, key)
  ) {
    fail(path + ' public-variant pointer matches nothing: ' + pointer);
  }
  return { container, key };
}

/**
 * The JSON form of the same protocol. JSON carries no comments, so a JSON
 * document declares its public variant in a reserved `exawatt:public-variant`
 * member instead of in delimited regions:
 *
 *   "exawatt:public-variant": {
 *     "omit": { "/scripts/invite:issue": "why this entry is company-only" },
 *     "replace": {
 *       "/scripts/test:agent-delivery": { "why": "…", "value": "…" }
 *     }
 *   }
 *
 * The judgement still lives in the private file, reviewed in the private diff,
 * and the renderer stays mechanical: resolve, delete, set, drop the directive
 * member itself. Every pointer must match, so a directive cannot rot into a
 * silent no-op while the document moves out from under it.
 */
export function applyPublicVariantJsonDirectives(source, { path = 'input' }) {
  let document;
  try {
    document = JSON.parse(source);
  } catch (error) {
    fail(path + ' is not valid JSON: ' + error.message);
  }
  const directive = document[JSON_DIRECTIVE_KEY];
  if (directive === undefined) {
    fail(
      path +
        ' must declare its public variant in a "' +
        JSON_DIRECTIVE_KEY +
        '" member; JSON carries no comments to declare it in'
    );
  }
  delete document[JSON_DIRECTIVE_KEY];

  for (const pointer of Object.keys(directive.omit ?? {})) {
    const { container, key } = resolvePointer(document, pointer, path);
    delete container[key];
  }
  for (const [pointer, entry] of Object.entries(directive.replace ?? {})) {
    const { container, key } = resolvePointer(document, pointer, path);
    if (!Object.hasOwn(entry ?? {}, 'value')) {
      fail(path + ' public-variant replace needs a "value": ' + pointer);
    }
    container[key] = entry.value;
  }

  const rendered = JSON.stringify(document, null, 2) + '\n';
  if (rendered.includes(DIRECTIVE_NAMESPACE)) {
    fail('rendered variant of ' + path + ' still carries a directive marker');
  }
  return rendered;
}

function renderJson(source, { path, recipeId, forbidden = [], why }) {
  // A JSON document has nowhere to carry the generated-file notice the text
  // renderers prepend; `recipeId` stays in the signature so every renderer is
  // called the same way.
  void recipeId;
  const rendered = applyPublicVariantJsonDirectives(decodeText(source, path), {
    path,
  });
  if (forbidden.length > 0) assertAbsent(rendered, forbidden, { path, why });
  return Buffer.from(rendered, 'utf8');
}

const RENDERERS = new Map([
  [
    'render-public-ci',
    {
      renders: path => path === '.github/workflows/ci.yml',
      render: (path, source, recipeId) => {
        const rendered = renderText(source, {
          path,
          recipeId,
          forbidden: [
            {
              pattern: /\$\{\{\s*secrets\./u,
              label: 'a `secrets.` expression',
            },
            {
              pattern: /^\s*pull_request_target:/mu,
              label: 'a `pull_request_target` trigger',
            },
          ],
          why:
            'public CI runs on an outside contributor’s fork, where GitHub ' +
            'withholds repository secrets, and `pull_request_target` runs a ' +
            'stranger’s code with this repository’s credentials',
        });
        const text = rendered.toString('utf8');
        if (!/^permissions:$/mu.test(text)) {
          fail(
            'rendered ' +
              path +
              ' must declare least-privilege `permissions:` rather than ' +
              'inherit the repository default'
          );
        }
        return rendered;
      },
    },
  ],
  [
    'render-community-brand',
    {
      renders: path => path === 'electron-builder.yml',
      unrenderable: path =>
        path.endsWith('.png') || path.endsWith('.icns')
          ? 'the community application mark is a designed artifact, not a ' +
            'transformation of the official mark. A pure function of the ' +
            'official icon bytes could only republish the official mark or ' +
            'invent a brand, and neither is this projector’s call.'
          : null,
      render: (path, source, recipeId) =>
        renderText(source, {
          path,
          recipeId,
          forbidden: [...PRIVATE_UPDATE_FEED, literal('publish:')],
          why:
            'the update feed is private distribution custody, and a community ' +
            'build resolves `publish` from its own distribution contract',
        }),
    },
  ],
  [
    'render-distribution-driven-dogfood-tooling',
    {
      renders: () => true,
      render: (path, source, recipeId) =>
        renderText(source, {
          path,
          recipeId,
          forbidden: [
            ...PRIVATE_DISTRIBUTION_REFERENCES,
            ...PRIVATE_UPDATE_FEED,
          ],
          why:
            'the public dogfood tooling resolves its package from the ' +
            'distribution contract and must not reach a private official pin',
        }),
    },
  ],
  [
    'render-public-document-set',
    {
      // `scripts/delivery-documentation.test.mjs` is a document by subject: it
      // pins the prose contract in `AGENTS.md`, so it moves with the set.
      // README.md renders like every other document here. The exclusion this
      // replaces was written when the private README WAS an internal index,
      // and rendering it would have published a table of contents as a front
      // door. That premise expired on 2026-08-18, when the private README was
      // rewritten as the public one: it now opens with what the app is, for a
      // stranger, and references nothing private. So the public and private
      // README are the same document and the honest transform is the identity.
      //
      // A public repository with NO README is strictly worse than one with a
      // plain, true README, and the launch lane's crafted version replaces
      // this file rather than needing a separate path for it.
      renders: () => true,
      unrenderable: () => null,
      render: (path, source, recipeId) => {
        const render = path.endsWith('.json') ? renderJson : renderText;
        const rendered = render(source, {
          path,
          recipeId,
          forbidden: [
            ...PRIVATE_COMPANY_REFERENCES,
            ...PRIVATE_DISTRIBUTION_REFERENCES,
            ...PRIVATE_UPDATE_FEED,
          ],
          why:
            'a public document may keep what a contributor needs in order to ' +
            'understand, modify, test, or contribute to the public ' +
            'application, and what describes the public or official client’s ' +
            'observable behaviour, but never company canon, private evidence, ' +
            'production topology, or release custody (decision `0036` §2)',
        });
        // A removed region must leave the document it came from intact, not a
        // seam. Three newlines in a row means a directive swallowed content on
        // one side of a blank line and not the other, which is exactly the
        // mistake a reviewer of the private diff cannot see.
        if (path.endsWith('.md')) {
          const text = rendered.toString('utf8');
          const seam = /\n{3}/u.test(text)
            ? 'a blank-line seam'
            : /^#{1,6} .*\n[^\n]/mu.test(text)
              ? 'a heading with no blank line under it'
              : null;
          if (seam !== null) {
            fail(
              'rendered ' +
                path +
                ' has ' +
                seam +
                ' where a public-variant region was removed; move the marker ' +
                'so the region consumes exactly the blank lines it should'
            );
          }
        }
        return rendered;
      },
    },
  ],
  [
    'render-public-update-config-test',
    {
      renders: path => path === 'scripts/app-update-config.test.mjs',
      render: (path, source, recipeId) =>
        renderText(source, {
          path,
          recipeId,
          forbidden: [
            ...PRIVATE_DISTRIBUTION_REFERENCES,
            ...PRIVATE_UPDATE_FEED,
          ],
          why:
            'the public update contract is generic; the official release ' +
            'profile and the shipped feed are private custody',
        }),
    },
  ],
  [
    'regenerate-public-lockfile-after-public-package',
    {
      // The public lockfile is the private one, byte for byte, and that is a
      // fact rather than a hope: the public `package.json` prunes only
      // `scripts`, and pnpm keys importers by dependency graph, so the two
      // trees resolve identically. `recipe-renderers.test.mjs` asserts the
      // dependency sections are identical between the private and rendered
      // public `package.json`, which is the premise this identity rests on —
      // if a future change ever prunes a DEPENDENCY, that test fails and this
      // recipe must become a real resolver rather than silently publishing a
      // lockfile for a tree nobody built.
      renders: () => true,
      unrenderable: () => null,
      render: (path, source) => source,
    },
  ],
  [
    'project-public-path-manifest',
    {
      // A pure function of the manifest blob after all: drop every PRIVATE and
      // EXCLUDED rule and exception, keep PUBLIC and GENERATED.
      //
      // The earlier reasoning said this needed the whole tracked tree, because
      // it wanted to prune rules matching no projected path. It does not: the
      // public tree contains only paths those PUBLIC and GENERATED rules
      // classified, so keeping exactly those rules covers exactly those paths.
      // Pruning by classification is both sufficient and better, because the
      // published manifest then stops naming the private directories, which
      // the path-matching version would have kept describing.
      renders: () => true,
      unrenderable: () => null,
      render: (path, source) => {
        const manifest = JSON.parse(source.toString('utf8'));
        // In the public repository nothing is generated: a GENERATED path is
        // just a file that exists, because rendering happened privately before
        // it got there. So the public manifest classifies everything PUBLIC and
        // carries no `recipes` at all.
        //
        // Dropping recipes is not tidiness. A recipe declares its INPUTS, and
        // several read private release-custody files in order to prove a public
        // output does not reference them — so a manifest that kept its recipes
        // would publish the names of the private files it exists to keep out.
        // An entry survives only if its paths can actually EXIST in the public
        // tree. PUBLIC always can. GENERATED can only when its recipe renders
        // that path: the official brand marks are declared GENERATED and have
        // no renderer on purpose, so they never arrive, and a manifest that
        // still named them would carry an exception matching nothing.
        //
        // This is the third face of one mistake. The original recipe reason
        // said pruning needed the whole tracked tree; it was dismissed twice as
        // unnecessary, and both dismissals were wrong in a different direction:
        // once for EXCLUDES naming dropped territory, once for GENERATED paths
        // that never render. Includes were the only part that was safe, because
        // an include only ever names territory that survives with it.
        const renderedPaths = new Set();
        for (const [, recipe] of Object.entries(manifest.recipes ?? {})) {
          for (const output of recipe.outputs ?? []) {
            if (rendersOutput(recipe.kind, output.path)) {
              renderedPaths.add(output.path);
            }
          }
        }
        const keep = entry => {
          if (entry.classification === 'PUBLIC') return true;
          if (entry.classification !== 'GENERATED') return false;
          // A GENERATED rule (rather than an exact exception) covers globs; keep
          // it, because its own outputs are enumerated by the recipe above.
          return entry.path === undefined || renderedPaths.has(entry.path);
        };
        // Everything a dropped rule or exception used to claim. A surviving
        // rule's `exclude` that names one of these is now STALE: it carves out
        // territory the public tree does not contain, and the manifest
        // validator rejects a pattern that matches nothing.
        //
        // The public repository's own CI found this on its first run
        // (2026-08-19): `public-documentation` excluded
        // `docs/engineering/incidents/**`, which exists only privately. This is
        // the "prune rules that match no projected path" the original recipe
        // reason warned about — unnecessary for INCLUDES, which only ever name
        // surviving territory, and necessary for EXCLUDES, which name absent
        // territory by construction.
        const droppedClaims = new Set([
          ...(manifest.rules ?? [])
            .filter(entry => !keep(entry))
            .flatMap(entry => entry.include ?? []),
          ...(manifest.exceptions ?? [])
            .filter(entry => !keep(entry))
            .map(entry => entry.path),
        ]);
        const publicize = entry => {
          const { recipe, ...rest } = entry;
          const exclude = (entry.exclude ?? []).filter(
            pattern => !droppedClaims.has(pattern)
          );
          return {
            ...rest,
            ...(entry.exclude === undefined ? {} : { exclude }),
            classification: 'PUBLIC',
          };
        };
        const rules = (manifest.rules ?? []).filter(keep).map(publicize);
        const exceptions = (manifest.exceptions ?? [])
          .filter(keep)
          .map(publicize);
        // `recipes` stays as an EMPTY object rather than being removed: the
        // manifest schema requires the key, and the public repository
        // validates its own manifest with the same validator.
        return Buffer.from(
          JSON.stringify(
            { ...manifest, rules, exceptions, recipes: {} },
            null,
            2
          ) + '\n',
          'utf8'
        );
      },
    },
  ],
]);

/**
 * Why a recipe kind has no renderer. These are decisions, not omissions: each
 * names what would have to change for the recipe to become executable, so the
 * next agent does not rediscover the reasoning.
 */
export const UNRENDERED_RECIPE_KINDS = new Map([
  [
    'render-public-launch-pages',
    'the privacy and terms pages are legal statements about one operator’s ' +
      'hosted service: its processors, its contact addresses, its retention. ' +
      'A public fork must not inherit them as its own, and no pure function of ' +
      'the private bytes can write a fork’s policy for it.',
  ],
]);

/** Every recipe kind this module can execute. */
export const RECIPE_RENDERER_KINDS = Object.freeze([...RENDERERS.keys()]);

export function hasRecipeRenderer(kind) {
  return RENDERERS.has(kind);
}

/** True when `kind` can render `path`. */
export function rendersOutput(kind, path) {
  const renderer = RENDERERS.get(kind);
  if (!renderer) return false;
  return renderer.renders(path) === true;
}

/**
 * Why `path` is not rendered, or null when it is. Throws for a kind nobody has
 * decided about, so a new recipe cannot be silently dropped from the public
 * repository.
 */
export function unrenderedReason(kind, path) {
  if (rendersOutput(kind, path)) return null;
  const renderer = RENDERERS.get(kind);
  if (renderer) {
    const reason = renderer.unrenderable?.(path) ?? null;
    if (reason) return reason;
    fail(
      'recipe kind ' +
        kind +
        ' neither renders nor explains output ' +
        path +
        '; declare it in the renderer or give it its own recipe'
    );
  }
  const declared = UNRENDERED_RECIPE_KINDS.get(kind);
  if (declared) return declared;
  fail(
    'unknown recipe kind ' +
      kind +
      '; every kind must either render its outputs or record why it cannot'
  );
}

/**
 * Renders one output path from the private bytes at that same path.
 *
 * This is the unit the projector's file-info callback calls, and the reason a
 * renderer can run inside one: it sees a single path and a single buffer.
 */
export function renderRecipeOutput({ recipeId, kind, path, source }) {
  const renderer = RENDERERS.get(kind);
  if (!renderer || renderer.renders(path) !== true) {
    fail('recipe kind ' + kind + ' does not render ' + path);
  }
  if (!Buffer.isBuffer(source)) {
    fail('renderer input for ' + path + ' must be a Buffer');
  }
  return renderer.render(path, source, recipeId);
}

/**
 * The recipe-level shape: `(inputs: Map<path, Buffer>) => Map<path, Buffer>`.
 *
 * Every renderable output is keyed by its own path in both maps, which is what
 * lets the projection substitute blob by blob. Outputs this kind does not
 * render are absent from the result and explained by `unrenderedReason`.
 */
export function renderRecipe({ recipeId, recipe, inputs }) {
  if (!recipe || typeof recipe.kind !== 'string') {
    fail('renderRecipe requires the manifest recipe for ' + recipeId);
  }
  if (!(inputs instanceof Map)) fail('renderRecipe inputs must be a Map');
  const outputs = new Map();
  for (const output of recipe.outputs) {
    if (!rendersOutput(recipe.kind, output.path)) {
      unrenderedReason(recipe.kind, output.path);
      continue;
    }
    const source = inputs.get(output.path);
    if (!Buffer.isBuffer(source)) {
      fail(
        'recipe ' +
          recipeId +
          ' renders ' +
          output.path +
          ' from the private bytes at that same path, which were not supplied'
      );
    }
    outputs.set(
      output.path,
      renderRecipeOutput({
        recipeId,
        kind: recipe.kind,
        path: output.path,
        source,
      })
    );
  }
  return outputs;
}
