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

function commentToken(line, path, at) {
  const match = /^(\s*)(\S+)\s+exawatt:public-replace-with\b/u.exec(line);
  if (!match) {
    fail(path + ':' + at + ' must write ' + REPLACE_WITH + ' after a comment');
  }
  return match[2];
}

function uncomment(line, token, path, at) {
  const match = new RegExp(
    '^(\\s*)' + escapeRegExp(token) + '( ?)(.*)$',
    'u'
  ).exec(line);
  if (!match) {
    fail(path + ':' + at + ' replacement line does not start with ' + token);
  }
  const body = match[3];
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
 * shebang is only a shebang on line one.
 */
function withGeneratedNotice(text, { comment, recipeId }) {
  const notice =
    comment +
    ' Generated for the public repository by the "' +
    recipeId +
    '" recipe.';
  const lines = text.split('\n');
  if (lines[0]?.startsWith('#!')) {
    return [lines[0], notice, ...lines.slice(1)].join('\n');
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

function renderText(source, { path, recipeId, forbidden = [], why }) {
  const rendered = withGeneratedNotice(
    applyPublicVariantDirectives(decodeText(source, path), { path }),
    { comment: commentSyntaxFor(path), recipeId }
  );
  if (forbidden.length > 0) assertAbsent(rendered, forbidden, { path, why });
  return Buffer.from(rendered, 'utf8');
}

function commentSyntaxFor(path) {
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return '#';
  if (
    path.endsWith('.mjs') ||
    path.endsWith('.cjs') ||
    path.endsWith('.js') ||
    path.endsWith('.ts') ||
    path.endsWith('.tsx')
  ) {
    return '//';
  }
  fail('no comment syntax is known for ' + path);
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
]);

/**
 * Why a recipe kind has no renderer. These are decisions, not omissions: each
 * names what would have to change for the recipe to become executable, so the
 * next agent does not rediscover the reasoning.
 */
export const UNRENDERED_RECIPE_KINDS = new Map([
  [
    'render-public-document-set',
    'the public variant of this 21-document set (roadmap, vision, README, ' +
      'AGENTS.md, package.json) needs editorial judgement about business ' +
      'posture, operator-only state, and citations of private research. A ' +
      'mechanical transformation would either copy the private prose or ' +
      'invent public prose. It becomes renderable once each document declares ' +
      'its private regions with public-variant directives.',
  ],
  [
    'render-public-launch-pages',
    'the privacy and terms pages are legal statements about one operator’s ' +
      'hosted service: its processors, its contact addresses, its retention. ' +
      'A public fork must not inherit them as its own, and no pure function of ' +
      'the private bytes can write a fork’s policy for it.',
  ],
  [
    'regenerate-public-lockfile-after-public-package',
    'a lockfile is resolver output, not a text transformation. It becomes a ' +
      'verbatim copy guarded by a package-graph equality assertion the moment ' +
      'the public `package.json` renders: pnpm records importers by dependency ' +
      'graph, not by `scripts`, so a public package.json that only prunes ' +
      'script entries resolves to the identical lockfile. A real resolver is ' +
      'needed only if the public package graph ever drops a dependency, and ' +
      'guessing that would publish a lockfile installing a tree nobody built.',
  ],
  [
    'project-public-path-manifest',
    '`projectPublicPathManifest` is already automatic, but it is a function of ' +
      'the whole tracked tree at a commit — it prunes rules and exceptions ' +
      'that match no projected path — not of the manifest blob alone. The ' +
      'file-info callback sees one blob at a time, so this output needs either ' +
      'a commit-scoped substitution or a manifest projection that no longer ' +
      'prunes against the tree.',
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
