import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ownerFile = 'owner.json';

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readOwner(lockPath) {
  try {
    return JSON.parse(await readFile(path.join(lockPath, ownerFile), 'utf8'));
  } catch {
    return null;
  }
}

async function writeOwner(lockPath, owner) {
  const temporaryOwner = path.join(
    lockPath,
    `${ownerFile}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryOwner, `${JSON.stringify(owner, null, 2)}\n`, {
      flag: 'wx',
    });
    await rename(temporaryOwner, path.join(lockPath, ownerFile));
  } finally {
    await rm(temporaryOwner, { force: true });
  }
}

async function lockAge(lockPath) {
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs;
  } catch {
    return null;
  }
}

export async function commonGitDirectory(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root }
  );
  return stdout.trim();
}

export async function deliveryLockPath(root) {
  const commonDirectory = await commonGitDirectory(root);
  const repositoryKey = createHash('sha256')
    .update(commonDirectory)
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpdir(), `exawatt-master-delivery-${repositoryKey}.lock`);
}

export function installationLockPath(target) {
  const targetKey = createHash('sha256')
    .update(path.resolve(target))
    .digest('hex')
    .slice(0, 16);
  return path.join(tmpdir(), `exawatt-app-install-${targetKey}.lock`);
}

export async function acquireDirectoryLock(
  lockPath,
  {
    existingToken,
    timeoutMs = 10 * 60_000,
    pollMs = 250,
    incompleteOwnerGraceMs = 5_000,
    description = 'delivery transaction',
    log = console.log,
  } = {}
) {
  const startedAt = Date.now();
  const token = existingToken || randomUUID();
  let announcedWait = false;

  while (true) {
    try {
      await mkdir(lockPath);
      await writeOwner(lockPath, {
        token,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      });
      return {
        lockPath,
        token,
        reentrant: false,
        async release() {
          const owner = await readOwner(lockPath);
          if (owner?.token === token) {
            await rm(lockPath, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        await rm(lockPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }

    const owner = await readOwner(lockPath);
    if (existingToken && owner?.token === existingToken) {
      await writeOwner(lockPath, {
        ...owner,
        pid: process.pid,
        delegatedAt: new Date().toISOString(),
      });
      return {
        lockPath,
        token: existingToken,
        reentrant: true,
        async release() {},
      };
    }

    if (
      (owner && !processExists(owner.pid)) ||
      (!owner && (await lockAge(lockPath)) > incompleteOwnerGraceMs)
    ) {
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for the ${description}${owner?.pid ? ` owned by process ${owner.pid}` : ''}.`
      );
    }
    if (!announcedWait) {
      log(`[delivery-lock] waiting for the active ${description}`);
      announcedWait = true;
    }
    await delay(pollMs);
  }
}

export async function acquireDeliveryLock(root, options = {}) {
  return acquireDirectoryLock(await deliveryLockPath(root), {
    existingToken: process.env.EXAWATT_MASTER_DELIVERY_LOCK_TOKEN,
    description: 'master delivery transaction',
    ...options,
  });
}

export async function acquireInstallationLock(target, options = {}) {
  return acquireDirectoryLock(installationLockPath(target), {
    description: `installation transaction for ${target}`,
    ...options,
  });
}
