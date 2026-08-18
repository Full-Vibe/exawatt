import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Re-attest a generated asset after its bytes are rewritten.
 *
 * `ASSET_PROVENANCE.json` records a SHA-256 per shipped asset, and
 * `pnpm assets:check` fails when the bytes stop matching. For a HAND-ADDED
 * asset that is exactly right: a changed file deserves a human look.
 *
 * For a GENERATED asset it is a trap. The generator rewrites the bytes and
 * the record keeps the old digest, so the gate goes red for a change that was
 * entirely intended — twice here for `hero-board-poster.jpg` (`aab70c8d`,
 * `ed7112a6`), each time costing someone a diagnosis and a follow-up commit,
 * and in between leaving `publication:check` red so every CI step after it
 * never ran.
 *
 * The record exists to attest to specific bytes, so whoever writes the bytes
 * must write the attestation in the same action. A generator that calls this
 * cannot leave the tree in the failing state; one that forgets is the bug.
 */
export async function recordGeneratedAssetProvenance({
  root,
  assetPath,
  bytes,
}) {
  const relative = path
    .relative(root, path.resolve(root, assetPath))
    .split(path.sep)
    .join('/');
  const manifestPath = path.join(root, 'ASSET_PROVENANCE.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.assets?.find(asset => asset.path === relative);
  if (!entry) {
    throw new Error(
      `ASSET_PROVENANCE.json has no entry for ${relative}. A generated asset ` +
        'needs its origin and licensing basis recorded by a human once, before ' +
        'a generator may re-attest its bytes.'
    );
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (entry.sha256 === digest) return { relative, digest, changed: false };
  entry.sha256 = digest;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { relative, digest, changed: true };
}
