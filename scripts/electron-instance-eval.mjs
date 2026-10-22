#!/usr/bin/env node

// One running Exawatt per profile (BUG-305, BUG-274).
//
// Proves, on a real package:
// - a second copy launched from ANOTHER path over the same profile hands
//   itself to the running app and exits, and the running app answers it
//   (brings its window forward as its launch mode allows: a hidden automated
//   launch stays hidden);
// - a copy over a different profile is not refused: profiles run side by
//   side, which is what lets the installed app, a development worktree and
//   every eval's scratch profile coexist;
// - the package explains the Local Network prompt its agents raise;
// - the offer to move into Applications renders, and Not Now is kept in the
//   profile's record of dismissed notices (an automated launch asks for the
//   offer with EXAWATT_TEST_APP_PLACEMENT; its mover moves nothing).

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withElectronApp, withSecondCopy } from './lib/electron-eval.mjs';
import {
  clonePackagedApp,
  discardPackagedClone,
  ensurePackagedApp,
} from './lib/packaged-app.mjs';

const packaged = await ensurePackagedApp({ label: 'instance' });

const localNetwork = execFileSync(
  'plutil',
  [
    '-extract',
    'NSLocalNetworkUsageDescription',
    'raw',
    join(packaged.appPath, 'Contents', 'Info.plist'),
  ],
  { encoding: 'utf8' }
).trim();
if (!localNetwork) {
  throw new Error('The package declares no NSLocalNetworkUsageDescription');
}
console.log(
  `[instance] Local Network prompt explains itself: "${localNetwork}"`
);

const scratch = mkdtempSync(join(tmpdir(), 'exawatt-instance-'));
const profile = join(scratch, 'profile');
const otherProfile = join(scratch, 'other-profile');
const elsewhere = join(scratch, 'elsewhere');
mkdirSync(elsewhere);
const copy = clonePackagedApp(packaged, elsewhere);
const shots = join(tmpdir(), 'exawatt-instance-shots');
const launchEnv = userData => ({
  ...process.env,
  EXAWATT_TEST: '1',
  EXAWATT_USER_DATA: userData,
});

/** Polls `read` until it answers, or fails naming what it waited for. */
async function waitFor(read, what, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `TIMED OUT after ${deadlineMs / 1000}s waiting for ${what}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** `promise`, or a named failure once `deadlineMs` passes. */
function within(promise, what, deadlineMs = 30_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `TIMED OUT after ${deadlineMs / 1000}s waiting for ${what}`
            )
          ),
        deadlineMs
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function mainEvents(userData, event) {
  const log = join(userData, 'logs', 'main.jsonl');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(entry => entry.event === event);
}

try {
  await withElectronApp(
    {
      packaged,
      env: { ...launchEnv(profile), EXAWATT_TEST_APP_PLACEMENT: 'outside' },
    },
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await page.locator('[data-command-altitude]').waitFor();

      const offer = page.locator('[data-move-to-applications]');
      await offer.waitFor();
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, 'move-to-applications.png') });
      await offer.locator('[data-move-to-applications-decline]').click();
      await offer.waitFor({ state: 'detached' });
      const dismissed = await waitFor(() => {
        const file = join(profile, 'notice-dismissals.json');
        if (!existsSync(file)) return null;
        return JSON.parse(readFileSync(file, 'utf8')).dismissed?.[
          'move-to-applications'
        ];
      }, 'Not Now to be kept');
      console.log(
        `[instance] the move offer rendered (${join(shots, 'move-to-applications.png')}) and Not Now held for ${dismissed}`
      );

      const handedOff = await withSecondCopy(copy, launchEnv(profile), second =>
        within(second.exited, 'the second copy over the same profile to leave')
      );
      if (handedOff.code !== 0) {
        throw new Error(
          `The second copy exited ${handedOff.code ?? handedOff.signal}:\n${handedOff.output}`
        );
      }
      if (!/already running/u.test(handedOff.output)) {
        throw new Error(
          `The second copy did not say it handed off:\n${handedOff.output}`
        );
      }
      const [answered] = await waitFor(
        () => mainEvents(profile, 'instance.second-launch'),
        'the running app to answer the second launch'
      );
      if (answered.presented !== 'hidden' || answered.links !== 0) {
        throw new Error(
          `A hidden automated launch answered ${JSON.stringify(answered)}`
        );
      }
      const onScreen = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          window => window.isVisible() || window.isFocused()
        )
      );
      if (onScreen) {
        throw new Error(
          'Answering a second launch put a test window on screen'
        );
      }
      console.log(
        `[instance] a copy at ${copy.appPath} handed itself to the running app and exited`
      );

      await withSecondCopy(copy, launchEnv(otherProfile), async second => {
        let left = null;
        void second.exited.then(exit => (left = exit));
        await waitFor(
          () => left ?? existsSync(join(otherProfile, 'logs')),
          'the copy over another profile to start'
        );
        if (left) {
          throw new Error(
            `The copy over another profile was refused:\n${left.output}`
          );
        }
      });
      if (mainEvents(profile, 'instance.second-launch').length !== 1) {
        throw new Error('A copy over another profile reached the running app');
      }
      console.log('[instance] a copy over another profile ran side by side');
    },
    { maxMs: 180_000, firstWindowMs: 45_000 }
  );
  console.log('[instance] PASS');
} finally {
  discardPackagedClone(copy);
  rmSync(scratch, { recursive: true, force: true });
}
