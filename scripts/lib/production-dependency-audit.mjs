const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

/**
 * A payload that is not an audit report is a failed read, never a clean one.
 * `pnpm audit` exits non-zero both when it finds advisories and when it
 * cannot ask the registry, and the second case prints `{ "error": ... }`:
 * read as an audit, that is zero advisories and a green gate.
 */
export function assertAuditPayload(payload, label = 'audit') {
  if (payload?.error) {
    const { code, message } = payload.error;
    throw new Error(
      `${label} did not run: ${[code, message].filter(Boolean).join(' ')}`
    );
  }
  if (
    !payload ||
    typeof payload.advisories !== 'object' ||
    payload.advisories === null ||
    typeof payload.metadata !== 'object' ||
    payload.metadata === null
  ) {
    throw new Error(`${label} printed something that is not an audit report`);
  }
  return payload;
}

export function normalizeProductionAudit(payload) {
  const advisories = Object.entries(payload?.advisories ?? {})
    .map(([registryId, advisory]) => ({
      id: advisory.github_advisory_id || `registry:${registryId}`,
      package: advisory.module_name || '(unknown)',
      severity: advisory.severity || 'unknown',
      title: advisory.title || '(untitled advisory)',
      url: advisory.url || null,
      versions: uniqueSorted(
        (advisory.findings ?? []).map(finding => finding.version)
      ),
      paths: uniqueSorted(
        (advisory.findings ?? []).flatMap(finding => finding.paths ?? [])
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const counts = Object.fromEntries(
    SEVERITIES.map(severity => [
      severity,
      advisories.filter(advisory => advisory.severity === severity).length,
    ])
  );
  const unknown = advisories.filter(
    advisory => !SEVERITIES.includes(advisory.severity)
  ).length;
  if (unknown > 0) counts.unknown = unknown;

  return { advisories, counts, total: advisories.length };
}

function validateBaselineEntry(id, entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    return [`${id}: baseline entry must be an object`];
  }
  if (entry.disposition !== 'non-runtime') {
    errors.push(`${id}: disposition must be "non-runtime"`);
  }
  if (typeof entry.package !== 'string' || entry.package.length === 0) {
    errors.push(`${id}: package is required`);
  }
  if (typeof entry.severity !== 'string' || entry.severity.length === 0) {
    errors.push(`${id}: severity is required`);
  }
  if (typeof entry.rationale !== 'string' || entry.rationale.length < 20) {
    errors.push(`${id}: rationale must explain the non-runtime boundary`);
  }
  return errors;
}

/**
 * Two verdicts over one audit (BUG-127).
 *
 * Without `base`, the zero baseline: every advisory not documented in the
 * committed baseline fails. That is what `master` is held to.
 *
 * With `base` (the normalized audit of the tree a pull request merges into),
 * the change is judged by what it adds: an advisory its base already carries
 * is `inherited` and reported, one the change introduces fails, and one the
 * base carries that the change removes is `resolved`. So a bump that clears
 * some advisories passes while others remain, which is exactly the shape of
 * every Dependabot pull request; before this, all of them were red on an
 * advisory none of them touched.
 */
export function evaluateProductionAudit(
  normalized,
  baseline,
  { base, baseLabel } = {}
) {
  if (baseline?.schemaVersion !== 1) {
    throw new Error('production audit baseline must use schemaVersion 1');
  }
  const allowed = baseline.allowedAdvisories ?? {};
  const baselineErrors = Object.entries(allowed).flatMap(([id, entry]) =>
    validateBaselineEntry(id, entry)
  );
  const byId = new Map(
    normalized.advisories.map(advisory => [advisory.id, advisory])
  );
  const unexpected = normalized.advisories.filter(
    advisory => !Object.hasOwn(allowed, advisory.id)
  );
  const stale = Object.keys(allowed)
    .filter(id => !byId.has(id))
    .sort();
  const mismatched = Object.entries(allowed).flatMap(([id, entry]) => {
    const advisory = byId.get(id);
    if (!advisory) return [];
    const fields = [];
    if (entry.package !== advisory.package) fields.push('package');
    if (entry.severity !== advisory.severity) fields.push('severity');
    return fields.length > 0 ? [{ id, fields }] : [];
  });

  const baseIds = new Set(
    (base?.advisories ?? []).map(advisory => advisory.id)
  );
  const inherited = base
    ? unexpected.filter(advisory => baseIds.has(advisory.id))
    : [];
  const introduced = base
    ? unexpected.filter(advisory => !baseIds.has(advisory.id))
    : unexpected;
  // A baseline entry whose advisory changed severity upstream is the change's
  // problem only when its base did not already carry that advisory.
  const blockingMismatches = base
    ? mismatched.filter(mismatch => !baseIds.has(mismatch.id))
    : mismatched;
  const resolved = base
    ? base.advisories
        .filter(advisory => !byId.has(advisory.id))
        .map(advisory => advisory.id)
    : [];

  return {
    mode: base ? 'against-base' : 'zero-baseline',
    base: base ? (baseLabel ?? 'its base') : null,
    status:
      baselineErrors.length === 0 &&
      introduced.length === 0 &&
      blockingMismatches.length === 0 &&
      // A stale entry on a pull request is the advisory the change cleared;
      // `master` still has to drop it.
      (base || stale.length === 0)
        ? 'pass'
        : 'fail',
    counts: normalized.counts,
    total: normalized.total,
    advisories: normalized.advisories,
    allowed: normalized.advisories
      .filter(advisory => Object.hasOwn(allowed, advisory.id))
      .map(advisory => advisory.id),
    unexpected: introduced.map(advisory => advisory.id),
    inherited: inherited.map(advisory => advisory.id),
    resolved,
    stale,
    mismatched,
    baselineErrors,
  };
}

export function formatProductionAudit(evaluation) {
  const counts = SEVERITIES.map(
    severity => `${severity}=${evaluation.counts[severity] ?? 0}`
  ).join(' ');
  const against =
    evaluation.mode === 'against-base'
      ? ` against ${evaluation.base} (introduced=${evaluation.unexpected.length} inherited=${evaluation.inherited.length} resolved=${evaluation.resolved.length})`
      : '';
  const lines = [
    `[production-audit] ${evaluation.status.toUpperCase()} ${evaluation.total} advisories${against} (${counts})`,
  ];
  for (const advisory of evaluation.advisories) {
    const disposition = evaluation.allowed.includes(advisory.id)
      ? 'allowed non-runtime'
      : evaluation.inherited.includes(advisory.id)
        ? 'inherited from base'
        : evaluation.mode === 'against-base'
          ? 'introduced'
          : 'unexpected';
    lines.push(
      `  ${advisory.severity} ${advisory.id} ${advisory.package} [${disposition}]`
    );
  }
  for (const id of evaluation.resolved) {
    lines.push(`  resolved: ${id}`);
  }
  for (const id of evaluation.stale) {
    lines.push(`  stale baseline: ${id}`);
  }
  for (const mismatch of evaluation.mismatched) {
    lines.push(
      `  baseline mismatch: ${mismatch.id} (${mismatch.fields.join(', ')})`
    );
  }
  for (const error of evaluation.baselineErrors) {
    lines.push(`  invalid baseline: ${error}`);
  }
  return `${lines.join('\n')}\n`;
}

export function productionAuditJson(evaluation) {
  return `${JSON.stringify({ schemaVersion: 1, ...evaluation }, null, 2)}\n`;
}

/**
 * The files `pnpm audit` reads to reconstruct a tree's dependency graph: the
 * lockfile names every resolved version, and the root manifest and workspace
 * file are what make the directory a project pnpm will audit at all.
 */
export const AUDIT_TREE_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);

/**
 * Audits the dependency graph committed at `revision` without checking it
 * out. Every failure throws: a base that cannot be read must never read as a
 * base with no advisories, or every advisory would count as introduced and
 * the verdict would be about the read, not the change.
 *
 * `run(command, args, options)` resolves `{ stdout }` or rejects with an
 * error carrying `stdout` and `code`, the shape of a promisified `execFile`.
 */
export async function auditCommittedTree(
  revision,
  { root, run, makeTempDirectory, writeTreeFile, removeDirectory }
) {
  const directory = await makeTempDirectory();
  try {
    for (const file of AUDIT_TREE_FILES) {
      let contents;
      try {
        ({ stdout: contents } = await run(
          'git',
          ['show', `${revision}:${file}`],
          { cwd: root }
        ));
      } catch (error) {
        throw new Error(
          `cannot read ${file} at ${revision}: ${String(error.stderr ?? error.message).trim()}`,
          { cause: error }
        );
      }
      await writeTreeFile(directory, file, contents);
    }
    return assertAuditPayload(
      await auditJson(run, directory),
      `the audit of ${revision}`
    );
  } finally {
    await removeDirectory(directory);
  }
}

/** `pnpm audit --prod --json` in `cwd`; a non-zero exit with a report is a finding, not a failure. */
export async function auditJson(run, cwd) {
  let stdout;
  try {
    ({ stdout } = await run('pnpm', ['audit', '--prod', '--json'], { cwd }));
  } catch (error) {
    if (!error?.stdout) throw error;
    stdout = error.stdout;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`pnpm audit in ${cwd} printed something that is not JSON`);
  }
}
