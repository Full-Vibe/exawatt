import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { findTextFindings, isApprovedEmail } from '../public-content-scan.mjs';

const execFileAsync = promisify(execFile);

/**
 * Git metadata is part of the publication surface (BUG-112).
 *
 * The path projector can remove a private file while leaving the source
 * commit's author, committer, message, and annotated-tag text intact. That is
 * exactly how a private admin email reached the first public seed. This module
 * is the one policy boundary for metadata that survives projection; the
 * projection kernel supplies path classification and consumes the returned
 * bytes without independently rewriting them.
 */

export const PUBLIC_METADATA_POLICY_VERSION = 2;
export const PUBLIC_METADATA_POLICY_ID = `exawatt-public-metadata-v${PUBLIC_METADATA_POLICY_VERSION}`;

/** A projected commit was written by its author and rewritten by this actor. */
export const PUBLIC_PROJECTOR_IDENTITY = Object.freeze({
  name: 'Exawatt Public Projector',
  email: 'public-projection@exawatt.invalid',
});

const SHA = /^[0-9a-f]{40}$/u;
const EMAIL =
  /(?<![a-z0-9._+-])([a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?![a-z0-9-])/giu;
const IDENTITY_EMAIL = /^[^\s<>@]+@[^\s<>@]+$/u;
const COMMIT_TREE_DATE = /^-?\d+ [+-]\d{4}$/u;
const IDENTITY_TRAILER =
  /^(?:co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by):\s+.+\s+<([^<>]+)>\s*$/iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const REVIEW_PROVENANCE = new Set(['authenticated-import', 'explicit-review']);
const GITHUB_NOREPLY =
  /^(?:\d+\+)?[a-z0-9](?:[a-z0-9-]{0,38})(?:\[bot\])?@users\.noreply\.github\.com$/iu;

// Deliberately high-confidence shapes only. The repository's pinned gitleaks
// remains the broad secret detector; these close its commit-message blind spot
// without turning ordinary prose about credentials into a false positive.
const SECRET_PATTERNS = Object.freeze([
  ['aws-access-token', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/gu],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,200}\b/gu],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
]);

function fail(message) {
  throw new Error(`[public-metadata] ${message}`);
}

function assertIdentity(identity, label, { projectableDate = false } = {}) {
  if (!identity || typeof identity !== 'object') {
    fail(`${label} identity is required`);
  }
  if (
    typeof identity.name !== 'string' ||
    identity.name.trim().length === 0 ||
    CONTROL.test(identity.name) ||
    /[\r\n]/u.test(identity.name)
  ) {
    fail(`${label} name must be one non-empty line`);
  }
  if (
    typeof identity.email !== 'string' ||
    !IDENTITY_EMAIL.test(identity.email) ||
    CONTROL.test(identity.email)
  ) {
    fail(`${label} email is invalid`);
  }
  if (
    typeof identity.date !== 'string' ||
    identity.date.trim().length === 0 ||
    CONTROL.test(identity.date) ||
    /[\r\n]/u.test(identity.date) ||
    (projectableDate && !COMMIT_TREE_DATE.test(identity.date))
  ) {
    fail(
      projectableDate
        ? `${label} date must use git commit-tree format: <unix> <offset>`
        : `${label} date is required`
    );
  }
  return {
    name: identity.name,
    email: identity.email,
    date: identity.date,
  };
}

function normalizePaths(change, label) {
  if (!change || typeof change !== 'object') {
    fail(`${label} change classification is required`);
  }
  if (typeof change.hasChanges !== 'boolean') {
    fail(`${label}.hasChanges must be boolean`);
  }
  if (!Array.isArray(change.paths)) {
    fail(`${label}.paths must be an array`);
  }
  const paths = [...new Set(change.paths)];
  for (const file of paths) {
    if (
      typeof file !== 'string' ||
      file.length === 0 ||
      file.startsWith('/') ||
      file.includes('\0') ||
      file.split('/').includes('..')
    ) {
      fail(`${label} contains an invalid repository path`);
    }
  }
  return { hasChanges: change.hasChanges, paths: paths.sort() };
}

function pathScope(paths) {
  const scopes = [...new Set(paths.map(file => file.split('/')[0]))].sort();
  if (scopes.length === 1) return scopes[0];
  if (scopes.length <= 3) return scopes.join(', ');
  return `${scopes.length} areas`;
}

export function neutralCommitMessage(publicPaths, { mixed = false } = {}) {
  const paths = [...new Set(publicPaths)].sort();
  if (paths.length === 0) fail('a projected commit needs a public path');
  return [
    `public: update ${pathScope(paths)}`,
    '',
    mixed
      ? 'Public projection of an unreviewed source commit that also changed private paths.'
      : 'Public projection with unreviewed source metadata replaced.',
    '',
    `Exawatt-Public-Metadata-Policy: ${PUBLIC_METADATA_POLICY_ID}`,
    '',
  ].join('\n');
}

/** Kept as the named mixed-boundary helper consumed by existing callers. */
export function mixedCommitMessage(publicPaths) {
  return neutralCommitMessage(publicPaths, { mixed: true });
}

export function isCanonicalGitHubNoreplyEmail(email) {
  return typeof email === 'string' && GITHUB_NOREPLY.test(email);
}

function normalizeEmailList(addresses, label) {
  if (!Array.isArray(addresses)) fail(`${label} must be an array`);
  const normalized = new Set();
  for (const address of addresses) {
    if (typeof address !== 'string' || !IDENTITY_EMAIL.test(address)) {
      fail(`${label} contains an invalid email`);
    }
    normalized.add(address.toLowerCase());
  }
  return normalized;
}

function normalizeVocabulary(terms, label) {
  if (!Array.isArray(terms)) fail(`${label} must be an array`);
  return [
    ...new Set(
      terms.map(term => {
        if (typeof term !== 'string' || term.trim().length === 0) {
          fail(`${label} contains an empty or invalid term`);
        }
        return term.trim();
      })
    ),
  ];
}

function normalizeReviewedMetadata(reviewedMetadata, sourceSha, authorDate) {
  if (reviewedMetadata === null || reviewedMetadata === undefined) return null;
  if (!reviewedMetadata || typeof reviewedMetadata !== 'object') {
    fail('reviewedMetadata must be an object');
  }
  if (reviewedMetadata.sourceSha !== sourceSha) {
    fail('reviewedMetadata.sourceSha must match the projected source commit');
  }
  if (!REVIEW_PROVENANCE.has(reviewedMetadata.provenance)) {
    fail(
      'reviewedMetadata.provenance must be authenticated-import or explicit-review'
    );
  }
  // Provenance is trusted caller input, never inferred from a source commit
  // message or trailer. The projection kernel may set it only after verifying
  // an import record or explicit review outside this pure policy function.
  if (
    typeof reviewedMetadata.message !== 'string' ||
    reviewedMetadata.message.length === 0
  ) {
    fail('reviewedMetadata.message must be non-empty');
  }
  const author = assertIdentity(
    { ...reviewedMetadata.author, date: authorDate },
    'reviewedMetadata author',
    { projectableDate: true }
  );
  return {
    provenance: reviewedMetadata.provenance,
    message: reviewedMetadata.message.endsWith('\n')
      ? reviewedMetadata.message
      : `${reviewedMetadata.message}\n`,
    author,
    approvedIdentityEmails: normalizeEmailList(
      reviewedMetadata.approvedIdentityEmails,
      'reviewedMetadata.approvedIdentityEmails'
    ),
    forbiddenVocabulary: normalizeVocabulary(
      reviewedMetadata.forbiddenVocabulary,
      'reviewedMetadata.forbiddenVocabulary'
    ),
  };
}

function identityEmailIsPublic(address, approvedIdentityEmails = new Set()) {
  const normalized = address.toLowerCase();
  return (
    isApprovedEmail(normalized) ||
    isCanonicalGitHubNoreplyEmail(normalized) ||
    approvedIdentityEmails.has(normalized)
  );
}

/**
 * Pure metadata policy consumed by the history projector.
 *
 * - Unreviewed source metadata is never publication input. Public-only and
 *   mixed commits both receive a deterministic neutral message and projector
 *   identity, so an optional vocabulary list is not the semantic boundary.
 * - Authenticated imports and explicitly reviewed metadata may supply the
 *   message/author to preserve. Those bytes still pass structural scanners,
 *   optional private vocabulary, and explicit identity-consent policy.
 * - The committer always becomes the stable projector identity, truthfully
 *   separating source history from publication.
 * - A private-only commit is not projectable; the caller must drop it.
 */
export function projectPublicCommitMetadata({
  sourceSha,
  message,
  author,
  committer,
  publicChange,
  privateChange,
  reviewedMetadata = null,
}) {
  if (!SHA.test(sourceSha ?? '')) fail('sourceSha must be a full commit id');
  if (typeof message !== 'string' || message.length === 0) {
    fail('message must be non-empty');
  }
  const publicSide = normalizePaths(publicChange, 'publicChange');
  const privateSide = normalizePaths(privateChange, 'privateChange');
  if (!publicSide.hasChanges) {
    fail('a commit with no public change must be dropped by the projector');
  }
  const publicAuthor = assertIdentity(author, 'author', {
    projectableDate: true,
  });
  const sourceCommitter = assertIdentity(committer, 'committer', {
    projectableDate: true,
  });
  const review = normalizeReviewedMetadata(
    reviewedMetadata,
    sourceSha,
    publicAuthor.date
  );
  const publicMessage =
    review?.message ??
    neutralCommitMessage(publicSide.paths, {
      mixed: privateSide.hasChanges,
    });
  const findings = scanPublicMetadataText(publicMessage, {
    surface: `commit ${sourceSha} message`,
    forbiddenVocabulary: review?.forbiddenVocabulary ?? [],
    approvedIdentityEmails: review?.approvedIdentityEmails ?? [],
  });
  const outputAuthor = review?.author ?? {
    ...PUBLIC_PROJECTOR_IDENTITY,
    date: publicAuthor.date,
  };
  findings.push(
    ...scanIdentity(
      outputAuthor,
      `commit ${sourceSha} author`,
      review?.forbiddenVocabulary ?? [],
      review?.approvedIdentityEmails ?? new Set()
    )
  );
  if (findings.length > 0) {
    fail(
      `commit ${sourceSha} metadata violates ${findings
        .map(finding => finding.rule)
        .join(', ')}`
    );
  }
  return {
    message: publicMessage,
    author: outputAuthor,
    committer: {
      ...PUBLIC_PROJECTOR_IDENTITY,
      date: sourceCommitter.date,
    },
  };
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function finding(surface, rule, source, offset = 0) {
  return { surface, line: lineAt(source, offset), rule };
}

function identityTrailerEmailOffsets(source) {
  const occurrences = new Map();
  const pattern = new RegExp(
    IDENTITY_TRAILER.source,
    `${IDENTITY_TRAILER.flags}gm`
  );
  for (const match of source.matchAll(pattern)) {
    if (IDENTITY_EMAIL.test(match[1])) {
      const emailOffset = match[0].lastIndexOf(match[1]);
      occurrences.set((match.index ?? 0) + emailOffset, match[1].toLowerCase());
    }
  }
  return occurrences;
}

/** Scans message/tag text without ever echoing the matched private value. */
export function scanPublicMetadataText(
  source,
  {
    surface = 'metadata',
    forbiddenVocabulary = [],
    approvedIdentityEmails = [],
  } = {}
) {
  if (typeof source !== 'string') fail('metadata text must be a string');
  const vocabulary = normalizeVocabulary(
    forbiddenVocabulary,
    'forbiddenVocabulary'
  );
  const approvedIdentities =
    approvedIdentityEmails instanceof Set
      ? approvedIdentityEmails
      : normalizeEmailList(approvedIdentityEmails, 'approvedIdentityEmails');
  const findings = findTextFindings(source, surface, vocabulary, {
    allowThirdPartyEmailMetadata: true,
  }).map(entry => ({
    surface,
    line: entry.line,
    rule: entry.rule,
  }));
  const trailerEmails = identityTrailerEmailOffsets(source);
  for (const match of source.matchAll(EMAIL)) {
    const normalized = match[1].toLowerCase();
    const trailerAddress = trailerEmails.get(match.index);
    if (
      isApprovedEmail(normalized) ||
      (trailerAddress === normalized &&
        identityEmailIsPublic(normalized, approvedIdentities))
    ) {
      continue;
    }
    findings.push(
      finding(surface, 'unapproved-message-email', source, match.index)
    );
  }
  for (const [rule, pattern] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) findings.push(finding(surface, rule, source, match.index));
  }
  return findings;
}

function scanIdentity(
  identity,
  surface,
  forbiddenVocabulary,
  approvedIdentityEmails = new Set()
) {
  const findings = [];
  try {
    assertIdentity(identity, surface);
  } catch {
    findings.push({ surface, line: 1, rule: 'invalid-git-identity' });
    return findings;
  }
  findings.push(
    ...scanPublicMetadataText(identity.name, {
      surface: `${surface} name`,
      forbiddenVocabulary,
    })
  );
  if (!identityEmailIsPublic(identity.email, approvedIdentityEmails)) {
    findings.push({
      surface: `${surface} email`,
      line: 1,
      rule: 'unapproved-identity-email',
    });
  }
  const foldedEmail = identity.email.toLocaleLowerCase('en-US');
  for (const term of forbiddenVocabulary) {
    if (
      typeof term === 'string' &&
      term.trim().length > 0 &&
      foldedEmail.includes(term.toLocaleLowerCase('en-US'))
    ) {
      findings.push({
        surface: `${surface} email`,
        line: 1,
        rule: 'private-forbidden-vocabulary',
      });
    }
  }
  return findings;
}

export function scanPublicCommitMetadata(
  commit,
  {
    forbiddenVocabulary = [],
    approvedIdentityEmails = [],
    enforceProjectorCommitter = true,
  } = {}
) {
  const surface = `commit ${commit?.sha ?? '<invalid>'}`;
  const findings = [];
  const approvedIdentities = normalizeEmailList(
    approvedIdentityEmails,
    'approvedIdentityEmails'
  );
  if (!SHA.test(commit?.sha ?? '')) {
    findings.push({ surface, line: 1, rule: 'invalid-commit-sha' });
  }
  findings.push(
    ...scanPublicMetadataText(commit?.message ?? '', {
      surface: `${surface} message`,
      forbiddenVocabulary,
      approvedIdentityEmails: approvedIdentities,
    }),
    ...scanIdentity(
      commit?.author,
      `${surface} author`,
      forbiddenVocabulary,
      approvedIdentities
    ),
    ...scanIdentity(
      commit?.committer,
      `${surface} committer`,
      forbiddenVocabulary,
      approvedIdentities
    )
  );
  if (
    enforceProjectorCommitter &&
    (commit?.committer?.name !== PUBLIC_PROJECTOR_IDENTITY.name ||
      commit?.committer?.email !== PUBLIC_PROJECTOR_IDENTITY.email)
  ) {
    findings.push({
      surface: `${surface} committer`,
      line: 1,
      rule: 'unexpected-committer-identity',
    });
  }
  return findings;
}

export function scanPublicTagMetadata(
  tag,
  { forbiddenVocabulary = [], approvedIdentityEmails = [] } = {}
) {
  const surface = `tag ${tag?.name ?? '<invalid>'}`;
  const approvedIdentities = normalizeEmailList(
    approvedIdentityEmails,
    'approvedIdentityEmails'
  );
  const findings = [
    ...scanPublicMetadataText(tag?.name ?? '', {
      surface: `${surface} name`,
      forbiddenVocabulary,
      approvedIdentityEmails: approvedIdentities,
    }),
    ...scanPublicMetadataText(tag?.message ?? '', {
      surface: `${surface} message`,
      forbiddenVocabulary,
      approvedIdentityEmails: approvedIdentities,
    }),
  ];
  if (tag?.tagger) {
    findings.push(
      ...scanIdentity(
        tag.tagger,
        `${surface} tagger`,
        forbiddenVocabulary,
        approvedIdentities
      )
    );
  }
  return findings;
}

export function auditPublicGitMetadata(
  { commits = [], tags = [], refs = [] },
  {
    forbiddenVocabulary = [],
    approvedIdentityEmails = [],
    enforceProjectorCommitter = true,
  } = {}
) {
  const findings = [
    ...commits.flatMap(commit =>
      scanPublicCommitMetadata(commit, {
        forbiddenVocabulary,
        approvedIdentityEmails,
        enforceProjectorCommitter,
      })
    ),
    ...tags.flatMap(tag =>
      scanPublicTagMetadata(tag, {
        forbiddenVocabulary,
        approvedIdentityEmails,
      })
    ),
  ];
  const byRule = {};
  for (const entry of findings) {
    byRule[entry.rule] = (byRule[entry.rule] ?? 0) + 1;
  }
  return {
    policyId: PUBLIC_METADATA_POLICY_ID,
    refs: refs.length,
    commits: commits.length,
    tags: tags.length,
    findings,
    byRule,
    reseedRequired: findings.length > 0,
  };
}

async function git(repo, args, { encoding = 'utf8' } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repo,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

function parseCommitLog(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 8 !== 0) fail('git log returned malformed metadata');
  const commits = [];
  for (let index = 0; index < fields.length; index += 8) {
    commits.push({
      sha: fields[index],
      author: {
        name: fields[index + 1],
        email: fields[index + 2],
        date: fields[index + 3],
      },
      committer: {
        name: fields[index + 4],
        email: fields[index + 5],
        date: fields[index + 6],
      },
      message: fields[index + 7],
    });
  }
  return commits;
}

async function readTags(repo) {
  const refs = (
    await git(repo, ['for-each-ref', '--format=%(refname)', 'refs/tags'])
  )
    .split('\n')
    .filter(Boolean);
  const tags = [];
  for (const ref of refs) {
    const name = ref.slice('refs/tags/'.length);
    const objectType = (await git(repo, ['cat-file', '-t', ref])).trim();
    const target = (await git(repo, ['rev-list', '-n', '1', ref])).trim();
    if (objectType !== 'tag') {
      tags.push({ name, target, tagger: null, message: '' });
      continue;
    }
    const output = await git(repo, [
      'for-each-ref',
      '--format=%(taggername)%00%(taggeremail:trim)%00%(taggerdate:iso-strict)%00%(contents)',
      ref,
    ]);
    const first = output.indexOf('\0');
    const second = output.indexOf('\0', first + 1);
    const third = output.indexOf('\0', second + 1);
    if (first === -1 || second === -1 || third === -1) {
      fail(`annotated tag ${name} returned malformed metadata`);
    }
    tags.push({
      name,
      target,
      tagger: {
        name: output.slice(0, first),
        email: output.slice(first + 1, second),
        date: output.slice(second + 1, third),
      },
      message: output.slice(third + 1).replace(/\n$/u, ''),
    });
  }
  return tags;
}

async function readPublicRefs(repo) {
  return (await git(repo, ['for-each-ref', '--format=%(refname)', 'refs']))
    .split('\n')
    .filter(Boolean)
    .sort();
}

/**
 * Reads commits reachable from every local ref plus every tag's own metadata.
 * Passing `refs` narrows the traversal for a focused diagnostic; omission or
 * an empty array is deliberately all-refs because a clean `master` does not
 * erase sensitive objects kept alive by release, bot, or pull-request refs.
 */
export async function readPublicGitMetadata({ repo, refs = [] }) {
  if (typeof repo !== 'string' || repo.length === 0) fail('repo is required');
  if (!Array.isArray(refs)) fail('refs must be an array');
  const requestedRefs = refs.length === 0 ? await readPublicRefs(repo) : refs;
  if (requestedRefs.length === 0) fail('the repository has no ref to audit');
  const resolvedRefs = [];
  for (const ref of requestedRefs) {
    if (typeof ref !== 'string' || ref.length === 0 || ref.startsWith('-')) {
      fail('refs must be non-empty names and may not start with a dash');
    }
    const commit = (
      await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])
    ).trim();
    if (!resolvedRefs.includes(commit)) resolvedRefs.push(commit);
  }
  const log = await git(
    repo,
    [
      'log',
      '-z',
      '--no-show-signature',
      '--topo-order',
      '--format=%H%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B',
      ...resolvedRefs,
    ],
    { encoding: 'buffer' }
  );
  return {
    refs: requestedRefs,
    commits: parseCommitLog(log),
    tags: await readTags(repo),
  };
}

export function renderPublicMetadataAudit(audit, { format = 'text' } = {}) {
  if (format === 'json') return JSON.stringify(audit, null, 2) + '\n';
  if (format !== 'text') fail(`unknown report format ${format}`);
  const lines = [
    `[public-metadata] policy=${audit.policyId} refs=${audit.refs ?? 0} commits=${audit.commits} tags=${audit.tags} findings=${audit.findings.length}`,
  ];
  for (const entry of audit.findings) {
    lines.push(`${entry.surface}:${entry.line} [${entry.rule}]`);
  }
  lines.push(
    audit.reseedRequired
      ? '[public-metadata] RESEED REQUIRED: reachable Git metadata is not publication-safe. Preview only; no ref was mutated.'
      : '[public-metadata] clean: reachable commit and tag metadata satisfy the publication policy.'
  );
  return lines.join('\n') + '\n';
}
