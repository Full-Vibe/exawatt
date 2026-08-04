#!/usr/bin/env node

import {
  acquireDogfoodWorker,
  runDogfoodWorker,
} from './lib/dogfood-queue.mjs';
import { appendDeliveryMetric } from './lib/delivery-state.mjs';

let workerLock;
const root = process.cwd();
try {
  workerLock = await acquireDogfoodWorker(root);
  await runDogfoodWorker(root);
} catch (error) {
  if (
    !String(error?.message).includes('Timed out waiting for the dogfood worker')
  ) {
    await appendDeliveryMetric(root, 'dogfood_failed', {
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    console.error(
      `[dogfood-worker] ${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  }
} finally {
  await workerLock?.release();
}
