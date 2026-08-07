import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import {
  hasStableSignerIdentity,
  inspectCodeSignature,
} from './macos-code-signing.mjs';

const execFileAsync = promisify(execFile);

export const QA_BROWSER_EXECUTABLE_ENV = 'EXAWATT_QA_BROWSER_EXECUTABLE';
export const QA_BROWSER_ALLOW_UNSTABLE_ENV =
  'EXAWATT_QA_BROWSER_ALLOW_UNSTABLE';

export function defaultMacBrowserCandidates(home = homedir()) {
  return [
    {
      name: 'Google Chrome',
      executablePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
    {
      name: 'Google Chrome',
      executablePath: join(
        home,
        'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ),
    },
    {
      name: 'Brave Browser',
      executablePath:
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    },
    {
      name: 'Brave Browser',
      executablePath: join(
        home,
        'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
      ),
    },
  ];
}

export function appBundleForExecutable(executablePath) {
  const marker = '.app/Contents/MacOS/';
  const markerIndex = executablePath.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `${executablePath} is not a macOS application-bundle executable.`
    );
  }
  return executablePath.slice(0, markerIndex + '.app'.length);
}

async function verifyCodeObject(codePath) {
  try {
    await execFileAsync(
      '/usr/bin/codesign',
      ['--verify', '--verbose=2', codePath],
      { maxBuffer: 4 * 1024 * 1024 }
    );
  } catch (error) {
    const details = String(error?.stderr ?? error?.stdout ?? '').trim();
    throw new Error(
      `${codePath} failed code-signature verification.${details ? ` ${details}` : ''}`
    );
  }
}

async function findNetworkHelperExecutable(appPath) {
  const productName = basename(appPath, '.app');
  const frameworks = join(appPath, 'Contents', 'Frameworks');
  const helperName = `${productName} Helper`;
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/usr/bin/find', [
      frameworks,
      '-path',
      `*/Helpers/${helperName}.app/Contents/MacOS/${helperName}`,
      '-type',
      'f',
      '-print',
      '-quit',
    ]));
  } catch (error) {
    throw new Error(
      `Could not inspect ${productName}'s network helper: ${String(error?.message ?? error)}`
    );
  }
  const helperPath = stdout.trim();
  if (!helperPath) {
    throw new Error(
      `${productName} has no discoverable ${helperName} network helper.`
    );
  }
  return helperPath;
}

export function assertStableBrowserIdentity({
  name,
  executablePath,
  helperPath,
  mainSignature,
  helperSignature,
}) {
  if (!hasStableSignerIdentity(mainSignature)) {
    throw new Error(
      `${name}'s main executable is ad-hoc, unsigned, or lacks a stable Team Identifier.`
    );
  }
  if (!hasStableSignerIdentity(helperSignature)) {
    throw new Error(
      `${name}'s network helper is ad-hoc, unsigned, or lacks a stable Team Identifier.`
    );
  }
  if (mainSignature.teamIdentifier !== helperSignature.teamIdentifier) {
    throw new Error(
      `${name}'s main executable uses Team ${mainSignature.teamIdentifier}, but its network helper uses Team ${helperSignature.teamIdentifier}.`
    );
  }
  return {
    kind: 'signed-system-browser',
    name,
    executablePath,
    helperPath,
    mainSignature,
    helperSignature,
    launchOptions: { executablePath },
  };
}

export async function inspectMacBrowserCandidate(candidate) {
  const executablePath = realpathSync(candidate.executablePath);
  const appPath = appBundleForExecutable(executablePath);
  const helperPath = await findNetworkHelperExecutable(appPath);
  await verifyCodeObject(executablePath);
  await verifyCodeObject(helperPath);
  const [mainSignature, helperSignature] = await Promise.all([
    inspectCodeSignature(executablePath),
    inspectCodeSignature(helperPath),
  ]);
  return assertStableBrowserIdentity({
    ...candidate,
    executablePath,
    helperPath,
    mainSignature,
    helperSignature,
  });
}

function fallbackBrowserCandidates(home) {
  return [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
    '/tmp/exa-pw/node_modules/playwright-core/.local-browsers',
  ];
}

export function resolvePlaywrightManagedExecutable(
  chromium,
  { home = homedir(), exists = existsSync } = {}
) {
  try {
    const expected = chromium.executablePath();
    if (expected && exists(expected)) return undefined;
  } catch {
    // Scan known caches below.
  }

  for (const root of fallbackBrowserCandidates(home)) {
    if (!exists(root)) continue;
    for (const directory of readdirSync(root)) {
      if (!directory.startsWith('chromium')) continue;
      const candidates = [
        join(
          root,
          directory,
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        ),
        join(
          root,
          directory,
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
        ),
        join(root, directory, 'chrome-linux/chrome'),
      ];
      for (const candidate of candidates) {
        if (exists(candidate)) return candidate;
      }
    }
  }
  return null;
}

function unavailableMessage(failures) {
  const detail = failures.length
    ? `\nChecked browsers:\n${failures.map(item => `- ${item}`).join('\n')}`
    : '';
  return (
    'No stable signed Chromium browser is available for macOS QA. ' +
    'The Playwright-managed Chrome for Testing browser is intentionally ' +
    'refused because its ad-hoc helper identity causes recurring Little ' +
    'Snitch approvals. Install a vendor-signed Google Chrome or Brave Browser, ' +
    `or set ${QA_BROWSER_EXECUTABLE_ENV} to a signed Chromium executable.${detail}\n` +
    `For an explicit one-off compatibility run only, set ${QA_BROWSER_ALLOW_UNSTABLE_ENV}=1.`
  );
}

/**
 * Resolve the browser used by repository Playwright evals.
 *
 * macOS defaults to a vendor-signed system browser and validates both the main
 * executable and the network-facing helper. Other platforms retain Playwright's
 * managed browser behavior. The unstable macOS browser is explicit-only.
 */
export async function resolveQaBrowser(
  chromium,
  {
    env = process.env,
    platform = process.platform,
    home = homedir(),
    exists = existsSync,
    inspectCandidate = inspectMacBrowserCandidate,
  } = {}
) {
  if (!chromium)
    throw new Error('resolveQaBrowser requires Playwright Chromium.');

  if (platform !== 'darwin' || env[QA_BROWSER_ALLOW_UNSTABLE_ENV] === '1') {
    const executablePath = resolvePlaywrightManagedExecutable(chromium, {
      home,
      exists,
    });
    if (executablePath === null) {
      throw new Error(
        'Playwright Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
      );
    }
    return {
      kind: 'playwright-managed-browser',
      name: 'Playwright managed browser',
      executablePath: executablePath ?? chromium.executablePath(),
      helperPath: null,
      mainSignature: null,
      helperSignature: null,
      launchOptions: executablePath ? { executablePath } : {},
      warning:
        platform === 'darwin'
          ? 'Using the explicit unstable macOS browser override.'
          : null,
    };
  }

  const explicitPath = env[QA_BROWSER_EXECUTABLE_ENV];
  const candidates = explicitPath
    ? [
        {
          name: basename(appBundleForExecutable(explicitPath), '.app'),
          executablePath: explicitPath,
        },
      ]
    : defaultMacBrowserCandidates(home);
  const failures = [];
  for (const candidate of candidates) {
    if (!exists(candidate.executablePath)) continue;
    try {
      return await inspectCandidate(candidate);
    } catch (error) {
      failures.push(`${candidate.name}: ${String(error?.message ?? error)}`);
      if (explicitPath) break;
    }
  }
  throw new Error(unavailableMessage(failures));
}

export async function resolveQaBrowserLaunchOptions(chromium, options) {
  return (await resolveQaBrowser(chromium, options)).launchOptions;
}

/**
 * Keys a first-run browser surface reads before deciding to invite the
 * operator. Electron evals are already exempt through the dev-evaluator
 * preload marker (`window.electron.feedback.testMode`); a browser eval has no
 * such marker, so it declares the same thing through storage.
 */
const EVAL_FIRST_RUN_KEYS = ['exawatt:account-first-run'];

/**
 * Put a Playwright page into the state a returning operator is in, before the
 * app boots. Without this a first-run invitation floats over the app chrome
 * and silently intercepts clicks on whatever it happens to cover — which is a
 * suppressed UI bug in the eval, not a product signal.
 *
 * Call on every page that drives an APP route. Surfaces whose first-run
 * behaviour is itself under test must skip it and assert deliberately.
 */
export async function primeEvalBrowserPage(page, keys = EVAL_FIRST_RUN_KEYS) {
  await page.addInitScript(storageKeys => {
    try {
      for (const key of storageKeys) {
        window.localStorage.setItem(key, 'dismissed');
      }
    } catch {
      // A storage-denied context still runs the eval; the invitation may then
      // appear, and the failure it causes is a real one worth seeing.
    }
  }, keys);
}
