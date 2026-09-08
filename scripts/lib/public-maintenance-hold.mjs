import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { deliveryStateRoot } from './delivery-state.mjs';

export const PUBLIC_MAINTENANCE_HOLD_FILE = 'public-maintenance-hold.json';
const SHA = /^[0-9a-f]{40}$/u;

export async function publicMaintenanceHoldPath(root) {
  return path.join(await deliveryStateRoot(root), PUBLIC_MAINTENANCE_HOLD_FILE);
}

export function validatePublicMaintenanceHold(hold) {
  if (![1, 2].includes(hold?.schemaVersion)) {
    throw new Error('[public-maintenance] schemaVersion must be 1 or 2');
  }
  if (!SHA.test(hold.expectedPublicSha ?? '')) {
    throw new Error(
      '[public-maintenance] expectedPublicSha must be a full SHA'
    );
  }
  if (typeof hold.reason !== 'string' || hold.reason.trim().length < 20) {
    throw new Error(
      '[public-maintenance] reason must be at least 20 characters'
    );
  }
  if (Number.isNaN(Date.parse(hold.enabledAt ?? ''))) {
    throw new Error('[public-maintenance] enabledAt must be an ISO timestamp');
  }
  if (
    hold.schemaVersion === 2 &&
    (![
      hold.publicRepository,
      hold.activationPrivateSha,
      hold.advertisedRefsDigest,
    ].every(value => typeof value === 'string' && value.length > 0) ||
      !SHA.test(hold.activationPrivateSha) ||
      !/^[0-9a-f]{64}$/u.test(hold.advertisedRefsDigest))
  ) {
    throw new Error('[public-maintenance] schema 2 custody fields are invalid');
  }
  return hold;
}

export async function readPublicMaintenanceHold(root) {
  try {
    return validatePublicMaintenanceHold(
      JSON.parse(await readFile(await publicMaintenanceHoldPath(root), 'utf8'))
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePublicMaintenanceHold(root, hold) {
  const destination = await publicMaintenanceHoldPath(root);
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = `${destination}.${process.pid}.tmp`;
  await writeFile(staging, JSON.stringify(hold, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(staging, destination);
  return hold;
}

export async function enablePublicMaintenanceHold(
  root,
  {
    expectedPublicSha,
    reason,
    publicRepository = null,
    activationPrivateSha = null,
    advertisedRefsDigest = null,
  }
) {
  const existing = await readPublicMaintenanceHold(root);
  if (existing) {
    if (
      existing.expectedPublicSha === expectedPublicSha &&
      existing.reason === reason
    ) {
      if (existing.schemaVersion === 1 && publicRepository) {
        return writePublicMaintenanceHold(
          root,
          validatePublicMaintenanceHold({
            ...existing,
            schemaVersion: 2,
            publicRepository,
            activationPrivateSha,
            advertisedRefsDigest,
          })
        );
      }
      return existing;
    }
    throw new Error('[public-maintenance] a different hold is already active');
  }
  const hold = validatePublicMaintenanceHold({
    schemaVersion: publicRepository ? 2 : 1,
    enabledAt: new Date().toISOString(),
    expectedPublicSha,
    reason: reason.trim(),
    ...(publicRepository
      ? { publicRepository, activationPrivateSha, advertisedRefsDigest }
      : {}),
  });
  return writePublicMaintenanceHold(root, hold);
}

export async function clearPublicMaintenanceHold(root, { expectedPublicSha }) {
  const hold = await readPublicMaintenanceHold(root);
  if (!hold) return false;
  if (hold.expectedPublicSha !== expectedPublicSha) {
    throw new Error('[public-maintenance] exact held public SHA is required');
  }
  await rm(await publicMaintenanceHoldPath(root));
  return true;
}
