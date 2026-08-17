#!/usr/bin/env node

import { acquireCiBatchWorker, runCiBatchWorker } from './lib/ci-batch.mjs';
import { appendDeliveryMetric } from './lib/delivery-state.mjs';

let workerLock;
const root = process.cwd();
try {
  workerLock = await acquireCiBatchWorker(root);
  await runCiBatchWorker(root);
} catch (error) {
  if (
    !String(error?.message).includes(
      'Timed out waiting for the CI batch worker'
    )
  ) {
    await appendDeliveryMetric(root, 'ci_batch_failed', {
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    console.error(
      `[ci-batch-worker] ${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  }
} finally {
  await workerLock?.release();
}
