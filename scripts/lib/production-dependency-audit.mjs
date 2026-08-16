const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
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

export function evaluateProductionAudit(normalized, baseline) {
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

  return {
    status:
      baselineErrors.length === 0 &&
      unexpected.length === 0 &&
      stale.length === 0 &&
      mismatched.length === 0
        ? 'pass'
        : 'fail',
    counts: normalized.counts,
    total: normalized.total,
    advisories: normalized.advisories,
    allowed: normalized.advisories
      .filter(advisory => Object.hasOwn(allowed, advisory.id))
      .map(advisory => advisory.id),
    unexpected: unexpected.map(advisory => advisory.id),
    stale,
    mismatched,
    baselineErrors,
  };
}

export function formatProductionAudit(evaluation) {
  const counts = SEVERITIES.map(
    severity => `${severity}=${evaluation.counts[severity] ?? 0}`
  ).join(' ');
  const lines = [
    `[production-audit] ${evaluation.status.toUpperCase()} ${evaluation.total} advisories (${counts})`,
  ];
  for (const advisory of evaluation.advisories) {
    const disposition = evaluation.allowed.includes(advisory.id)
      ? 'allowed non-runtime'
      : 'unexpected';
    lines.push(
      `  ${advisory.severity} ${advisory.id} ${advisory.package} [${disposition}]`
    );
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
