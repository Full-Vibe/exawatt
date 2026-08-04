import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DELIVERY_SCHEMA_VERSION = 1;

export function delay(milliseconds) {
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

export async function commonGitDirectory(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root }
  );
  return stdout.trim();
}

export async function deliveryStateRoot(root) {
  const stateRoot = path.join(
    await commonGitDirectory(root),
    'exawatt-delivery'
  );
  await mkdir(stateRoot, { recursive: true });
  return stateRoot;
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function appendDeliveryMetric(root, type, details = {}) {
  const stateRoot = await deliveryStateRoot(root);
  await appendFile(
    path.join(stateRoot, 'metrics.jsonl'),
    `${JSON.stringify({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      type,
      at: new Date().toISOString(),
      ...details,
    })}\n`
  );
}

export function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((percentage / 100) * sorted.length) - 1];
}

export async function readDeliveryMetrics(root) {
  const metricsPath = path.join(await deliveryStateRoot(root), 'metrics.jsonl');
  try {
    const content = await readFile(metricsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function summarizeDeliveryMetrics(events) {
  const terminal = events.filter(event => event.type === 'queue_terminal');
  const locks = events.filter(event => event.type === 'integration_lock');
  const dogfood = events.filter(event => event.type === 'dogfood_installed');
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    landings: terminal.filter(event => event.status === 'integrated').length,
    failedTickets: terminal.filter(event => event.status === 'failed').length,
    queueWaitP50Ms: percentile(
      terminal.map(event => event.queueWaitMs).filter(Number.isFinite),
      50
    ),
    queueWaitP95Ms: percentile(
      terminal.map(event => event.queueWaitMs).filter(Number.isFinite),
      95
    ),
    lockHoldP95Ms: percentile(
      locks.map(event => event.durationMs).filter(Number.isFinite),
      95
    ),
    staleStopCount: events.filter(event => event.type === 'stale_stop').length,
    floorFailures: events.filter(
      event => event.type === 'floor_check' && event.status === 'failed'
    ).length,
    actionsMinutes: events
      .filter(event => event.type === 'actions_run')
      .reduce((sum, event) => sum + (event.minutes ?? 0), 0),
    dogfoodFreshnessP95Ms: percentile(
      dogfood.map(event => event.freshnessMs).filter(Number.isFinite),
      95
    ),
  };
}
