#!/usr/bin/env node
/**
 * Fail a pull request whose author has not accepted `CLA.md`.
 *
 * Deliberately dependency-free and read-only: it takes the author login from
 * the event environment and compares it against a file in this repository. It
 * never calls the GitHub API, so it needs no token, and it cannot be made to
 * leak one.
 *
 * Acceptance lives in `.github/cla-signatures.json` rather than a third-party
 * service. That means a maintainer merges each first-time contributor's
 * acceptance, which is more work per contributor than a bot and the right
 * trade at this size: the record is in the repository's own history, it
 * survives any service going away, and there is no OAuth application holding
 * write access to the organization.
 */
import { readFileSync } from 'node:fs';

const author = process.env.PR_AUTHOR ?? '';
const authorType = process.env.AUTHOR_TYPE ?? '';

if (!author) {
  console.error('[cla] no pull request author in the event payload');
  process.exit(1);
}

// A bot cannot accept an agreement. Dependabot and friends are exempt because
// their changes carry no copyrightable contribution from a person.
if (authorType === 'Bot' || author.endsWith('[bot]')) {
  console.log(`[cla] ${author} is a bot; no agreement is owed`);
  process.exit(0);
}

const record = JSON.parse(
  readFileSync(new URL('../cla-signatures.json', import.meta.url), 'utf8')
);
const signed = new Set(
  (record.signatures ?? []).map(entry =>
    String(entry.login ?? entry).toLowerCase()
  )
);

if (signed.has(author.toLowerCase())) {
  console.log(`[cla] ${author} accepted CLA v${record.claVersion}`);
  process.exit(0);
}

console.error(
  `[cla] ${author} has not accepted the Contributor License Agreement.\n\n` +
    'Read CLA.md. To accept it, open a pull request that adds your GitHub\n' +
    'login to .github/cla-signatures.json, stating in the description that\n' +
    `you have read and accept CLA.md version ${record.claVersion}. A\n` +
    'maintainer merges it, and this check passes on your next push.\n\n' +
    'You keep copyright in your work. The agreement grants the rights needed\n' +
    'to keep your contribution open source and is not an assignment.'
);
process.exit(1);
