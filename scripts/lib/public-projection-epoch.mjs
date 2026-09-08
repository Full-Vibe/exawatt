import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_PROJECTION_EPOCH_PATH =
  'scripts/public-projection.epoch.json';

const SHA = /^[0-9a-f]{40}$/u;

function fail(message) {
  throw new Error(`[public-projection-epoch] ${message}`);
}

export function validateProjectionEpoch(epoch) {
  if (epoch?.schemaVersion !== 1) {
    fail('schemaVersion must be 1');
  }
  if (!SHA.test(epoch.sourceSha ?? '')) {
    fail('sourceSha must be a full commit id');
  }
  if (!SHA.test(epoch.publicSha ?? '')) {
    fail('publicSha must be a full commit id');
  }
  if (typeof epoch.reason !== 'string' || epoch.reason.trim().length < 20) {
    fail('reason must explain the frozen boundary');
  }
  if (
    epoch.metadataPolicyId !== undefined &&
    (typeof epoch.metadataPolicyId !== 'string' ||
      epoch.metadataPolicyId.trim().length === 0)
  ) {
    fail('metadataPolicyId must be a non-empty string when present');
  }
  if (
    epoch.projectionContractId !== undefined &&
    (typeof epoch.projectionContractId !== 'string' ||
      epoch.projectionContractId.trim().length === 0)
  ) {
    fail('projectionContractId must be a non-empty string when present');
  }
  if (epoch.mode !== undefined && epoch.mode !== 'published-snapshot') {
    fail('mode must be published-snapshot when present');
  }
  if (
    epoch.mode === 'published-snapshot' &&
    (!epoch.metadataPolicyId || !epoch.projectionContractId)
  ) {
    fail('published-snapshot mode requires metadata and projection policy IDs');
  }
  return Object.freeze({
    schemaVersion: epoch.schemaVersion,
    ...(epoch.mode ? { mode: epoch.mode } : {}),
    sourceSha: epoch.sourceSha,
    publicSha: epoch.publicSha,
    reason: epoch.reason.trim(),
    ...(epoch.metadataPolicyId === undefined
      ? {}
      : { metadataPolicyId: epoch.metadataPolicyId.trim() }),
    ...(epoch.projectionContractId === undefined
      ? {}
      : { projectionContractId: epoch.projectionContractId.trim() }),
  });
}

/**
 * The epoch is private repository policy, not public product source. A fixture
 * or public checkout without the file uses the legacy whole-history projector;
 * callers may also pass an explicit epoch to exercise forward replay locally.
 */
export async function readProjectionEpoch(
  root,
  relativePath = PUBLIC_PROJECTION_EPOCH_PATH
) {
  try {
    return validateProjectionEpoch(
      JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      fail(`${relativePath} is invalid JSON: ${error.message}`);
    }
    throw error;
  }
}
