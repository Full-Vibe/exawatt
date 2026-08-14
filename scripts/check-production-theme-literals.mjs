#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const NON_PRODUCTION_PREFIXES = [
  'src/app/eval/',
  'src/app/hud-gallery/',
  'src/generated/',
];
const NON_PRODUCTION_FILES = new Set([
  'src/components/hud/board-tile-study.tsx',
  'src/components/hud/gallery-fixtures.ts',
  'src/components/hud/project-ribbon-study.tsx',
  'src/components/hud/ribbon-dogfood-bench.tsx',
  'src/components/hud/session-state-tile-study.tsx',
  'src/components/hud/webgl/agent-field-regimes.tsx',
  'src/components/hud/webgl/agent-field.tsx',
  'src/components/hud/webgl/keyswitch-study.tsx',
  'src/components/hud/webgl/scenes.tsx',
  'src/components/readiness/gallery-study.tsx',
  'src/components/status-light/specimens.tsx',
]);

/**
 * Raw paint still owned outside the application theme contract. Each exception
 * is deliberately file-scoped and capped: removing literals is always legal;
 * adding one, or adding a new exception file, requires an explicit review here.
 */
export const PRODUCTION_LITERAL_EXCEPTIONS = {
  // Standalone/failure documents cannot assume the hydrated appearance root.
  'src/app/auth/electron-callback/route.ts': {
    max: 6,
    reason: 'self-contained OAuth completion HTML before app hydration',
  },
  // Public marketing owns an art-directed palette, not app-chrome state.
  // Keep its existing paint bounded independently.
  'src/app/page.tsx': {
    max: 7,
    reason: 'public home art direction outside the command-app theme surface',
  },

  // /architecture uses persistent layer/status identity as data. Its canvas
  // is legacy design-system debt; the cap prevents that private palette from
  // spreading while ENG-036 owns any future migration.
  'src/app/architecture/page.tsx': {
    max: 22,
    reason: 'bounded architecture-map layer/status palette and legacy canvas',
  },
  'src/lib/architecture/manifest.ts': {
    max: 6,
    reason: 'architecture-map layer identity stored as data',
  },

  // Concrete semantic/data authorities. Production DOM consumers must use
  // their generated CSS projections; spatial/color math may need concrete
  // sRGB values and Project/brand identity must not change with themes.
  'src/components/consumption/demo-source.ts': {
    max: 4,
    reason: 'Demo Project identity fixture data',
  },
  'src/components/consumption/flux.ts': {
    max: 16,
    reason: 'concrete Consumption sRGB authority and interpolation helpers',
  },
  'src/components/hud/tokens.ts': {
    max: 28,
    reason: 'Classic compatibility authority for non-DOM renderer adapters',
  },
  'src/components/fleet/spatial/spatial-theme.ts': {
    max: 6,
    reason: 'stable Project identity palette for the non-DOM renderer',
  },
  'src/components/readiness/readiness.tsx': {
    max: 1,
    reason: 'canonical readiness metadata value, distinct from theme paint',
  },
  'src/components/status-light/protocol.ts': {
    max: 10,
    reason: 'canonical D40 protocol/source metadata values',
  },
  'src/components/workspace/harness-icons.tsx': {
    max: 5,
    reason: 'third-party harness brand artwork',
  },
  'src/components/workspace/harnesses.ts': {
    max: 1,
    reason: 'persisted harness identity data',
  },
  'src/components/workspace/project-colors.ts': {
    max: 10,
    reason: 'persisted Project identity palette',
  },
  'src/components/workspace/source-identity-mark.tsx': {
    max: 2,
    reason:
      'fixed accessible backing plate for stable third-party Agent Source brand colors',
  },
  'src/lib/appearance/color.ts': {
    max: 2,
    reason: 'mathematical black/white contrast-correction endpoints',
  },

  // Alpha masks use black as opacity math, not visible theme paint.
  'src/components/workspace/tab-strip.tsx': {
    max: 2,
    reason: 'CSS alpha-mask stops, not rendered color',
  },

  // These source-shared empty/demo states still carry Classic fallback paint.
  // They are bounded legacy debt; no new file may copy it.
  'src/app/workspace/page.tsx': {
    max: 1,
    reason: 'bounded pre-provider Workspace suspense fallback',
  },
  'src/lib/tenancy/workspace-scope-gate.tsx': {
    max: 1,
    reason: 'bounded tenant-empty-state Classic fallback debt',
  },
  'src/lib/demo-workspace/demo-session-pane.tsx': {
    max: 9,
    reason: 'bounded Demo transcript identity and Classic chrome debt',
  },
  'src/lib/demo-workspace/demo-workspace-client.tsx': {
    max: 6,
    reason: 'bounded Demo Workspace identity and Classic chrome debt',
  },
  'src/lib/demo-workspace/model.ts': {
    max: 1,
    reason: 'Demo Project identity fallback data',
  },
};

const COLOR_PATTERN =
  /#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;
const EXA_VAR_FALLBACK_PATTERN =
  /var\(\s*--exa-[\w-]+\s*,\s*(?:#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\([^)]*\))\s*\)/gi;

function normalizedPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export function isProductionThemeSource(relativePath) {
  const file = normalizedPath(relativePath);
  if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
  if (NON_PRODUCTION_PREFIXES.some(prefix => file.startsWith(prefix))) {
    return false;
  }
  if (NON_PRODUCTION_FILES.has(file)) return false;
  return !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(file);
}

function blankThemeFallbacks(value) {
  return value.replace(EXA_VAR_FALLBACK_PATTERN, match =>
    ' '.repeat(match.length)
  );
}

export function findColorLiteralsInSource(source, relativePath) {
  if (!isProductionThemeSource(relativePath)) return [];
  const kind = relativePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  const findings = [];

  function inspect(node) {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail;
    if (isLiteral) {
      const value = blankThemeFallbacks(node.text);
      for (const match of value.matchAll(COLOR_PATTERN)) {
        const start = node.getStart(sourceFile) + (match.index ?? 0);
        const location = sourceFile.getLineAndCharacterOfPosition(start);
        findings.push({
          file: normalizedPath(relativePath),
          line: location.line + 1,
          literal: match[0],
        });
      }
    }
    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
  return findings;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else files.push(absolute);
  }
  return files;
}

export function unexpectedThemeLiterals(
  findings,
  exceptions = PRODUCTION_LITERAL_EXCEPTIONS
) {
  const byFile = new Map();
  for (const finding of findings) {
    const bucket = byFile.get(finding.file) ?? [];
    bucket.push(finding);
    byFile.set(finding.file, bucket);
  }

  const unexpected = [];
  for (const [file, fileFindings] of byFile) {
    const exception = exceptions[file];
    if (!exception || fileFindings.length > exception.max) {
      unexpected.push(...fileFindings);
    }
  }
  return unexpected;
}

export async function checkProductionThemeLiterals(root = ROOT) {
  const files = await sourceFiles(path.join(root, 'src'));
  const findings = [];
  for (const absolute of files.sort()) {
    const relative = normalizedPath(path.relative(root, absolute));
    if (!isProductionThemeSource(relative)) continue;
    findings.push(
      ...findColorLiteralsInSource(await readFile(absolute, 'utf8'), relative)
    );
  }
  return {
    findings,
    unexpected: unexpectedThemeLiterals(findings),
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { findings, unexpected } = await checkProductionThemeLiterals();
  if (unexpected.length > 0) {
    const grouped = new Map();
    for (const finding of unexpected) {
      const bucket = grouped.get(finding.file) ?? [];
      bucket.push(finding);
      grouped.set(finding.file, bucket);
    }
    const details = [...grouped]
      .map(
        ([file, values]) =>
          `${file} (${values.length})\n${values
            .map(value => `  ${value.line}: ${value.literal}`)
            .join('\n')}`
      )
      .join('\n');
    throw new Error(
      `Production theme literal gate failed. Use a generated --exa-* role, or add a narrowly reasoned capped file exception:\n${details}`
    );
  }
  process.stdout.write(
    `[theme-literals] ${findings.length} reviewed raw paint literals; no unreviewed production literals\n`
  );
}
