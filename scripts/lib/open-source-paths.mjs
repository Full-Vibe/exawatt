import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { minimatch } from 'minimatch';

export const OPEN_SOURCE_PATH_MANIFEST =
  'scripts/open-source-paths.manifest.json';

export const PATH_CLASSIFICATIONS = new Set([
  'PUBLIC',
  'PRIVATE',
  'GENERATED',
  'EXCLUDED',
]);

const OUTPUT_MODES = new Set(['100644', '100755', '120000']);
const MATCH_OPTIONS = Object.freeze({
  dot: true,
  matchBase: false,
  nocase: false,
  nocomment: true,
  nonegate: true,
});

function fail(message) {
  throw new Error('[open-source-paths] ' + message);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(label + ' must be an object');
  }
}

function assertKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(label + ' has unsupported field(s): ' + unexpected.join(', '));
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(label + ' must be a non-empty string');
  }
}

function assertStringArray(value, label, { empty = false } = {}) {
  if (!Array.isArray(value) || (!empty && value.length === 0)) {
    fail(label + ' must be ' + (empty ? 'an' : 'a non-empty') + ' array');
  }
  for (const [index, entry] of value.entries()) {
    assertString(entry, label + '[' + index + ']');
  }
}

function assertClassification(value, label) {
  if (!PATH_CLASSIFICATIONS.has(value)) {
    fail(
      label +
        ' must be one of ' +
        [...PATH_CLASSIFICATIONS].join(', ') +
        '; received ' +
        String(value)
    );
  }
}

export function normalizeRepositoryPath(value, label = 'path') {
  assertString(value, label);
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.split('/').some(segment => segment === '' || segment === '..')
  ) {
    fail(label + ' must be a normalized repository-relative path: ' + value);
  }
  return value;
}

function validatePattern(value, label) {
  normalizeRepositoryPath(value, label);
  if (value === '*' || value === '**' || value === '**/*') {
    fail(label + ' cannot be a repository-wide catch-all');
  }
  if (value.startsWith('!') || value.startsWith('#')) {
    fail(label + ' cannot use negation or comment syntax');
  }
}

function matches(file, pattern) {
  return minimatch(file, pattern, MATCH_OPTIONS);
}

function validateRecipeReference(entry, label, recipes) {
  if (entry.classification === 'GENERATED') {
    assertString(entry.recipe, label + '.recipe');
    if (!recipes[entry.recipe]) {
      fail(label + '.recipe references unknown recipe ' + entry.recipe);
    }
    return;
  }
  if (entry.recipe !== undefined) {
    fail(label + '.recipe is only valid for GENERATED entries');
  }
}

function validateContentPolicy(entry, label) {
  if (entry.contentPolicy === undefined) return;
  if (!['PUBLIC', 'GENERATED'].includes(entry.classification)) {
    fail(label + '.contentPolicy is only valid for public-bound paths');
  }
  assertObject(entry.contentPolicy, label + '.contentPolicy');
  assertKeys(
    entry.contentPolicy,
    ['allowThirdPartyEmailMetadata'],
    label + '.contentPolicy'
  );
  if (entry.contentPolicy.allowThirdPartyEmailMetadata !== true) {
    fail(
      label +
        '.contentPolicy.allowThirdPartyEmailMetadata must be true when present'
    );
  }
}

export function validatePathManifest(manifest) {
  assertObject(manifest, 'manifest');
  assertKeys(
    manifest,
    ['schemaVersion', 'rules', 'exceptions', 'recipes'],
    'manifest'
  );
  if (manifest.schemaVersion !== 1) {
    fail('manifest.schemaVersion must be 1');
  }
  if (!Array.isArray(manifest.rules)) fail('manifest.rules must be an array');
  if (!Array.isArray(manifest.exceptions)) {
    fail('manifest.exceptions must be an array');
  }
  assertObject(manifest.recipes, 'manifest.recipes');

  const recipeIds = new Set();
  const recipeOutputs = new Map();
  for (const [id, recipe] of Object.entries(manifest.recipes)) {
    assertString(id, 'recipe id');
    if (recipeIds.has(id)) fail('duplicate recipe id ' + id);
    recipeIds.add(id);
    assertObject(recipe, 'recipes.' + id);
    assertKeys(recipe, ['kind', 'inputs', 'outputs'], 'recipes.' + id);
    assertString(recipe.kind, 'recipes.' + id + '.kind');
    assertStringArray(recipe.inputs, 'recipes.' + id + '.inputs');
    if (!Array.isArray(recipe.outputs) || recipe.outputs.length === 0) {
      fail('recipes.' + id + '.outputs must be a non-empty array');
    }
    for (const [index, input] of recipe.inputs.entries()) {
      normalizeRepositoryPath(
        input,
        'recipes.' + id + '.inputs[' + index + ']'
      );
    }
    for (const [index, output] of recipe.outputs.entries()) {
      const label = 'recipes.' + id + '.outputs[' + index + ']';
      assertObject(output, label);
      assertKeys(output, ['path', 'mode'], label);
      normalizeRepositoryPath(output.path, label + '.path');
      if (!OUTPUT_MODES.has(output.mode)) {
        fail(label + '.mode must be 100644, 100755, or 120000');
      }
      const owner = recipeOutputs.get(output.path);
      if (owner) {
        fail(
          'generated output ' +
            output.path +
            ' is owned by both ' +
            owner +
            ' and ' +
            id
        );
      }
      recipeOutputs.set(output.path, id);
    }
  }

  const ruleIds = new Set();
  for (const [index, rule] of manifest.rules.entries()) {
    const label = 'manifest.rules[' + index + ']';
    assertObject(rule, label);
    assertKeys(
      rule,
      ['id', 'classification', 'include', 'exclude', 'recipe'],
      label
    );
    assertString(rule.id, label + '.id');
    if (ruleIds.has(rule.id)) fail('duplicate rule id ' + rule.id);
    ruleIds.add(rule.id);
    assertClassification(rule.classification, label + '.classification');
    assertStringArray(rule.include, label + '.include');
    assertStringArray(rule.exclude ?? [], label + '.exclude', { empty: true });
    for (const [patternIndex, pattern] of rule.include.entries()) {
      validatePattern(pattern, label + '.include[' + patternIndex + ']');
    }
    for (const [patternIndex, pattern] of (rule.exclude ?? []).entries()) {
      validatePattern(pattern, label + '.exclude[' + patternIndex + ']');
    }
    validateRecipeReference(rule, label, manifest.recipes);
  }

  const exceptionPaths = new Set();
  for (const [index, exception] of manifest.exceptions.entries()) {
    const label = 'manifest.exceptions[' + index + ']';
    assertObject(exception, label);
    assertKeys(
      exception,
      ['path', 'classification', 'recipe', 'reason', 'contentPolicy'],
      label
    );
    normalizeRepositoryPath(exception.path, label + '.path');
    if (exceptionPaths.has(exception.path)) {
      fail('duplicate exact exception for ' + exception.path);
    }
    exceptionPaths.add(exception.path);
    assertClassification(exception.classification, label + '.classification');
    if (exception.reason !== undefined) {
      assertString(exception.reason, label + '.reason');
    }
    validateRecipeReference(exception, label, manifest.recipes);
    validateContentPolicy(exception, label);
  }

  return manifest;
}

export async function readPathManifest(filePath) {
  const source = await readFile(filePath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail(filePath + ' is not valid JSON: ' + error.message);
  }
  return validatePathManifest(manifest);
}

export function createPathClassifier(manifest) {
  validatePathManifest(manifest);
  const exceptions = new Map(
    manifest.exceptions.map(exception => [exception.path, exception])
  );

  return file => {
    normalizeRepositoryPath(file);
    const exception = exceptions.get(file);
    if (exception) {
      return {
        classification: exception.classification,
        policyId: 'exception:' + file,
        recipe: exception.recipe ?? null,
        contentPolicy: exception.contentPolicy ?? null,
      };
    }

    const candidates = manifest.rules.filter(
      rule =>
        rule.include.some(pattern => matches(file, pattern)) &&
        !(rule.exclude ?? []).some(pattern => matches(file, pattern))
    );
    if (candidates.length === 0) {
      fail('tracked path has no classification: ' + file);
    }
    if (candidates.length > 1) {
      fail(
        'tracked path has ambiguous classifications (' +
          candidates.map(rule => rule.id).join(', ') +
          '): ' +
          file
      );
    }
    const rule = candidates[0];
    return {
      classification: rule.classification,
      policyId: 'rule:' + rule.id,
      recipe: rule.recipe ?? null,
      contentPolicy: null,
    };
  };
}

export function validateTrackedPathCoverage(manifest, trackedEntries) {
  validatePathManifest(manifest);
  const entries = [...trackedEntries].sort((a, b) =>
    a.path.localeCompare(b.path)
  );
  const trackedPaths = new Set(entries.map(entry => entry.path));
  const classify = createPathClassifier(manifest);
  const classified = [];
  const usedRules = new Set();
  const usedExceptions = new Set();
  const usedRecipes = new Set();

  for (const entry of entries) {
    normalizeRepositoryPath(entry.path, 'tracked path');
    const result = classify(entry.path);
    classified.push({ ...entry, ...result });
    if (result.policyId.startsWith('rule:')) {
      usedRules.add(result.policyId.slice('rule:'.length));
    } else {
      usedExceptions.add(entry.path);
    }
    if (result.recipe) usedRecipes.add(result.recipe);
  }

  for (const rule of manifest.rules) {
    if (!usedRules.has(rule.id))
      fail('stale rule matches no tracked path: ' + rule.id);
    for (const pattern of rule.exclude ?? []) {
      const relevant = entries.some(
        entry =>
          rule.include.some(include => matches(entry.path, include)) &&
          matches(entry.path, pattern)
      );
      if (!relevant) {
        fail('stale exclude pattern in ' + rule.id + ': ' + pattern);
      }
    }
  }
  for (const exception of manifest.exceptions) {
    if (
      !trackedPaths.has(exception.path) ||
      !usedExceptions.has(exception.path)
    ) {
      fail('stale exact exception: ' + exception.path);
    }
  }
  for (const recipeId of Object.keys(manifest.recipes)) {
    if (!usedRecipes.has(recipeId)) fail('stale generated recipe: ' + recipeId);
  }

  const generatedByPath = new Map(
    classified
      .filter(entry => entry.classification === 'GENERATED')
      .map(entry => [entry.path, entry.recipe])
  );
  for (const [recipeId, recipe] of Object.entries(manifest.recipes)) {
    for (const input of recipe.inputs) {
      if (!trackedPaths.has(input)) {
        fail('recipe ' + recipeId + ' has missing tracked input ' + input);
      }
    }
    for (const output of recipe.outputs) {
      const trackedOutput = classified.find(
        entry => entry.path === output.path
      );
      if (
        trackedOutput &&
        (trackedOutput.classification !== 'GENERATED' ||
          generatedByPath.get(output.path) !== recipeId)
      ) {
        fail(
          'tracked recipe output must be GENERATED and owned by ' +
            recipeId +
            ': ' +
            output.path +
            ' is ' +
            trackedOutput.classification
        );
      }
    }
  }
  for (const [generatedPath, recipeId] of generatedByPath) {
    if (
      !manifest.recipes[recipeId].outputs.some(
        output => output.path === generatedPath
      )
    ) {
      fail(
        'GENERATED path is not declared as an output of recipe ' +
          recipeId +
          ': ' +
          generatedPath
      );
    }
  }

  return classified;
}

function publicOutputPaths(classified, manifest) {
  const outputs = new Set(
    classified
      .filter(entry => entry.classification === 'PUBLIC')
      .map(entry => entry.path)
  );
  for (const recipe of Object.values(manifest.recipes)) {
    for (const output of recipe.outputs) outputs.add(output.path);
  }
  return [...outputs].sort();
}

export function projectPublicPathManifest(manifest, classified) {
  const outputPaths = publicOutputPaths(classified, manifest);
  const retainedClasses = new Set(['PUBLIC', 'GENERATED']);
  const rules = manifest.rules
    .filter(rule => retainedClasses.has(rule.classification))
    .map(rule => ({
      id: rule.id,
      classification: 'PUBLIC',
      include: [...rule.include],
      exclude: (rule.exclude ?? []).filter(pattern =>
        outputPaths.some(file => matches(file, pattern))
      ),
    }))
    .filter(rule =>
      outputPaths.some(
        file =>
          rule.include.some(pattern => matches(file, pattern)) &&
          !rule.exclude.some(pattern => matches(file, pattern))
      )
    );
  const exceptions = manifest.exceptions
    .filter(exception => retainedClasses.has(exception.classification))
    .map(exception => ({
      path: exception.path,
      classification: 'PUBLIC',
      reason: 'present in the reviewed public seed',
      ...(exception.contentPolicy
        ? { contentPolicy: exception.contentPolicy }
        : {}),
    }));
  const exactPaths = new Set(exceptions.map(exception => exception.path));
  for (const recipe of Object.values(manifest.recipes)) {
    for (const output of recipe.outputs) {
      if (exactPaths.has(output.path)) continue;
      exactPaths.add(output.path);
      exceptions.push({
        path: output.path,
        classification: 'PUBLIC',
        reason: 'generated by the reviewed public seed',
      });
    }
  }
  const projection = {
    schemaVersion: 1,
    rules,
    exceptions,
    recipes: {},
  };
  validateTrackedPathCoverage(
    projection,
    outputPaths.map(file => ({ path: file }))
  );
  return projection;
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function buildSeedPlan({
  manifest,
  source,
  trackedEntries,
  readBlob,
  reviewedOutputs = null,
}) {
  const classified = validateTrackedPathCoverage(manifest, trackedEntries);
  const entries = [];
  for (const entry of classified) {
    const sourceSha256 = sha256(await readBlob(entry.object));
    entries.push({
      path: entry.path,
      mode: entry.mode,
      object: entry.object,
      sourceSha256,
      classification: entry.classification,
      policyId: entry.policyId,
      recipe: entry.recipe,
      contentPolicy: entry.contentPolicy,
    });
  }
  const outputs = [];
  for (const entry of entries) {
    if (entry.classification === 'PUBLIC') {
      outputs.push({
        path: entry.path,
        mode: entry.mode,
        sourceObject: entry.object,
        sourceSha256: entry.sourceSha256,
        recipe: null,
        contentPolicy: entry.contentPolicy,
      });
    }
  }
  for (const [recipeId, recipe] of Object.entries(manifest.recipes).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const inputs = recipe.inputs.map(input => {
      const entry = entries.find(candidate => candidate.path === input);
      return {
        path: input,
        mode: entry.mode,
        object: entry.object,
        sourceSha256: entry.sourceSha256,
      };
    });
    for (const output of recipe.outputs) {
      outputs.push({
        path: output.path,
        mode: output.mode,
        sourceObject: null,
        sourceSha256: null,
        recipe: recipeId,
        inputs,
      });
    }
  }
  outputs.sort((a, b) => a.path.localeCompare(b.path));

  let reviewed = null;
  if (reviewedOutputs) {
    const expected = outputs.map(output => output.path);
    const actual = reviewedOutputs.map(output => output.path).sort();
    if (canonicalJson(expected) !== canonicalJson(actual)) {
      fail(
        'reviewed output tree does not exactly match the planned public paths'
      );
    }
    reviewed = reviewedOutputs
      .map(output => ({
        path: output.path,
        mode: output.mode,
        sha256: output.sha256,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const [index, output] of outputs.entries()) {
      if (reviewed[index].mode !== output.mode) {
        fail(
          'reviewed output mode for ' +
            output.path +
            ' is ' +
            reviewed[index].mode +
            '; expected ' +
            output.mode
        );
      }
      if (
        output.sourceSha256 &&
        reviewed[index].sha256 !== output.sourceSha256
      ) {
        fail('reviewed PUBLIC output changed bytes: ' + output.path);
      }
    }
  }

  const payload = {
    schemaVersion: 1,
    source,
    entries,
    recipes: Object.fromEntries(
      Object.entries(manifest.recipes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, recipe]) => [id, recipe])
    ),
    outputs,
    publicManifest: projectPublicPathManifest(manifest, classified),
    reviewedOutputs: reviewed,
    reviewedOutputDigest: reviewed ? sha256(canonicalJson(reviewed)) : null,
  };
  return {
    ...payload,
    planDigest: sha256(canonicalJson(payload)),
  };
}
