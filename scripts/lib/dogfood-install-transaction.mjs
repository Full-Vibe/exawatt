// Generated for the public repository by the "public-dogfood-tooling" recipe.
import { access, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function recoverLegacyDogfoodSwap({ installDir, target }) {
  const productName = path.basename(target, '.app');
  const escapedProductName = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const legacyBackupPattern = new RegExp(
    `^\\.${escapedProductName}\\.previous-\\d+\\.app$`
  );
  const entries = await readdir(installDir, { withFileTypes: true }).catch(
    error => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  );
  const backups = entries
    .filter(
      entry =>
        entry.isDirectory() && legacyBackupPattern.test(entry.name)
    )
    .map(entry => path.join(installDir, entry.name));
  const targetExists = await pathExists(target);

  if (!targetExists && backups.length === 1) {
    await rename(backups[0], target);
    console.log(
      '[dogfood-install] recovered the previous app from an interrupted legacy swap'
    );
    return;
  }
  if (!targetExists && backups.length > 1) {
    throw new Error(
      `Cannot safely recover ${productName}: ${backups.length} legacy backup apps exist in ${installDir}.`
    );
  }
  if (targetExists) {
    for (const backup of backups) {
      await rm(backup, { recursive: true, force: true });
    }
  }
}

async function verifies(candidate, verify) {
  try {
    await verify(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function recoverAtomicDogfoodSwap({
  staging,
  target,
  verify,
  atomicSwap,
}) {
  if (!(await pathExists(staging))) return { recovered: false };

  const targetExists = await pathExists(target);
  const stagingValid = await verifies(staging, verify);
  if (!targetExists) {
    if (!stagingValid) {
      throw new Error(
        `Interrupted dogfood transaction left no app at ${target} and an unverifiable app at ${staging}.`
      );
    }
    await rename(staging, target);
    try {
      await verify(target);
    } catch (verificationError) {
      try {
        await rename(target, staging);
      } catch (rollbackError) {
        throw new AggregateError(
          [verificationError, rollbackError],
          `Recovery moved the staged app to ${target}, verification failed, and rollback to ${staging} also failed.`
        );
      }
      throw verificationError;
    }
    return { recovered: true, action: 'completed-staged-install' };
  }

  const targetValid = await verifies(target, verify);
  if (targetValid) {
    await rm(staging, { recursive: true, force: true });
    return { recovered: true, action: 'removed-stale-previous-app' };
  }
  if (stagingValid) {
    await atomicSwap(staging, target);
    try {
      await verify(target);
    } catch (verificationError) {
      try {
        await atomicSwap(staging, target);
      } catch (rollbackError) {
        const aggregate = new AggregateError(
          [verificationError, rollbackError],
          `Recovery verification failed and atomic rollback failed. The previously verified app remains at ${staging}.`
        );
        aggregate.preserveStaging = true;
        throw aggregate;
      }
      throw verificationError;
    }
    await rm(staging, { recursive: true, force: true });
    return { recovered: true, action: 'restored-verified-app' };
  }

  throw new Error(
    `Interrupted dogfood transaction left unverifiable apps at both ${target} and ${staging}; refusing destructive recovery.`
  );
}

export async function commitStagedApp({
  staging,
  target,
  expectedIdentity,
  allowedPreviousIdentities = [],
  inspectExisting,
  isStableIdentity,
  verifyInstalled,
  atomicSwap,
}) {
  const targetExists = await pathExists(target);
  if (!targetExists) {
    await rename(staging, target);
    try {
      await verifyInstalled(target, expectedIdentity);
    } catch (verificationError) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [verificationError, cleanupError],
          `The first dogfood install failed verification and ${target} could not be removed.`
        );
      }
      throw verificationError;
    }
    return { replacedPrevious: false, stalePreviousPath: null };
  }

  let previousIdentity = null;
  try {
    previousIdentity = await inspectExisting(target);
  } catch (error) {
    if (error?.code !== 'ERR_CODE_OBJECT_UNSIGNED') {
      throw new Error(
        `Cannot safely inspect the existing app at ${target}; it was left untouched.`,
        { cause: error }
      );
    }
    // Unsigned pre-D17 installs are allowed to migrate once.
  }
  if (
    previousIdentity &&
    isStableIdentity(previousIdentity) &&
    (previousIdentity.identifier !== expectedIdentity.identifier ||
      previousIdentity.teamIdentifier !== expectedIdentity.teamIdentifier) &&
    !allowedPreviousIdentities.some(
      identity =>
        previousIdentity.identifier === identity.identifier &&
        previousIdentity.teamIdentifier === identity.teamIdentifier
    )
  ) {
    throw new Error(
      `Refusing to replace ${target}: its stable signer identity does not match the expected distribution identity. Remove or relocate that app only if this signer change is intentional.`
    );
  }

  await atomicSwap(staging, target);
  try {
    await verifyInstalled(target, expectedIdentity);
  } catch (verificationError) {
    try {
      await atomicSwap(staging, target);
    } catch (rollbackError) {
      const aggregate = new AggregateError(
        [verificationError, rollbackError],
        `The new app failed verification and atomic rollback failed. The prior app remains at ${staging}.`
      );
      aggregate.preserveStaging = true;
      throw aggregate;
    }
    throw verificationError;
  }

  return { replacedPrevious: true, stalePreviousPath: staging };
}
